import { CODE_TO_MATRIX_INDEX, ROWS } from "./layout.js";

const labels = Object.fromEntries(
  ROWS.flat().map((key) => [key.code, key.label || key.code]),
);

export const PHYSICAL_KEYS = Object.freeze(
  Object.entries(CODE_TO_MATRIX_INDEX)
    .sort((a, b) => a[1] - b[1])
    .map(([code, index]) => ({
      code,
      index,
      label: labels[code] || code,
    })),
);

const letters = Array.from({ length: 26 }, (_, index) => ({
  value: 4 + index,
  label: String.fromCharCode(65 + index),
}));
const digits = "1234567890".split("").map((label, index) => ({
  value: 30 + index,
  label,
}));

export const HID_ASSIGNMENTS = Object.freeze([
  { value: 1, label: "Disabled" },
  ...letters,
  ...digits,
  { value: 40, label: "Enter" },
  { value: 41, label: "Escape" },
  { value: 42, label: "Backspace" },
  { value: 43, label: "Tab" },
  { value: 44, label: "Space" },
  { value: 45, label: "Minus" },
  { value: 46, label: "Equal" },
  { value: 47, label: "Left bracket" },
  { value: 48, label: "Right bracket" },
  { value: 49, label: "Backslash" },
  { value: 51, label: "Semicolon" },
  { value: 52, label: "Quote" },
  { value: 53, label: "Grave" },
  { value: 54, label: "Comma" },
  { value: 55, label: "Period" },
  { value: 56, label: "Slash" },
  { value: 57, label: "Caps Lock" },
  ...Array.from({ length: 12 }, (_, index) => ({
    value: 58 + index,
    label: `F${index + 1}`,
  })),
  { value: 73, label: "Insert" },
  { value: 74, label: "Home" },
  { value: 75, label: "Page Up" },
  { value: 76, label: "Delete" },
  { value: 77, label: "End" },
  { value: 78, label: "Page Down" },
  { value: 79, label: "Right Arrow" },
  { value: 80, label: "Left Arrow" },
  { value: 81, label: "Down Arrow" },
  { value: 82, label: "Up Arrow" },
  { value: 224, label: "Left Control" },
  { value: 225, label: "Left Shift" },
  { value: 226, label: "Left Option" },
  { value: 227, label: "Left Command" },
  { value: 228, label: "Right Control" },
  { value: 229, label: "Right Shift" },
  { value: 230, label: "Right Option" },
  { value: 231, label: "Right Command" },
  { value: 32262, label: "Switch to Profile 1" },
  { value: 32263, label: "Switch to Profile 2" },
  { value: 32264, label: "Switch to Profile 3" },
  { value: 32265, label: "Cycle Profiles" },
  { value: 32260, label: "Cycle Light Color" },
  { value: 30758, label: "Cycle Light Effects" },
  { value: 30759, label: "Light Brightness Up" },
  { value: 30760, label: "Light Brightness Down" },
  { value: 30761, label: "Light Speed Up" },
  { value: 30762, label: "Light Speed Down" },
  ...Array.from({ length: 16 }, (_, index) => ({
    value: 30464 + index,
    label: `Macro ${index + 1}`,
  })),
]);

export const HID_BY_VALUE = new Map(
  HID_ASSIGNMENTS.map((item) => [item.value, item]),
);

export const EVENT_CODE_TO_HID = Object.freeze({
  ...Object.fromEntries(letters.map((item) => [`Key${item.label}`, item.value])),
  ...Object.fromEntries(digits.map((item) => [
    `Digit${item.label}`,
    item.value,
  ])),
  Enter: 40,
  Escape: 41,
  Backspace: 42,
  Tab: 43,
  Space: 44,
  Minus: 45,
  Equal: 46,
  BracketLeft: 47,
  BracketRight: 48,
  Backslash: 49,
  Semicolon: 51,
  Quote: 52,
  Backquote: 53,
  Comma: 54,
  Period: 55,
  Slash: 56,
  CapsLock: 57,
  ArrowRight: 79,
  ArrowLeft: 80,
  ArrowDown: 81,
  ArrowUp: 82,
  ControlLeft: 224,
  ShiftLeft: 225,
  AltLeft: 226,
  MetaLeft: 227,
  ControlRight: 228,
  ShiftRight: 229,
  AltRight: 230,
  MetaRight: 231,
});

export const LAYER_NAMES = Object.freeze([
  "Base",
  "Fn 1",
  "Fn 2",
  "Mac",
  "Fn 3",
  "Fn 4",
]);

export function describeHid(value) {
  return HID_BY_VALUE.get(Number(value))?.label ||
    `Unknown (0x${Number(value).toString(16).toUpperCase()})`;
}
