// Firmware mode IDs are fixed and must not be renumbered. Mode 2 (Alpha Mods)
// is unsupported in this app and is omitted from selectable lists; reads and
// persisted values normalize to Solid (mode 1) in protocol.normalizeLighting.
const modeDefs = [
  { id: 1, name: "Solid" },
  { id: 3, name: "Gradient V" },
  { id: 4, name: "Gradient H" },
  { id: 5, name: "Breathing" },
  { id: 6, name: "Band Sat" },
  { id: 7, name: "Band Value" },
  { id: 8, name: "Pinwheel Sat" },
  { id: 9, name: "Pinwheel Val" },
  { id: 10, name: "Spiral Sat" },
  { id: 11, name: "Spiral Val" },
  { id: 12, name: "Cycle All" },
  { id: 13, name: "Cycle H" },
  { id: 14, name: "Cycle V" },
  { id: 15, name: "Rainbow Chevron" },
  { id: 16, name: "Cycle Out/In" },
  { id: 17, name: "Cycle Out/In Dual" },
  { id: 18, name: "Cycle Pinwheel" },
  { id: 19, name: "Cycle Spiral" },
  { id: 20, name: "Dual Beacon" },
  { id: 21, name: "Rainbow Beacon" },
  { id: 22, name: "Rainbow Pinwheels" },
  { id: 23, name: "Raindrops" },
  { id: 24, name: "Jellybean Rain" },
  { id: 25, name: "Hue Breathing" },
  { id: 26, name: "Hue Pendulum" },
  { id: 27, name: "Hue Wave" },
  { id: 28, name: "Pixel Rain" },
  { id: 29, name: "Pixel Flow" },
  { id: 30, name: "Pixel Fractal" },
  { id: 31, name: "Typing Heatmap" },
  { id: 32, name: "Digital Rain" },
  { id: 33, name: "Reactive Simple" },
  { id: 34, name: "Solid Reactive" },
  { id: 35, name: "Reactive Wide" },
  { id: 36, name: "Reactive Multi Wide" },
  { id: 37, name: "Reactive Cross" },
  { id: 38, name: "Reactive Multi Cross" },
  { id: 39, name: "Reactive Nexus" },
  { id: 40, name: "Reactive Multi Nexus" },
  { id: 41, name: "Splash" },
  { id: 42, name: "Multi Splash" },
  { id: 43, name: "Solid Splash" },
  { id: 44, name: "Solid Multi Splash" },
];

const colorModes = new Set([
  1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20, 21, 22, 25, 26, 27, 30, 33, 34, 35, 36,
  37, 38, 39, 40, 41, 42, 43, 44,
]);
const speedModes = new Set([
  5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 25, 26, 27,
  28, 29, 30, 31, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44,
]);
// Modes that use a single base colour (not multi-hue firmware palettes / gradients).
const singleColorModes = new Set([
  1, 5, 6, 7, 25, 31, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44,
]);
const gradientEndpointModes = new Set([3, 4]);

export const UNSUPPORTED_LIGHT_MODES = new Set([2]);
export const FALLBACK_LIGHT_MODE = 1;

export const LIGHT_CATEGORIES = ["All", "Static", "Gradient", "Motion", "Reactive"];
export const categoryForMode = (id) =>
  id <= 1 ? "Static" : id <= 22 ? "Gradient" : id <= 30 ? "Motion" : "Reactive";

export const LIGHT_MODES = modeDefs.map((def) => ({
  ...def,
  category: categoryForMode(def.id),
  rainbow: !singleColorModes.has(def.id) && !gradientEndpointModes.has(def.id),
  // The firmware accepts a speed byte for every mode, but only these effects
  // actually animate. Keep that capability explicit for the UI.
  usesSpeed: speedModes.has(def.id),
  usesColor: colorModes.has(def.id),
  singleColor: singleColorModes.has(def.id),
  gradientEndpoints: gradientEndpointModes.has(def.id),
  params: [
    "brightness",
    ...(speedModes.has(def.id) ? ["speed"] : []),
    ...(colorModes.has(def.id) ? ["color"] : []),
  ],
}));

export const modesForCategory = (category = "All") =>
  category === "All"
    ? LIGHT_MODES
    : LIGHT_MODES.filter((mode) => mode.category === category);

export const categorySelectionState = (category, selectedModeId) => {
  const modes = modesForCategory(category);
  const selectedVisible = modes.some((mode) => mode.id === selectedModeId);
  return {
    modes,
    selectedVisible,
    tabStopId: selectedVisible ? selectedModeId : modes[0]?.id ?? null,
  };
};

export const modeById = (id) =>
  LIGHT_MODES.find((mode) => mode.id === id) || LIGHT_MODES[0];
