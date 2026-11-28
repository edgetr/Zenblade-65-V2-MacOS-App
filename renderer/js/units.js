// Actuation distances are stored in firmware units of 0.1 mm (1–40 → 0.1–4.0 mm).
export const formatMm = (value, { unit = true } = {}) => {
  const mm = (Number(value) / 10).toFixed(1);
  return unit ? `${mm} mm` : mm;
};
