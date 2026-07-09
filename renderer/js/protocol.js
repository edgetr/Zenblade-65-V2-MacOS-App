export const VID = 0x3662;
export const PIDS = [0x1001, 0x1002];

export const HID_FILTERS = [
  { vendorId: VID, productId: 0x1001, usagePage: 0xff01, usage: 1 },
  { vendorId: VID, productId: 0x1002, usagePage: 0xff01, usage: 1 },
  { vendorId: VID, productId: 0x1001, usagePage: 0xff60, usage: 97 },
  { vendorId: VID, productId: 0x1002, usagePage: 0xff60, usage: 97 },
  { vendorId: VID, productId: 0x1001 },
  { vendorId: VID, productId: 0x1002 },
];

export const LIGHT_MODES = [
  { id: 1, name: "Solid", rainbow: false, params: ["brightness", "color"] },
  { id: 2, name: "Alpha Mods", rainbow: false, params: ["brightness", "color"] },
  { id: 3, name: "Gradient V", rainbow: true, params: ["brightness", "color"] },
  { id: 4, name: "Gradient H", rainbow: true, params: ["brightness", "color"] },
  { id: 5, name: "Breathing", rainbow: false, params: ["brightness", "speed", "color"] },
  { id: 6, name: "Band Sat", rainbow: false, params: ["brightness", "speed", "color"] },
  { id: 7, name: "Band Value", rainbow: false, params: ["brightness", "speed", "color"] },
  { id: 8, name: "Pinwheel Sat", rainbow: true, params: ["brightness", "speed", "color"] },
  { id: 9, name: "Pinwheel Val", rainbow: true, params: ["brightness", "speed", "color"] },
  { id: 10, name: "Spiral Sat", rainbow: true, params: ["brightness", "speed", "color"] },
  { id: 11, name: "Spiral Val", rainbow: true, params: ["brightness", "speed", "color"] },
  { id: 12, name: "Cycle All", rainbow: true, params: ["brightness", "speed", "color"] },
  { id: 13, name: "Cycle H", rainbow: true, params: ["brightness", "speed"] },
  { id: 14, name: "Cycle V", rainbow: true, params: ["brightness", "speed"] },
  { id: 15, name: "Rainbow Chevron", rainbow: true, params: ["brightness", "speed"] },
  { id: 16, name: "Cycle Out/In", rainbow: true, params: ["brightness", "speed"] },
  { id: 17, name: "Cycle Out/In Dual", rainbow: true, params: ["brightness", "speed"] },
  { id: 18, name: "Cycle Pinwheel", rainbow: true, params: ["brightness", "speed"] },
  { id: 19, name: "Cycle Spiral", rainbow: true, params: ["brightness", "speed"] },
  { id: 20, name: "Dual Beacon", rainbow: true, params: ["brightness", "speed", "color"] },
  { id: 21, name: "Rainbow Beacon", rainbow: true, params: ["brightness", "speed", "color"] },
  { id: 22, name: "Rainbow Pinwheels", rainbow: true, params: ["brightness", "speed", "color"] },
  { id: 23, name: "Raindrops", rainbow: true, params: ["brightness"] },
  { id: 24, name: "Jellybean Rain", rainbow: true, params: ["brightness"] },
  { id: 25, name: "Hue Breathing", rainbow: false, params: ["brightness", "speed", "color"] },
  { id: 26, name: "Hue Pendulum", rainbow: true, params: ["brightness", "speed", "color"] },
  { id: 27, name: "Hue Wave", rainbow: true, params: ["brightness", "speed", "color"] },
  { id: 28, name: "Pixel Rain", rainbow: true, params: ["brightness", "speed"] },
  { id: 29, name: "Pixel Flow", rainbow: true, params: ["brightness", "speed"] },
  { id: 30, name: "Pixel Fractal", rainbow: true, params: ["brightness", "speed", "color"] },
  { id: 31, name: "Typing Heatmap", rainbow: false, params: ["brightness", "speed"] },
  { id: 32, name: "Digital Rain", rainbow: true, params: ["brightness"] },
  { id: 33, name: "Reactive Simple", rainbow: false, params: ["brightness", "speed", "color"] },
  { id: 34, name: "Solid Reactive", rainbow: false, params: ["brightness", "speed", "color"] },
  { id: 35, name: "Reactive Wide", rainbow: false, params: ["brightness", "speed", "color"] },
  { id: 36, name: "Reactive Multi Wide", rainbow: false, params: ["brightness", "speed", "color"] },
  { id: 37, name: "Reactive Cross", rainbow: false, params: ["brightness", "speed", "color"] },
  { id: 38, name: "Reactive Multi Cross", rainbow: false, params: ["brightness", "speed", "color"] },
  { id: 39, name: "Reactive Nexus", rainbow: false, params: ["brightness", "speed", "color"] },
  { id: 40, name: "Reactive Multi Nexus", rainbow: false, params: ["brightness", "speed", "color"] },
  { id: 41, name: "Splash", rainbow: false, params: ["brightness", "speed", "color"] },
  { id: 42, name: "Multi Splash", rainbow: false, params: ["brightness", "speed", "color"] },
  { id: 43, name: "Solid Splash", rainbow: false, params: ["brightness", "speed", "color"] },
  { id: 44, name: "Solid Multi Splash", rainbow: false, params: ["brightness", "speed", "color"] },
];

export const PROFILE_COUNT = 3;
export const KEY_COUNT = 67;

const REPORT_SIZE = 64;

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function padReport(cmd) {
  const out = new Uint8Array(REPORT_SIZE);
  out.set(cmd.subarray(0, Math.min(cmd.length, REPORT_SIZE)));
  return out;
}

export function pickZenbladeDevice(devices) {
  const list = devices.filter(
    (d) => d.vendorId === VID && PIDS.includes(d.productId)
  );
  if (!list.length) return null;

  const score = (d) => {
    let s = 0;
    for (const c of d.collections || []) {
      if (c.usagePage === 0xff01 || c.usagePage === 0xff60) s += 10;
      if (
        (c.outputReports && c.outputReports.length) ||
        (c.featureReports && c.featureReports.length)
      )
        s += 5;
      if (c.usagePage === 0x01 || c.usagePage === 0x0c) s -= 3;
    }
    return s;
  };

  return list.slice().sort((a, b) => score(b) - score(a))[0];
}

export function pctToWire(pct) {
  return Math.max(0, Math.min(255, Math.round((Number(pct) / 100) * 255)));
}

export function pctFromWire(byte) {
  return Math.max(0, Math.min(100, Math.round((Number(byte) / 255) * 100)));
}

export function colorToWire(hueDeg, satPct) {
  const hue = Math.max(0, Math.min(255, Math.round((Number(hueDeg) / 360) * 255)));
  const saturation = pctToWire(satPct);
  return { hue, saturation };
}

export function colorFromWire(hueByte, satByte) {
  const hue = Math.max(0, Math.min(360, Math.round((Number(hueByte) / 255) * 360)));
  const saturation = pctFromWire(satByte);
  return { hue, saturation };
}

export function hsvToRgb(h, s, v) {
  const hh = (((Number(h) % 360) + 360) % 360) / 60;
  const ss = Math.max(0, Math.min(100, Number(s))) / 100;
  const vv = Math.max(0, Math.min(100, Number(v))) / 100;
  const c = vv * ss;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = vv - c;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hh >= 0 && hh < 1) [rp, gp, bp] = [c, x, 0];
  else if (hh < 2) [rp, gp, bp] = [x, c, 0];
  else if (hh < 3) [rp, gp, bp] = [0, c, x];
  else if (hh < 4) [rp, gp, bp] = [0, x, c];
  else if (hh < 5) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

export function hslToRgb(h, s, l) {
  const hh = ((Number(h) % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(100, Number(s))) / 100;
  const ll = Math.max(0, Math.min(100, Number(l))) / 100;
  const a = ss * Math.min(ll, 1 - ll);
  const f = (n) => {
    const k = (n + hh / 30) % 12;
    const c = ll - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c);
  };
  return { r: f(0), g: f(8), b: f(4) };
}

export function rgbToHsv(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return {
    h: Math.round(h),
    s: Math.round(s),
    v: Math.round(v),
  };
}

export function rgbToHsl(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
    else if (max === gg) h = ((bb - rr) / d + 2) / 6;
    else h = ((rr - gg) / d + 4) / 6;
  }
  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function rgbToHex({ r, g, b }) {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

export function hexToRgb(hex) {
  const n = String(hex || "").replace("#", "").trim();
  if (n.length === 3) {
    const r = parseInt(n[0] + n[0], 16);
    const g = parseInt(n[1] + n[1], 16);
    const b = parseInt(n[2] + n[2], 16);
    if ([r, g, b].some((v) => Number.isNaN(v))) return null;
    return { r, g, b };
  }
  if (n.length !== 6) return null;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  return { r, g, b };
}

export function rgbToCss({ r, g, b }, alpha = 1) {
  if (alpha >= 1) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function keyDisplayColor(lighting, pos) {
  const { isOn, mode, hue, saturation, brightness } = lighting;
  if (!isOn || mode === 0) {
    return { r: 42, g: 40, b: 52 };
  }

  const modeMeta = LIGHT_MODES.find((m) => m.id === mode);
  const value = 18 + (Math.max(0, Math.min(100, brightness)) / 100) * 82;
  let h = hue;
  let s = Math.max(0, Math.min(100, saturation));
  if (modeMeta?.rainbow) {
    s = Math.max(s, 78);
    const t =
      pos.colCount > 1
        ? pos.col / (pos.colCount - 1)
        : pos.rowCount > 1
          ? pos.row / (pos.rowCount - 1)
          : 0;
    h = (hue + t * 300) % 360;
  }

  return hsvToRgb(h, s, value);
}

export function keyOverrideDisplayColor(lighting, pos) {
  const base = keyDisplayColor(lighting, pos);
  const hsv = rgbToHsv(base.r, base.g, base.b);
  const h = (hsv.h + 168) % 360;
  const s = Math.min(100, Math.max(55, hsv.s + 10));
  const v = Math.min(100, Math.max(72, hsv.v + 8));
  return hsvToRgb(h, s, v);
}

export function lightingSwatchCss(lighting) {
  if (!lighting.isOn || lighting.mode === 0) return "rgb(42, 40, 52)";
  const rgb = keyDisplayColor(lighting, {
    col: 0,
    row: 0,
    colCount: 1,
    rowCount: 1,
  });
  return rgbToCss(rgb);
}

export function lightingAccentRgb(lighting) {
  if (!lighting?.isOn) return { r: 184, g: 245, b: 200 };
  return hsvToRgb(
    lighting.hue ?? 0,
    Math.max(40, lighting.saturation ?? 100),
    18 + ((lighting.brightness ?? 80) / 100) * 82
  );
}

export class ZenbladeDevice {
  constructor() {
    this.device = null;
    this._queue = [];
    this._busy = false;
    this._timeoutMs = 3500;
    this._onInput = this._onInput.bind(this);
    this.listeners = new Set();
    this.lastError = null;
    this.debug = false;
  }

  onStatus(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _emit(type, detail) {
    for (const fn of this.listeners) {
      try {
        fn({ type, detail });
      } catch (_) {
        /* ignore */
      }
    }
  }

  _log(...args) {
    if (this.debug) console.log("[zenblade]", ...args);
  }

  get connected() {
    return !!(this.device && this.device.opened);
  }

  get info() {
    if (!this.device) return null;
    return {
      productName: this.device.productName || "Zenblade 65",
      vendorId: this.device.vendorId,
      productId: this.device.productId,
      protocol: this.device.productId === 0x1002 ? "v3" : "v1/v2",
    };
  }

  async connect(existing) {
    if (!navigator.hid) throw new Error("WebHID unavailable");

    let device = existing || null;
    if (!device) {
      device = pickZenbladeDevice(await navigator.hid.getDevices());
    }
    if (!device) {
      const picked = await navigator.hid.requestDevice({ filters: HID_FILTERS });
      device = pickZenbladeDevice(picked) || picked[0] || null;
    }
    if (!device) throw new Error("No Zenblade selected");

    if (!device.opened) await device.open();
    this.device = device;
    this.device.addEventListener("inputreport", this._onInput);
    this._emit("connected", this.info);
    return this.info;
  }

  async disconnect() {
    if (this.device) {
      this.device.removeEventListener("inputreport", this._onInput);
      try {
        if (this.device.opened) await this.device.close();
      } catch (_) {
        /* ignore */
      }
    }
    this.device = null;
    for (const item of this._queue) {
      clearTimeout(item.timer);
      item.reject(new Error("Disconnected"));
    }
    this._queue = [];
    this._busy = false;
    this._emit("disconnected", null);
  }

  _onInput(event) {
    const buf = new Uint8Array(event.data.buffer);
    if (buf[0] === 255) this._emit("error", "Device error packet");
    if (!this._queue.length) return;

    const item = this._queue[0];
    const id = item.commandId;
    let matched =
      buf.length >= id.length && bytesEqual(buf.slice(0, id.length), id);
    let payload = matched ? buf.slice(id.length) : null;

    if (!matched && buf.length >= 1 && id.length >= 1 && buf[0] === id[0]) {
      matched = true;
      payload = buf.slice(Math.min(id.length, buf.length));
    }
    if (!matched) return;

    clearTimeout(item.timer);
    this._queue.shift();
    this._busy = false;
    item.resolve(payload || new Uint8Array());
    this._pump();
  }

  execute(command, idLength) {
    if (!this.connected) {
      return Promise.reject(new Error("Not connected"));
    }
    const raw = command instanceof Uint8Array ? command : new Uint8Array(command);
    const commandId = raw.slice(0, idLength);
    const wire = padReport(raw);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this._queue.indexOf(entry);
        if (idx >= 0) this._queue.splice(idx, 1);
        this._busy = false;
        reject(new Error("Timeout"));
        this._pump();
      }, this._timeoutMs);

      const entry = { commandId, command: wire, resolve, reject, timer };
      this._queue.push(entry);
      this._pump();
    });
  }

  async _pump() {
    if (this._busy || !this._queue.length || !this.device) return;
    this._busy = true;
    const item = this._queue[0];
    try {
      await this.device.sendReport(0, item.command);
    } catch (err) {
      clearTimeout(item.timer);
      this._queue.shift();
      this._busy = false;
      item.reject(err);
      this._pump();
    }
  }

  async readLighting() {
    const mode = (await this.execute([8, 3, 2], 3))[0] ?? 0;
    const brightnessByte = (await this.execute([8, 3, 1], 3))[0] ?? 128;
    const speedByte = (await this.execute([8, 3, 3], 3))[0] ?? 128;
    const color = await this.execute([8, 3, 4], 3);
    const { hue, saturation } = colorFromWire(color[0] ?? 0, color[1] ?? 255);
    const isOn = mode !== 0;
    return {
      isOn,
      mode: isOn ? mode : 1,
      brightness: pctFromWire(brightnessByte),
      speed: pctFromWire(speedByte),
      hue,
      saturation,
    };
  }

  async writeLighting({ isOn, mode, brightness, speed, hue, saturation }) {
    const effectiveMode = isOn ? mode : 0;
    const wire = colorToWire(hue, saturation);
    const b = pctToWire(brightness);
    const sp = pctToWire(speed);

    await this.execute([7, 3, 2, effectiveMode], 3);
    await this.execute([9, 3, 2, effectiveMode], 3);
    await this.execute([7, 3, 1, b], 3);
    await this.execute([9, 3, 1, b], 3);
    await this.execute([7, 3, 3, sp], 3);
    await this.execute([9, 3, 3, sp], 3);
    await this.execute([7, 3, 4, wire.hue, wire.saturation], 3);
    await this.execute([9, 3, 4, wire.hue, wire.saturation], 3);
  }

  async readProfile() {
    const res = await this.execute([34], 1);
    return res[0] ?? 0;
  }

  async writeProfile(index) {
    const i = Math.max(0, Math.min(PROFILE_COUNT - 1, index | 0));
    await this.execute([35, i], 1);
    return i;
  }

  // hub: press [33,7,p], release [33,8,p], mode [33,9,p] (0=trad,1=magnetic),
  // properties [33,16,p], save [33,243]

  _packU16All(value) {
    const n = value & 0xffff;
    const out = new Uint8Array(KEY_COUNT * 2);
    for (let i = 0; i < KEY_COUNT; i++) {
      out[i * 2] = n & 0xff;
      out[i * 2 + 1] = (n >> 8) & 0xff;
    }
    return out;
  }

  _packU16List(values) {
    const out = new Uint8Array(KEY_COUNT * 2);
    for (let i = 0; i < KEY_COUNT; i++) {
      const n = (values[i] ?? values[0] ?? 0) & 0xffff;
      out[i * 2] = n & 0xff;
      out[i * 2 + 1] = (n >> 8) & 0xff;
    }
    return out;
  }

  async _writeMatrix(header3, payloadU16) {
    for (let c = 0; c * 25 < KEY_COUNT; c++) {
      const count = Math.min(25, KEY_COUNT - c * 25);
      const slice = payloadU16.slice(c * 25 * 2, (c * 25 + count) * 2);
      const cmd = new Uint8Array([
        header3[0],
        header3[1],
        header3[2],
        c * 25,
        count,
        ...slice,
      ]);
      await this.execute(cmd, 5);
    }
  }

  async writeGlobalActuation({
    profileIndex = 0,
    press = 14,
    release = 14,
    rapidTrigger = true,
    continuousRapidTrigger = false,
  }) {
    const p = Math.max(1, Math.min(40, press | 0));
    const r = Math.max(1, Math.min(40, release | 0));
    return this.writeActuationMatrix({
      profileIndex,
      pressValues: Array(KEY_COUNT).fill(p),
      releaseValues: Array(KEY_COUNT).fill(r),
      rapidTrigger,
      continuousRapidTrigger,
    });
  }

  async writeActuationMatrix({
    profileIndex = 0,
    pressValues,
    releaseValues,
    rapidTrigger = true,
    continuousRapidTrigger = false,
  }) {
    const profile = Math.max(0, Math.min(2, profileIndex | 0));
    const presses = pressValues || this._packU16All(15);
    const releases = releaseValues || this._packU16All(15);

    const pressPayload =
      presses instanceof Uint8Array ? presses : this._packU16List(presses);
    const releasePayload =
      releases instanceof Uint8Array ? releases : this._packU16List(releases);

    const modeVal = rapidTrigger ? 1 : 0;
    await this._writeMatrix([33, 9, profile], this._packU16All(modeVal));
    await this._writeMatrix([33, 7, profile], pressPayload);
    await this._writeMatrix([33, 8, profile], releasePayload);

    let prop = 4;
    if (continuousRapidTrigger) prop |= 1;
    await this._writeMatrix([33, 16, profile], this._packU16All(prop));

    await this.execute([33, 243], 2);
    return true;
  }
}
