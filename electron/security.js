const { pathToFileURL } = require("node:url");
const { vendorId, productIds } = require("../shared/device-ids.json");

function createRendererSecurity(rendererPath, getContents) {
  const rendererUrl = pathToFileURL(rendererPath).href;
  const trustedUrl = (url) => {
    try {
      const parsed = new URL(url);
      parsed.hash = "";
      return parsed.href === rendererUrl;
    } catch {
      return false;
    }
  };
  const trustedContents = (contents) => Boolean(
    contents && contents === getContents() && !contents.isDestroyed() &&
    trustedUrl(contents.getURL()),
  );
  const trustedFrame = (frame) => {
    const contents = getContents();
    return Boolean(trustedContents(contents) && frame &&
      frame === contents.mainFrame && trustedUrl(frame.url));
  };
  const trustedSender = (event) =>
    trustedContents(event.sender) && trustedFrame(event.senderFrame);
  const supportedDevice = (device) => device?.vendorId === vendorId &&
    productIds.includes(device?.productId);

  return {
    trustedSender,
    handle(ipc, channel, handler) {
      ipc.handle(channel, (event, ...args) => {
        if (!trustedSender(event)) throw new Error("Untrusted renderer");
        return handler(event, ...args);
      });
    },
    protectWindow(contents) {
      // This utility has no external links, embedded pages, or extra windows.
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
      contents.on("will-navigate", (event) => event.preventDefault());
      contents.on("will-frame-navigate", (event) => event.preventDefault());
      contents.on("will-attach-webview", (event) => event.preventDefault());
    },
    configureSession(ses) {
      ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      ses.setPermissionCheckHandler((contents, permission, _origin, details) =>
        permission === "hid" && trustedContents(contents) &&
        details.isMainFrame === true && trustedUrl(details.requestingUrl),
      );
      ses.setDevicePermissionHandler((details) =>
        details.deviceType === "hid" && details.origin === "file://" &&
        trustedContents(getContents()) && supportedDevice(details.device),
      );
      ses.on("select-hid-device", (event, details, callback) => {
        event.preventDefault();
        if (!trustedFrame(details.frame)) return callback("");
        callback(details.deviceList.find(supportedDevice)?.deviceId || "");
      });
    },
  };
}

module.exports = { createRendererSecurity };
