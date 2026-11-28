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
  const global = state.actuation;
  const pressValues = Array(keyCount).fill(global.press);
  const releaseValues = Array(keyCount).fill(global.release);
  const rapidTriggerValues = Array(keyCount).fill(global.rapidTrigger !== false);
  const continuousValues = Array(keyCount).fill(
    global.continuousRapidTrigger === true,
  );
  for (const [code, value] of Object.entries(state.keyOverrides)) {
    const index = indexForCode(code);
    if (index != null) {
      pressValues[index] = value.press;
      releaseValues[index] = value.release;
      if (typeof value.rapidTrigger === "boolean") {
        rapidTriggerValues[index] = value.rapidTrigger;
      }
      if (typeof value.continuousRapidTrigger === "boolean") {
        continuousValues[index] = value.continuousRapidTrigger;
      }
    }
  }
  // Continuous mode only applies on keys that use Rapid Trigger.
  continuousValues.forEach((on, index) => {
    continuousValues[index] = on && rapidTriggerValues[index];
  });
  return { pressValues, releaseValues, rapidTriggerValues, continuousValues };
}

export function profileApplyComplete(result) {
  return !!result?.deviceProfileOk && !!result?.lightingOk &&
    !!result?.feelOk && result?.systemOk !== false;
}

export async function applyProfile(kb, state, writeFeel, writeSystem) {
  const result = {
    deviceProfileOk: false,
    lightingOk: false,
    feelOk: false,
    systemOk: !writeSystem,
  };
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
  if (writeSystem) {
    try {
      await writeSystem();
      result.systemOk = true;
    } catch (error) {
      result.systemError = error;
    }
  }
  return result;
}
