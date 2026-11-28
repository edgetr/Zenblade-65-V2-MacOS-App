// Native bridge for the Tauri shell. Runs as a classic script before the app
// modules so they find `window.zenShell` (desktop commands and events) and a
// WebHID-compatible `navigator.hid`, the contracts the renderer is built on.
(() => {
  "use strict";
  const tauri = window.__TAURI__;
  if (!tauri?.core || !tauri?.event) return;
  const { invoke, Channel } = tauri.core;
  const { listen } = tauri.event;

  const call = (command, args) =>
    invoke(command, args).catch((error) => {
      throw error instanceof Error ? error : new Error(String(error));
    });

  /** Subscription that returns a synchronous unsubscribe function. */
  const subscribe = (event, map = () => []) => (callback) => {
    let unlisten = null;
    let disposed = false;
    listen(event, (message) => callback(...map(message.payload))).then((off) => {
      if (disposed) off();
      else unlisten = off;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  };
  const payload = (value) => [value];

  Object.defineProperty(window, "zenShell", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: Object.freeze({
      getInfo: () => call("app_get_info"),
      getActiveApplication: () => call("app_get_active_application"),
      chooseApplications: () => call("app_choose_applications"),
      runningApplications: () => call("app_running_applications"),
      getLoginItem: () => call("app_get_login_item"),
      setLoginItem: (enabled) =>
        call("app_set_login_item", { enabled: enabled === true }),
      exportProfile: (data) => call("app_export_profile", { payload: data ?? null }),
      importProfile: (profile) =>
        call("app_import_profile", { targetProfile: profile ?? null }),
      getSystemContext: (detectors) =>
        call("app_get_system_context", { detectors: detectors ?? null }),
      configureSystemShortcuts: (mappings) =>
        call("app_configure_system_shortcuts", { mappings: mappings ?? null }),
      setDesktopState: (state) => {
        call("app_set_desktop_state", { next: state ?? null }).catch(() => {});
      },
      onReconnect: subscribe("app:reconnect"),
      onNavigate: subscribe("app:navigate", payload),
      onSelectProfile: subscribe("app:selectProfile", payload),
      onToggleLights: subscribe("app:toggleLights"),
      onToggleAutomation: subscribe("app:toggleAutomation"),
      onActiveApplication: subscribe("app:activeApplication", payload),
      onWake: subscribe("app:wake"),
      onSuspend: subscribe("app:suspend"),
      onSystemContext: subscribe("app:systemContext", payload),
      onSystemActionError: subscribe("app:systemActionError", payload),
      onLoginItem: subscribe("app:loginItem", payload),
    }),
  });

  // Mirror document.title onto the window (Mission Control, Window menu,
  // accessibility).
  const nativeWindow = tauri.window?.getCurrentWindow?.();
  if (nativeWindow) {
    let lastTitle = null;
    const syncTitle = () => {
      const title = document.title || "Zenblade";
      if (title === lastTitle) return;
      lastTitle = title;
      nativeWindow.setTitle(title).catch(() => {});
    };
    new MutationObserver(syncTitle).observe(document.head, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    syncTitle();
  }

  if ("hid" in navigator) return;

  // ---- WebHID-compatible transport over the Rust hidapi commands ----------

  const freeze = (value) => {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  const toBytes = (data) => {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    throw new TypeError("Report data must be a BufferSource");
  };

  class HIDInputReportEvent extends Event {
    constructor(device, reportId, bytes) {
      super("inputreport");
      this.device = device;
      this.reportId = reportId;
      this.data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
  }

  class HIDConnectionEvent extends Event {
    constructor(type, device) {
      super(type);
      this.device = device;
    }
  }

  const withHandler = (target, event) => {
    try {
      target[`on${event.type}`]?.call(target, event);
    } finally {
      target.dispatchEvent(event);
    }
  };

  class HIDDevice extends EventTarget {
    #id;
    #opened = false;
    #channel = null;

    constructor(info) {
      super();
      this.#id = info.id;
      this.vendorId = info.vendorId;
      this.productId = info.productId;
      this.productName = info.productName;
      this.collections = freeze(structuredClone(info.collections || []));
      this.oninputreport = null;
    }

    get opened() {
      return this.#opened;
    }

    async open() {
      if (this.#opened) return;
      const channel = new Channel();
      channel.onmessage = (report) => {
        if (channel !== this.#channel) return;
        const bytes = Uint8Array.from(report.data || []);
        withHandler(this, new HIDInputReportEvent(this, report.reportId | 0, bytes));
      };
      this.#channel = channel;
      try {
        await call("hid_open", { id: this.#id, onReport: channel });
      } catch (error) {
        this.#channel = null;
        throw error;
      }
      this.#opened = true;
    }

    async close() {
      const wasOpen = this.#opened;
      this._markClosed();
      if (wasOpen) await call("hid_close", { id: this.#id });
    }

    async forget() {
      await this.close();
    }

    async sendReport(reportId, data) {
      if (!this.#opened) {
        throw new DOMException("The device must be opened first.", "InvalidStateError");
      }
      const bytes = toBytes(data);
      await call("hid_send", {
        id: this.#id,
        reportId: Number(reportId) & 0xff,
        data: Array.from(bytes),
      });
    }

    async sendFeatureReport() {
      throw new DOMException("Feature reports are not used by Zenblade.", "NotSupportedError");
    }

    async receiveFeatureReport() {
      throw new DOMException("Feature reports are not used by Zenblade.", "NotSupportedError");
    }

    _markClosed() {
      this.#opened = false;
      this.#channel = null;
    }
  }

  const known = new Map();
  const upsert = (info) => {
    let device = known.get(info.id);
    if (!device) {
      device = new HIDDevice(info);
      known.set(info.id, device);
    }
    return device;
  };
  const matches = (filters, device) =>
    !filters.length ||
    filters.some((filter) =>
      (filter.vendorId === undefined || filter.vendorId === device.vendorId) &&
      (filter.productId === undefined || filter.productId === device.productId) &&
      (filter.usagePage === undefined && filter.usage === undefined ||
        device.collections.some((c) =>
          (filter.usagePage === undefined || filter.usagePage === c.usagePage) &&
          (filter.usage === undefined || filter.usage === c.usage)
        ))
    );

  class HID extends EventTarget {
    constructor() {
      super();
      this.onconnect = null;
      this.ondisconnect = null;
    }

    async getDevices() {
      const list = await call("hid_get_devices");
      const present = new Set(list.map((info) => info.id));
      for (const [id, device] of known) {
        if (!present.has(id)) {
          device._markClosed();
          known.delete(id);
        }
      }
      return list.map(upsert);
    }

    // No picker UI: return the first supported keyboard, as the app has
    // always done (Rust only lists supported boards).
    async requestDevice({ filters = [] } = {}) {
      const devices = await this.getDevices();
      return devices.filter((device) => matches(filters, device)).slice(0, 1);
    }
  }

  const hid = new HID();
  listen("zen-hid", ({ payload: { type, device: info } }) => {
    if (type === "connect") {
      withHandler(hid, new HIDConnectionEvent("connect", upsert(info)));
    } else if (type === "disconnect") {
      const device = known.get(info.id) || upsert(info);
      device._markClosed();
      known.delete(info.id);
      withHandler(hid, new HIDConnectionEvent("disconnect", device));
    }
  });
  Object.defineProperty(Navigator.prototype, "hid", {
    configurable: false,
    enumerable: true,
    get: () => hid,
  });
})();
