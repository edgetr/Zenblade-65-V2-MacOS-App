export const ROWS = [
  [
    { code: "ESC", label: "esc", w: 1 },
    { code: "1", label: "1", w: 1 },
    { code: "2", label: "2", w: 1 },
    { code: "3", label: "3", w: 1 },
    { code: "4", label: "4", w: 1 },
    { code: "5", label: "5", w: 1 },
    { code: "6", label: "6", w: 1 },
    { code: "7", label: "7", w: 1 },
    { code: "8", label: "8", w: 1 },
    { code: "9", label: "9", w: 1 },
    { code: "0", label: "0", w: 1 },
    { code: "MINUS", label: "–", w: 1 },
    { code: "EQUAL", label: "=", w: 1 },
    { code: "BSPC", label: "⌫", w: 2 },
    { code: "HOME", label: "hm", w: 1 },
  ],
  [
    { code: "TAB", label: "tab", w: 1.5 },
    { code: "Q", label: "Q", w: 1 },
    { code: "W", label: "W", w: 1 },
    { code: "E", label: "E", w: 1 },
    { code: "R", label: "R", w: 1 },
    { code: "T", label: "T", w: 1 },
    { code: "Y", label: "Y", w: 1 },
    { code: "U", label: "U", w: 1 },
    { code: "I", label: "I", w: 1 },
    { code: "O", label: "O", w: 1 },
    { code: "P", label: "P", w: 1 },
    { code: "LBRC", label: "[", w: 1 },
    { code: "RBRC", label: "]", w: 1 },
    { code: "BSLS", label: "\\", w: 1.5 },
    { code: "PGUP", label: "pu", w: 1 },
  ],
  [
    { code: "CAPS", label: "caps", w: 1.75 },
    { code: "A", label: "A", w: 1 },
    { code: "S", label: "S", w: 1 },
    { code: "D", label: "D", w: 1 },
    { code: "F", label: "F", w: 1 },
    { code: "G", label: "G", w: 1 },
    { code: "H", label: "H", w: 1 },
    { code: "J", label: "J", w: 1 },
    { code: "K", label: "K", w: 1 },
    { code: "L", label: "L", w: 1 },
    { code: "SCLN", label: ";", w: 1 },
    { code: "QUOT", label: "'", w: 1 },
    { code: "ENT", label: "↵", w: 2.25 },
    { code: "PGDN", label: "pd", w: 1 },
  ],
  [
    { code: "LSFT", label: "shift", w: 2.25 },
    { code: "Z", label: "Z", w: 1 },
    { code: "X", label: "X", w: 1 },
    { code: "C", label: "C", w: 1 },
    { code: "V", label: "V", w: 1 },
    { code: "B", label: "B", w: 1 },
    { code: "N", label: "N", w: 1 },
    { code: "M", label: "M", w: 1 },
    { code: "COMM", label: ",", w: 1 },
    { code: "DOT", label: ".", w: 1 },
    { code: "SLSH", label: "/", w: 1 },
    { code: "RSFT", label: "shift", w: 1.75 },
    { code: "UP", label: "↑", w: 1 },
    { code: "END", label: "end", w: 1 },
  ],
  [
    { code: "LCTL", label: "ctrl", w: 1.25 },
    { code: "LALT", label: "opt", w: 1.25 },
    { code: "LGUI", label: "cmd", w: 1.25 },
    { code: "SPC", label: "", w: 6.25 },
    { code: "RGUI", label: "cmd", w: 1.25 },
    { code: "RALT", label: "opt", w: 1.25 },
    { code: "LEFT", label: "←", w: 1 },
    { code: "DOWN", label: "↓", w: 1 },
    { code: "RGHT", label: "→", w: 1 },
  ],
];

export const CODE_TO_MATRIX_INDEX = Object.freeze({
  ESC: 0,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "0": 10,
  MINUS: 11,
  EQUAL: 12,
  BSPC: 13,
  HOME: 14,
  TAB: 15,
  Q: 16,
  W: 17,
  E: 18,
  R: 19,
  T: 20,
  Y: 21,
  U: 22,
  I: 23,
  O: 24,
  P: 25,
  LBRC: 26,
  RBRC: 27,
  BSLS: 28,
  PGUP: 29,
  CAPS: 30,
  A: 31,
  S: 32,
  D: 33,
  F: 34,
  G: 35,
  H: 36,
  J: 37,
  K: 38,
  L: 39,
  SCLN: 40,
  QUOT: 41,
  ENT: 42,
  PGDN: 43,
  LSFT: 44,
  Z: 45,
  X: 46,
  C: 47,
  V: 48,
  B: 49,
  N: 50,
  M: 51,
  COMM: 52,
  DOT: 53,
  SLSH: 54,
  RSFT: 55,
  UP: 56,
  END: 57,
  LCTL: 58,
  LALT: 59,
  LGUI: 60,
  SPC: 61,
  RGUI: 62,
  RALT: 63,
  LEFT: 64,
  DOWN: 65,
  RGHT: 66,
});

export const LAYOUT_KEY_COUNT = Object.keys(CODE_TO_MATRIX_INDEX).length;

(() => {
  const fromRows = new Set();
  for (const row of ROWS) {
    for (const key of row) {
      if (fromRows.has(key.code)) {
        throw new Error(`Duplicate key code in ROWS: ${key.code}`);
      }
      fromRows.add(key.code);
      if (CODE_TO_MATRIX_INDEX[key.code] == null) {
        throw new Error(`ROWS code missing from CODE_TO_MATRIX_INDEX: ${key.code}`);
      }
    }
  }
  for (const code of Object.keys(CODE_TO_MATRIX_INDEX)) {
    if (!fromRows.has(code)) {
      throw new Error(`CODE_TO_MATRIX_INDEX has unknown code: ${code}`);
    }
  }
  const idxs = Object.values(CODE_TO_MATRIX_INDEX);
  if (new Set(idxs).size !== idxs.length) {
    throw new Error("CODE_TO_MATRIX_INDEX has duplicate matrix indices");
  }
})();
