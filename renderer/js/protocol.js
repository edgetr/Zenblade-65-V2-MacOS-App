export const VID = 0x3662,
  PIDS = [0x1001, 0x1002],
  PROFILE_COUNT = 3,
  KEY_COUNT = 67;
export const HID_FILTERS = PIDS.flatMap((
  productId,
) => [{ vendorId: VID, productId, usagePage: 0xff01, usage: 1 }, {
  vendorId: VID,
  productId,
  usagePage: 0xff60,
  usage: 97,
}, { vendorId: VID, productId }]);
export const pctToWire = (n) =>
  Math.max(0, Math.min(255, Math.round(Number(n) / 100 * 255)));
export const pctFromWire = (n) =>
  Math.max(0, Math.min(100, Math.round(Number(n) / 255 * 100)));
export const colorToWire = (hue, saturation) => ({
  hue: Math.max(0, Math.min(255, Math.round(Number(hue) / 360 * 255))),
  saturation: pctToWire(saturation),
});
export const colorFromWire = (hue, saturation) => ({
  hue: Math.max(0, Math.min(360, Math.round(Number(hue) / 255 * 360))),
  saturation: pctFromWire(saturation),
});
export function pickZenbladeDevice(devices) {
  const list = devices.filter((d) =>
    d.vendorId === VID && PIDS.includes(d.productId)
  );
  return list.sort((a, b) => score(b) - score(a))[0] || null;
}
function score(d) {
  return (d.collections || []).reduce(
    (n, c) =>
      n + (c.usagePage === 0xff01 || c.usagePage === 0xff60 ? 10 : 0) +
      ((c.outputReports?.length || c.featureReports?.length) ? 5 : 0),
    0,
  );
}
const pad = (cmd) => {
    const out = new Uint8Array(64);
    out.set(cmd.slice(0, 64));
    return out;
  },
  same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
export class ZenbladeDevice {
  constructor() {
    this.device = null;
    this._queue = [];
    this._busy = false;
    this._timeoutMs = 3500;
    this.listeners = new Set();
    this._onInput = this._onInput.bind(this);
  }
  get connected() {
    return !!this.device?.opened;
  }
  get info() {
    return this.device
      ? {
        productName: this.device.productName || "Zenblade 65",
        vendorId: this.device.vendorId,
        productId: this.device.productId,
        protocol: this.device.productId === 0x1002 ? "v3" : "v1/v2",
      }
      : null;
  }
  onStatus(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  _emit(type, detail) {
    this.listeners.forEach((fn) => {
      try {
        fn({ type, detail });
      } catch {}
    });
  }
  async connect(existing) {
    if (!navigator.hid) throw Error("WebHID unavailable");
    // Callers may receive arbitrary WebHID connect events; never trust an
    // injected device without the same VID/PID validation used for discovery.
    let d = existing
      ? pickZenbladeDevice([existing])
      : pickZenbladeDevice(await navigator.hid.getDevices());
    if (!d) {
      d = pickZenbladeDevice(
        await navigator.hid.requestDevice({ filters: HID_FILTERS }),
      );
    }
    if (!d) throw Error("No Zenblade selected");
    if (!d.opened) await d.open();
    this.device = d;
    d.addEventListener("inputreport", this._onInput);
    this._emit("connected", this.info);
    return this.info;
  }
  async disconnect() {
    if (this.device) {
      this.device.removeEventListener("inputreport", this._onInput);
      try {
        if (this.device.opened) await this.device.close();
      } catch {}
    }
    this.device = null;
    this._queue.splice(0).forEach((x) => {
      clearTimeout(x.timer);
      x.reject(Error("Disconnected"));
    });
    this._busy = false;
    this._emit("disconnected");
  }
  _onInput(event) {
    const bytes = new Uint8Array(event.data.buffer);
    if (bytes[0] === 255) this._emit("error", "Device error packet");
    const item = this._queue[0];
    if (!item) return;
    const matches = bytes.length >= item.id.length &&
      same([...bytes.slice(0, item.id.length)], [...item.id]);
    if (!matches && bytes[0] !== item.id[0]) return;
    clearTimeout(item.timer);
    this._queue.shift();
    this._busy = false;
    item.resolve(bytes.slice(Math.min(item.id.length, bytes.length)));
    this._pump();
  }
  execute(command, idLength) {
    if (!this.connected) return Promise.reject(Error("Not connected"));
    const raw = new Uint8Array(command), id = raw.slice(0, idLength);
    return new Promise((resolve, reject) => {
      const item = { id, wire: pad(raw), resolve, reject };
      item.timer = setTimeout(() => {
        const i = this._queue.indexOf(item);
        if (i >= 0) this._queue.splice(i, 1);
        this._busy = false;
        reject(Error("Timeout"));
        this._pump();
      }, this._timeoutMs);
      this._queue.push(item);
      this._pump();
    });
  }
  async _pump() {
    if (this._busy || !this._queue.length || !this.device) return;
    this._busy = true;
    const item = this._queue[0];
    try {
      await this.device.sendReport(0, item.wire);
    } catch (error) {
      const index = this._queue.indexOf(item);
      if (index >= 0) this._queue.splice(index, 1);
      clearTimeout(item.timer);
      this._busy = false;
      item.reject(error);
      this._pump();
    }
  }
  async readLighting() {
    const mode = (await this.execute([8, 3, 2], 3))[0] ?? 0,
      b = (await this.execute([8, 3, 1], 3))[0] ?? 128,
      s = (await this.execute([8, 3, 3], 3))[0] ?? 128,
      c = await this.execute([8, 3, 4], 3),
      color = colorFromWire(c[0] ?? 0, c[1] ?? 255);
    return {
      isOn: mode !== 0,
      mode: mode || 1,
      brightness: pctFromWire(b),
      speed: pctFromWire(s),
      ...color,
    };
  }
  async writeLighting(l) {
    // Zenblade firmware accepts both legacy (7) and current (9) lighting
    // command families. Sending the paired writes keeps v1/v2 and v3 boards
    // in sync; do not collapse these without firmware compatibility testing.
    const w = colorToWire(l.hue, l.saturation), mode = l.isOn ? l.mode : 0;
    for (
      const cmd of [
        [7, 3, 2, mode],
        [9, 3, 2, mode],
        [7, 3, 1, pctToWire(l.brightness)],
        [9, 3, 1, pctToWire(l.brightness)],
        [7, 3, 3, pctToWire(l.speed)],
        [9, 3, 3, pctToWire(l.speed)],
        [7, 3, 4, w.hue, w.saturation],
        [9, 3, 4, w.hue, w.saturation],
      ]
    ) await this.execute(cmd, 3);
  }
  async readProfile() {
    return (await this.execute([34], 1))[0] ?? 0;
  }
  async writeProfile(index) {
    const value = Math.max(0, Math.min(PROFILE_COUNT - 1, index | 0));
    await this.execute([35, value], 1);
    return value;
  }
  _pack(values) {
    const out = new Uint8Array(KEY_COUNT * 2);
    for (let i = 0; i < KEY_COUNT; i++) {
      const n = (values[i] ?? values[0] ?? 0) & 0xffff;
      out[i * 2] = n & 255;
      out[i * 2 + 1] = n >> 8;
    }
    return out;
  }
  async _matrix(head, values) {
    const p = this._pack(values);
    for (let i = 0; i * 25 < KEY_COUNT; i++) {
      const count = Math.min(25, KEY_COUNT - i * 25);
      await this.execute(
        new Uint8Array([
          ...head,
          i * 25,
          count,
          ...p.slice(i * 50, i * 50 + count * 2),
        ]),
        5,
      );
    }
  }
  async writeActuationMatrix(
    {
      profileIndex = 0,
      pressValues = [],
      releaseValues = [],
      rapidTrigger = true,
      continuousRapidTrigger = false,
    },
  ) {
    const p = Math.max(0, Math.min(2, profileIndex | 0)),
      all = (v) => Array(KEY_COUNT).fill(v);
    await this._matrix([33, 9, p], all(rapidTrigger ? 1 : 0));
    await this._matrix([33, 7, p], pressValues);
    await this._matrix([33, 8, p], releaseValues);
    await this._matrix([33, 16, p], all(4 | (continuousRapidTrigger ? 1 : 0)));
    await this.execute([33, 243], 2);
    return true;
  }
}
