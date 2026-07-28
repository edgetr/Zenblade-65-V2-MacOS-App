const { execFile } = require("child_process");
const path = require("path");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

function helperPath({ packaged = false, resourcesPath = process.resourcesPath } = {}) {
  return packaged
    ? path.join(resourcesPath, "zenbridge")
    : path.join(__dirname, "..", "build", "zenbridge");
}

async function executeJson(file, args, { allowFailure = false } = {}) {
  try {
    const { stdout } = await execFileAsync(file, args, {
      timeout: 5000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    const value = JSON.parse(String(stdout || "{}"));
    if (!allowFailure && value.ok !== true) {
      throw new Error(value.error || "Native operation failed");
    }
    return value;
  } catch (error) {
    if (allowFailure && error.stdout) {
      try {
        return JSON.parse(String(error.stdout));
      } catch {
        /* fall through */
      }
    }
    throw error;
  }
}

function normalizeDetectors(values) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = String(value?.id || "").trim().slice(0, 80);
    const match = String(value?.match || "").trim().toLowerCase().slice(0, 80);
    if (!id || !match || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, match });
  }
  return result;
}

function normalizeAudio(value = {}) {
  return {
    ...value,
    micMuted: value.micMuted === true || value.micMuted === 1,
    canMuteInput: value.canMuteInput === true || value.canMuteInput === 1,
    devices: (Array.isArray(value.devices) ? value.devices : []).map((device) => ({
      ...device,
      input: device.input === true || device.input === 1,
      output: device.output === true || device.output === 1,
      defaultInput: device.defaultInput === true || device.defaultInput === 1,
      defaultOutput: device.defaultOutput === true || device.defaultOutput === 1,
    })),
  };
}

async function scanProcesses(detectors) {
  const normalized = normalizeDetectors(detectors);
  if (!normalized.length) return {};
  const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,comm=,args="], {
    timeout: 3000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const haystack = String(stdout || "").toLowerCase();
  return Object.fromEntries(normalized.map((detector) => {
    const terms = detector.match.split(",").map((term) => term.trim()).filter(Boolean);
    return [detector.id, terms.some((term) => haystack.includes(term))];
  }));
}

function createSystemBridge(options = {}) {
  const executable = helperPath(options);
  let lastInputVolume = 0.75;
  let actionQueue = Promise.resolve();

  const status = async () => {
    const result = await executeJson(executable, ["status"]);
    const audio = normalizeAudio(result.audio);
    const volume = Number(audio.inputVolume);
    if (Number.isFinite(volume) && volume > 0.01) lastInputVolume = volume;
    return audio;
  };

  const setInput = async (uid) => {
    if (!uid) throw new Error("Choose a microphone first");
    await executeJson(executable, ["set-input", String(uid)]);
  };

  const setOutput = async (uid) => {
    if (!uid) throw new Error("Choose an audio output first");
    await executeJson(executable, ["set-output", String(uid)]);
  };

  const setMicMuted = async (muted) => {
    await executeJson(executable, [
      "set-mic-muted",
      muted ? "true" : "false",
      String(lastInputVolume),
    ]);
  };

  const perform = async (value = {}) => {
    const action = String(value.action || "");
    if (action === "microphone-toggle") {
      const current = await status();
      await setMicMuted(!current.micMuted);
    } else if (action === "set-input") {
      await setInput(value.inputUid);
    } else if (action === "set-output") {
      await setOutput(value.outputUid);
    } else if (action === "meeting-mode") {
      if (value.outputUid) await setOutput(value.outputUid);
      if (value.inputUid) await setInput(value.inputUid);
      await setMicMuted(false);
    } else {
      throw new Error("Unsupported desktop action");
    }
    return status();
  };

  return {
    executable,
    status,
    getContext: async (detectors) => {
      const [audio, processes] = await Promise.all([
        status(),
        scanProcesses(detectors),
      ]);
      return { audio, processes, observedAt: Date.now() };
    },
    perform: (value) => {
      actionQueue = actionQueue.then(
        () => perform(value),
        () => perform(value),
      );
      return actionQueue;
    },
  };
}

module.exports = {
  createSystemBridge,
  helperPath,
  normalizeAudio,
  normalizeDetectors,
  scanProcesses,
};
