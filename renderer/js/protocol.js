import deviceIds from "../../shared/device-ids.json" with { type: "json" };

export const VID = deviceIds.vendorId;
export const PIDS = deviceIds.productIds;
export const PROFILE_COUNT = 3;
export const KEY_COUNT = 68;
export const MATRIX_KEY_COUNT = 72;
export const LAYER_COUNT = 6;
export const MACRO_COUNT = 16;
export const SOCD_SLOT_COUNT = 10;
export const LIGHT_MODE_MAX = 44;
const finite = (value, fallback) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const boundedInteger = (value, low, high, fallback) =>
  Math.round(Math.max(low, Math.min(high, finite(value, fallback))));

// Unsupported firmware IDs (currently mode 2 / Alpha Mods) fall back to Solid.
// Other IDs 3–44 are preserved exactly and must not be renumbered.
const UNSUPPORTED_MODES = new Set([2]);
const FALLBACK_MODE = 1;

export function resolveLightingMode(mode, fallback = 1) {
  const resolved = boundedInteger(mode, 1, LIGHT_MODE_MAX, fallback);
  return UNSUPPORTED_MODES.has(resolved) ? FALLBACK_MODE : resolved;
}

// Keep lighting values safe at both application and device boundaries. The
// application always holds a firmware effect from 1–44; only isOn:false emits
// the wire-level zero value that disables keyboard lighting.
export function normalizeLighting(lighting = {}, fallback = {}) {
  return {
    isOn: typeof lighting.isOn === "boolean"
      ? lighting.isOn
      : (typeof fallback.isOn === "boolean" ? fallback.isOn : true),
    mode: resolveLightingMode(lighting.mode, fallback.mode ?? 1),
    brightness: boundedInteger(lighting.brightness, 0, 100, fallback.brightness ?? 80),
    speed: boundedInteger(lighting.speed, 0, 100, fallback.speed ?? 50),
    hue: boundedInteger(lighting.hue, 0, 359, fallback.hue ?? 0),
    saturation: boundedInteger(lighting.saturation, 0, 100, fallback.saturation ?? 100),
  };
}

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

// Single source of truth for digital previews/readouts: the 8-bit values the
// firmware actually receives for hue, saturation, brightness, and speed.
// This is wire quantization, not physical LED/monitor colorimetric calibration.
export function lightingWirePreview(lighting = {}, fallback = {}) {
  const base = normalizeLighting(lighting, fallback);
  const wireColor = colorToWire(base.hue, base.saturation);
  const color = colorFromWire(wireColor.hue, wireColor.saturation);
  return {
    ...base,
    brightness: pctFromWire(pctToWire(base.brightness)),
    speed: pctFromWire(pctToWire(base.speed)),
    // colorFromWire can yield 360 at the top of the byte range; HSV wraps it.
    hue: color.hue % 360,
    saturation: color.saturation,
  };
}
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

// The firmware stores keys in an 8 × 9 switch matrix. These positions are
// ordered by the keyboard drawing (k_0 … k_67), not by matrix offset.
// Five matrix cells are unused and must remain zero-filled.
export const LOGICAL_MATRIX_POSITIONS = Object.freeze([
  [0, 0], [1, 0], [0, 1], [2, 1], [0, 2], [2, 2], [0, 3], [2, 3],
  [0, 4], [1, 4], [0, 5], [1, 5], [1, 6], [1, 7], [0, 8], [3, 0],
  [2, 0], [1, 1], [3, 2], [1, 2], [3, 3], [1, 3], [3, 4], [2, 4],
  [3, 5], [2, 5], [0, 6], [0, 7], [3, 8], [1, 8], [5, 0], [5, 1],
  [4, 1], [5, 2], [4, 2], [5, 3], [5, 4], [4, 4], [5, 5], [4, 5],
  [3, 6], [2, 6], [2, 7], [2, 8], [4, 0], [6, 1], [7, 2], [7, 3],
  [6, 3], [4, 3], [6, 4], [7, 5], [6, 5], [5, 6], [4, 6], [5, 7],
  [5, 8], [4, 8], [7, 0], [7, 1], [6, 2], [7, 4], [7, 6], [6, 6],
  [7, 7], [6, 7], [7, 8], [6, 8],
]);

export function logicalIndexToMatrix(index) {
  const value = LOGICAL_MATRIX_POSITIONS[index];
  return value ? { row: value[0], col: value[1] } : null;
}

export function matrixIndexToLogical(matrixIndex) {
  const safeIndex = Number(matrixIndex);
  return LOGICAL_MATRIX_POSITIONS.findIndex(([row, col]) =>
    row * 9 + col === safeIndex
  );
}

export function logicalValuesToMatrix(values = [], fallback = 0) {
  const result = Array(MATRIX_KEY_COUNT).fill(fallback);
  for (let index = 0; index < KEY_COUNT; index++) {
    const position = logicalIndexToMatrix(index);
    if (!position) continue;
    result[position.row * 9 + position.col] =
      values[index] ?? values[0] ?? fallback;
  }
  return result;
}

export function matrixValuesToLogical(values = [], fallback = 0) {
  return LOGICAL_MATRIX_POSITIONS.map(([row, col]) =>
    values[row * 9 + col] ?? fallback
  );
}

const clampInt = (value, min, max, fallback = min) =>
  Math.max(min, Math.min(max, Number.isFinite(Number(value))
    ? Math.round(Number(value))
    : fallback));

export function normalizeSocdConfig(value = {}) {
  const normalizeKey = (key) =>
    key == null || !Number.isFinite(Number(key)) || Number(key) < 0
      ? null
      : clampInt(key, 0, KEY_COUNT - 1);
  const slots = Array.from({ length: SOCD_SLOT_COUNT }, (_, index) => {
    const slot = value.slots?.[index] || {};
    return {
      mode: clampInt(slot.mode, 0, 4, 0),
      key1: normalizeKey(slot.key1),
      key2: normalizeKey(slot.key2),
      bottomOut: slot.bottomOut === true,
    };
  });
  return { enabled: value.enabled === true, slots };
}

export function encodeMacros(macros = []) {
  const output = [];
  for (let slot = 0; slot < MACRO_COUNT; slot++) {
    for (const action of Array.isArray(macros[slot]) ? macros[slot] : []) {
      if (action.type === "tap" || action.type === "press" ||
        action.type === "release") {
        const type = action.type === "tap" ? 1 : action.type === "press" ? 2 : 3;
        output.push(1, type, clampInt(action.keycode, 0, 255, 128));
      } else if (action.type === "delay") {
        const duration = clampInt(action.duration, 0, 60000, 0);
        output.push(1, 4, ...String(duration).split("").map((n) =>
          n.charCodeAt(0)
        ), 124);
      } else if (action.type === "text") {
        output.push(...Array.from(String(action.text || ""))
          .map((character) => character.charCodeAt(0))
          .filter((code) => code > 4 && code < 128));
      }
    }
    output.push(0);
  }
  if (output.length > 4000) throw new Error("Macros exceed onboard storage");
  return new Uint8Array(output);
}

export function decodeMacros(bytes = []) {
  const macros = Array.from({ length: MACRO_COUNT }, () => []);
  let slot = 0;
  for (let index = 0; index < bytes.length && slot < MACRO_COUNT;) {
    const value = bytes[index++];
    if (value === 0) {
      slot++;
      continue;
    }
    if (value !== 1) {
      let text = String.fromCharCode(value);
      while (index < bytes.length && bytes[index] > 4) {
        text += String.fromCharCode(bytes[index++]);
      }
      if (text) macros[slot].push({ type: "text", text });
      continue;
    }
    const type = bytes[index++];
    if (type >= 1 && type <= 3) {
      const keycode = bytes[index++];
      macros[slot].push({
        type: type === 1 ? "tap" : type === 2 ? "press" : "release",
        keycode,
      });
    } else if (type === 4) {
      let digits = "";
      while (index < bytes.length && bytes[index] !== 124) {
        digits += String.fromCharCode(bytes[index++]);
      }
      index++;
      macros[slot].push({
        type: "delay",
        duration: clampInt(Number.parseInt(digits, 10), 0, 60000, 0),
      });
    } else {
      throw new Error("Keyboard returned an unknown macro action");
    }
  }
  return macros;
}

// Rich command IDs must match their complete prefix. Some older firmware
// replies to one-byte commands with only the command byte; that compatibility
// path is safe only for commands whose ID itself is one byte long.
export function responseMatchesCommand(bytes, id, reportedLength = bytes.length) {
  if (!bytes?.length || !id?.length || bytes[0] !== id[0]) return false;
  if (bytes.length >= id.length && same([...bytes.slice(0, id.length)], [...id])) {
    return true;
  }
  return id.length === 1 && reportedLength === 1;
}
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
    const bytes = new Uint8Array(
      event.data.buffer,
      event.data.byteOffset,
      event.data.byteLength,
    );
    if (bytes[0] === 255) {
      this._emit("error", "Device error packet");
      return;
    }
    const item = this._queue[0];
    if (!item) return;
    if (!responseMatchesCommand(bytes, item.id, event.data.byteLength)) return;
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
    return normalizeLighting({
      isOn: mode !== 0,
      mode: mode || 1,
      brightness: pctFromWire(b),
      speed: pctFromWire(s),
      ...color,
    });
  }
  async writeLighting(l) {
    // Zenblade firmware accepts both legacy (7) and current (9) lighting
    // command families. Sending the paired writes keeps v1/v2 and v3 boards
    // in sync; do not collapse these without firmware compatibility testing.
    const lighting = normalizeLighting(l);
    const w = colorToWire(lighting.hue, lighting.saturation),
      mode = lighting.isOn ? lighting.mode : 0;
    for (
      const cmd of [
        [7, 3, 2, mode],
        [9, 3, 2, mode],
        [7, 3, 1, pctToWire(lighting.brightness)],
        [9, 3, 1, pctToWire(lighting.brightness)],
        [7, 3, 3, pctToWire(lighting.speed)],
        [9, 3, 3, pctToWire(lighting.speed)],
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
    const out = new Uint8Array(values.length * 2);
    for (let i = 0; i < values.length; i++) {
      const n = (values[i] ?? values[0] ?? 0) & 0xffff;
      out[i * 2] = n & 255;
      out[i * 2 + 1] = n >> 8;
    }
    return out;
  }
  async _matrix(head, values) {
    const matrixValues = logicalValuesToMatrix(values);
    const p = this._pack(matrixValues);
    for (let i = 0; i * 25 < MATRIX_KEY_COUNT; i++) {
      const count = Math.min(25, MATRIX_KEY_COUNT - i * 25);
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

  async readKeymap() {
    const layers = [];
    for (let layer = 0; layer < LAYER_COUNT; layer++) {
      const matrix = [];
      let offset = layer * MATRIX_KEY_COUNT * 2;
      for (const length of [56, 56, 32]) {
        const bytes = await this.execute(
          [18, offset >> 8, offset & 255, length],
          4,
        );
        matrix.push(...bytes.slice(0, length));
        offset += length;
      }
      const values = [];
      for (let index = 0; index < MATRIX_KEY_COUNT; index++) {
        values.push((matrix[index * 2] << 8) | matrix[index * 2 + 1]);
      }
      layers.push(matrixValuesToLogical(values));
    }
    return layers;
  }

  async writeKeymapKey(layer, logicalIndex, keycode) {
    const safeLayer = clampInt(layer, 0, LAYER_COUNT - 1);
    const safeIndex = clampInt(logicalIndex, 0, KEY_COUNT - 1);
    if (safeIndex === 0) throw new Error("Escape cannot be remapped by firmware");
    const position = logicalIndexToMatrix(safeIndex);
    const value = clampInt(keycode, 0, 0xffff);
    await this.execute([
      5,
      safeLayer,
      position.row,
      position.col,
      value >> 8,
      value & 255,
    ], 4);
    return value;
  }

  async readSocd(profile = 0) {
    const safeProfile = clampInt(profile, 0, PROFILE_COUNT - 1);
    const enabled = (await this.execute([48, 1, safeProfile], 3))[0] === 1;
    const modes = await this.execute([48, 2, safeProfile], 3);
    const keys = await this.execute([48, 3, safeProfile], 3);
    const bottom = await this.execute([48, 4, safeProfile], 3);
    const readKey = (value) => {
      if (value === 255) return null;
      const index = matrixIndexToLogical(value);
      return index < 0 ? null : index;
    };
    return normalizeSocdConfig({
      enabled,
      slots: Array.from({ length: SOCD_SLOT_COUNT }, (_, index) => ({
        mode: modes[index] ?? 0,
        key1: readKey(keys[index * 2]),
        key2: readKey(keys[index * 2 + 1]),
        bottomOut: bottom[index] === 1,
      })),
    });
  }

  async writeSocd(profile, config) {
    const safeProfile = clampInt(profile, 0, PROFILE_COUNT - 1);
    const value = normalizeSocdConfig(config);
    const modes = new Uint8Array(SOCD_SLOT_COUNT);
    const keys = new Uint8Array(SOCD_SLOT_COUNT * 2).fill(255);
    const bottom = new Uint8Array(SOCD_SLOT_COUNT);
    value.slots.forEach((slot, index) => {
      modes[index] = slot.mode;
      for (const [keyOffset, logicalIndex] of [slot.key1, slot.key2].entries()) {
        if (logicalIndex == null) continue;
        const position = logicalIndexToMatrix(logicalIndex);
        keys[index * 2 + keyOffset] = position.row * 9 + position.col;
      }
      bottom[index] = slot.bottomOut ? 1 : 0;
    });
    await this.execute([49, 1, safeProfile, value.enabled ? 1 : 0], 3);
    await this.execute([49, 2, safeProfile, ...modes], 3);
    await this.execute([49, 3, safeProfile, ...keys], 3);
    await this.execute([49, 4, safeProfile, ...bottom], 3);
    await this.execute([33, 243], 2);
    return value;
  }

  async readMacros() {
    const bytes = [];
    for (let offset = 0; offset < 4080; offset += 60) {
      const result = await this.execute(
        [14, offset >> 8, offset & 255, 60],
        5,
      );
      bytes.push(...result.slice(0, 60));
    }
    return decodeMacros(bytes);
  }

  async writeMacros(macros) {
    const bytes = encodeMacros(macros);
    for (let offset = 0; offset < bytes.length; offset += 60) {
      const length = Math.min(60, bytes.length - offset);
      await this.execute([
        15,
        offset >> 8,
        offset & 255,
        length,
        ...bytes.slice(offset, offset + length),
      ], 5);
    }
    return decodeMacros(bytes);
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
