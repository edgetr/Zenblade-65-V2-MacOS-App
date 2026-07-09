const names = ["Solid", "Alpha Mods", "Gradient V", "Gradient H", "Breathing", "Band Sat", "Band Value", "Pinwheel Sat", "Pinwheel Val", "Spiral Sat", "Spiral Val", "Cycle All", "Cycle H", "Cycle V", "Rainbow Chevron", "Cycle Out/In", "Cycle Out/In Dual", "Cycle Pinwheel", "Cycle Spiral", "Dual Beacon", "Rainbow Beacon", "Rainbow Pinwheels", "Raindrops", "Jellybean Rain", "Hue Breathing", "Hue Pendulum", "Hue Wave", "Pixel Rain", "Pixel Flow", "Pixel Fractal", "Typing Heatmap", "Digital Rain", "Reactive Simple", "Solid Reactive", "Reactive Wide", "Reactive Multi Wide", "Reactive Cross", "Reactive Multi Cross", "Reactive Nexus", "Reactive Multi Nexus", "Splash", "Multi Splash", "Solid Splash", "Solid Multi Splash"];
const colorModes = new Set([1,2,3,4,5,6,7,8,9,10,11,12,20,21,22,25,26,27,30,33,34,35,36,37,38,39,40,41,42,43,44]);
const speedModes = new Set([5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,25,26,27,28,29,30,31,33,34,35,36,37,38,39,40,41,42,43,44]);

export const LIGHT_CATEGORIES = ["All", "Static", "Gradient", "Motion", "Reactive"];
export const categoryForMode = (id) =>
  id <= 2 ? "Static" : id <= 22 ? "Gradient" : id <= 30 ? "Motion" : "Reactive";

// Firmware IDs are intentionally explicit here; preview recipes live separately.
export const LIGHT_MODES = names.map((name, index) => ({
  id: index + 1,
  name,
  category: categoryForMode(index + 1),
  rainbow: ![1, 2, 5, 6, 7, 25, 31, ...Array.from({ length: 12 }, (_, n) => n + 33)].includes(index + 1),
  params: ["brightness", ...(speedModes.has(index + 1) ? ["speed"] : []), ...(colorModes.has(index + 1) ? ["color"] : [])],
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
