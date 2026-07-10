export class DeviceOperationGate {
  constructor({ toast, onStateChange } = {}) {
    this.toast = toast;
    this.onStateChange = onStateChange;
    this.running = false;
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
    this.onStateChange?.();
    try {
      return await task();
    } finally {
      this.running = false;
      this.onStateChange?.();
    }
  }
}

export function buildActuationMatrix(state, keyCount, indexForCode) {
  const pressValues = Array(keyCount).fill(state.actuation.press);
  const releaseValues = Array(keyCount).fill(state.actuation.release);
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
