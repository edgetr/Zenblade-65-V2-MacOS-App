export class DeviceOperationGate {
  constructor({ toast, controls = () => [] } = {}) {
    this.toast = toast;
    this.controls = controls;
    this.running = false;
    this.preserveCurrentState = this.preserveCurrentState.bind(this);
  }
  async run(label, task) {
    if (this.running) {
      const error = new Error(
        `${label} is waiting for the current device operation`,
      );
      this.toast?.(error.message, "error");
      throw error;
    }
    this.running = true;
    this.controlStateChanged = false;
    const controls = [...this.controls()];
    controls.forEach((el) => {
      if (!el) return;
      el.dataset.busyLabel ||= el.textContent;
      el.disabled = true;
      el.textContent = "Working…";
    });
    try {
      return await task();
    } finally {
      this.running = false;
      controls.forEach((el) => {
        if (!el) return;
        // Connection changes can disable controls while an operation is in
        // flight. In that case the caller owns the final disabled state.
        if (!this.controlStateChanged) el.disabled = false;
        if (el.dataset.busyLabel) el.textContent = el.dataset.busyLabel;
      });
    }
  }
  preserveCurrentState() {
    this.controlStateChanged = true;
  }
}
export function buildActuationMatrix(state, keyCount, indexForCode) {
  const pressValues = Array(keyCount).fill(state.actuation.press),
    releaseValues = Array(keyCount).fill(state.actuation.release);
  for (const [code, value] of Object.entries(state.keyOverrides)) {
    const index = indexForCode(code);
    if (index != null) {
      pressValues[index] = value.press;
      releaseValues[index] = value.release;
    }
  }
  return { pressValues, releaseValues };
}
export async function applyProfile(kb, state, writeFeel) {
  const result = { deviceProfileOk: false, lightingOk: false, feelOk: false };
  try {
    await kb.writeProfile(state.profile);
    result.deviceProfileOk = true;
  } catch (error) {
    result.error = error;
    return result;
  }
  try {
    await kb.writeLighting(state.lighting);
    result.lightingOk = true;
  } catch (error) {
    result.lightingError = error;
  }
  try {
    await writeFeel();
    result.feelOk = true;
  } catch (error) {
    result.feelError = error;
  }
  return result;
}
