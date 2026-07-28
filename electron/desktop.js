const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const EXEC_OPTIONS = {
  timeout: 1500,
  maxBuffer: 256 * 1024,
};

function parseFrontApplication(text) {
  const name = String(text || "").match(/^"([^"]+)"/m)?.[1] || "";
  const bundleId = String(text || "").match(/\bbundleID="([^"]+)"/)?.[1] || "";
  return bundleId ? { bundleId, name: name || bundleId } : null;
}

async function getFrontApplication() {
  if (process.platform !== "darwin") return null;
  const { stdout: front } = await execFileAsync(
    "/usr/bin/lsappinfo",
    ["front"],
    EXEC_OPTIONS,
  );
  const asn = String(front).match(/ASN:[^\s]+/)?.[0];
  if (!asn) return null;
  const { stdout: info } = await execFileAsync("/usr/bin/lsappinfo", [
    "info",
    "-only",
    "bundleID,name",
    asn,
  ], EXEC_OPTIONS);
  return parseFrontApplication(info);
}

async function plistValue(plist, key) {
  try {
    const { stdout } = await execFileAsync("/usr/bin/plutil", [
      "-extract",
      key,
      "raw",
      plist,
    ], EXEC_OPTIONS);
    return String(stdout).trim();
  } catch {
    return "";
  }
}

async function readApplicationMetadata(appPath) {
  if (path.extname(appPath).toLowerCase() !== ".app") return null;
  const plist = path.join(appPath, "Contents", "Info.plist");
  const bundleId = await plistValue(plist, "CFBundleIdentifier");
  if (!bundleId) return null;
  const displayName = await plistValue(plist, "CFBundleDisplayName");
  const bundleName = await plistValue(plist, "CFBundleName");
  return {
    bundleId,
    name: displayName || bundleName || path.basename(appPath, ".app"),
  };
}

function assertSupportedProfileFile(value) {
  const isRecord = (item) =>
    item && typeof item === "object" && !Array.isArray(item);
  if (
    !isRecord(value) ||
    value.format !== "zenblade-profile" ||
    value.version !== 1 ||
    !isRecord(value.profile) ||
    !isRecord(value.profile.lighting) ||
    !isRecord(value.profile.actuation) ||
    !isRecord(value.profile.keyOverrides) ||
    !isRecord(value.profile.appNotes)
  ) {
    throw new Error("This is not a supported Zenblade profile");
  }
  return value;
}

module.exports = {
  assertSupportedProfileFile,
  getFrontApplication,
  parseFrontApplication,
  readApplicationMetadata,
};
