const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  session,
  Menu,
  nativeTheme,
  nativeImage,
  Tray,
  dialog,
  globalShortcut,
  powerMonitor,
} = require("electron");
const path = require("path");
const fs = require("fs/promises");
const {
  assertSupportedProfileFile,
  getFrontApplication,
  readApplicationMetadata,
} = require("./desktop.js");
const { createSystemBridge } = require("./system-bridge.js");
const {
  vendorId: PWNAGE_VID,
  productIds: ZENBLADE_PID_LIST,
} = require("../shared/device-ids.json");

const ZENBLADE_PIDS = new Set(ZENBLADE_PID_LIST);
const APP_BUNDLE_ID = "com.local.zenblade";
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (typeof app.setName === "function") {
  app.setName("Zenblade");
}
if (!hasSingleInstanceLock) app.quit();

const isDev = process.argv.includes("--dev");
const ICON_PNG = path.join(__dirname, "..", "build", "icon.png");
const ICON_ICNS = path.join(__dirname, "..", "build", "icon.icns");

function resolveAppIcon() {
  try {
    if (process.platform === "darwin") {
      const icns = nativeImage.createFromPath(ICON_ICNS);
      if (!icns.isEmpty()) return icns;
    }
    const png = nativeImage.createFromPath(ICON_PNG);
    if (!png.isEmpty()) return png;
  } catch (_) {
    /* ignore */
  }
  return null;
}

function resolveTrayIcon() {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">',
    '<rect x="1.5" y="4" width="15" height="10" rx="2" fill="none" stroke="#000" stroke-width="1.5"/>',
    '<path d="M4 7h1M7 7h1M10 7h1M13 7h1M4 10h1M7 10h1M10 10h1M13 10h1M5.5 12h7" stroke="#000" stroke-width="1.5" stroke-linecap="round"/>',
    "</svg>",
  ].join("");
  const image = nativeImage.createFromDataURL(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  );
  return image.isEmpty() ? resolveAppIcon()?.resize({ width: 18, height: 18 }) : image;
}

let mainWindow = null;
let tray = null;
let foregroundTimer = null;
let foregroundBusy = false;
let activeApplication = null;
let isQuitting = false;
let systemBridge = null;
const registeredSystemShortcuts = new Set();
const desktopState = {
  connected: false,
  profile: 0,
  lightingOn: true,
  automationEnabled: false,
  systemEnabled: false,
  micMuted: false,
};

function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function showMainWindow(panel) {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  mainWindow?.show();
  mainWindow?.focus();
  if (panel) sendToRenderer("app:navigate", panel);
}

/** Parent for modal dialogs; show a hidden window so sheets are not buried. */
function dialogParent() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
    mainWindow.show();
  }
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
}

if (hasSingleInstanceLock) {
  app.on("second-instance", () => showMainWindow());
}

function buildTrayMenu() {
  if (!tray) return;
  const profileItems = [0, 1, 2].map((profile) => ({
    label: `Profile ${profile + 1}`,
    type: "radio",
    checked: desktopState.profile === profile,
    click: () => sendToRenderer("app:selectProfile", profile),
  }));
  tray.setToolTip(
    desktopState.connected
      ? `Zenblade · Profile ${desktopState.profile + 1}`
      : "Zenblade · Not connected",
  );
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: desktopState.connected ? "Zenblade connected" : "Keyboard not connected",
      enabled: false,
    },
    { type: "separator" },
    ...profileItems,
    { type: "separator" },
    {
      label: "Lights",
      type: "checkbox",
      checked: desktopState.lightingOn,
      click: () => sendToRenderer("app:toggleLights"),
    },
    {
      label: "Automatic profiles",
      type: "checkbox",
      checked: desktopState.automationEnabled,
      click: () => sendToRenderer("app:toggleAutomation"),
    },
    {
      label: desktopState.micMuted ? "Unmute microphone" : "Mute microphone",
      enabled: desktopState.systemEnabled,
      click: async () => {
        try {
          const audio = await systemBridge?.perform({
            action: "microphone-toggle",
          });
          desktopState.micMuted = audio?.micMuted === true;
          sendToRenderer("app:systemContext", { audio });
          buildTrayMenu();
        } catch {
          showMainWindow("system");
        }
      },
    },
    { type: "separator" },
    {
      label: "Reconnect",
      click: () => sendToRenderer("app:reconnect"),
    },
    {
      label: "Open Zenblade",
      click: () => showMainWindow(),
    },
    { type: "separator" },
    { label: "Quit Zenblade", role: "quit" },
  ]));
}

function createTray() {
  const source = resolveTrayIcon();
  if (!source || source.isEmpty()) return;
  if (process.platform === "darwin") source.setTemplateImage(true);
  tray = new Tray(source);
  tray.on("click", () => showMainWindow());
  buildTrayMenu();
}

async function pollForegroundApplication() {
  if (foregroundBusy) return;
  foregroundBusy = true;
  try {
    const current = await getFrontApplication();
    if (
      current &&
      current.bundleId !== APP_BUNDLE_ID &&
      current.bundleId !== activeApplication?.bundleId
    ) {
      activeApplication = current;
      sendToRenderer("app:activeApplication", current);
    }
  } catch {
    // Foreground detection is a convenience. A temporary OS lookup failure
    // must not affect keyboard control or surface repeated errors.
  } finally {
    foregroundBusy = false;
  }
}

function startForegroundMonitor() {
  clearInterval(foregroundTimer);
  pollForegroundApplication();
  foregroundTimer = setInterval(pollForegroundApplication, 1000);
  foregroundTimer.unref?.();
}

function stopForegroundMonitor() {
  clearInterval(foregroundTimer);
  foregroundTimer = null;
  activeApplication = null;
}

function configureHid(ses) {
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === "hid");
  });
  ses.setDevicePermissionHandler((details) => details.deviceType === "hid");
  ses.on("select-hid-device", (event, details, callback) => {
    event.preventDefault();
    const list = details.deviceList || [];
    const zen = list.find(
      (d) => d.vendorId === PWNAGE_VID && ZENBLADE_PIDS.has(d.productId),
    );
    callback(zen ? zen.deviceId : "");
  });
}

function createWindow() {
  const icon = resolveAppIcon();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#100e18",
    title: "Zenblade",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    show: false,
    icon: icon || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // The hidden menu-bar utility still needs to handle active-app and
      // reconnect events promptly.
      backgroundThrottling: false,
      v8CacheOptions: "code",
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (process.platform === "darwin" && icon && app.dock) {
      app.dock.setIcon(icon);
    }
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

function buildMenu() {
  const navigate = (panel) =>
    sendToRenderer("app:navigate", panel);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "Zenblade",
        submenu: [
          { role: "about", label: "About Zenblade" },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide", label: "Hide Zenblade" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit", label: "Quit Zenblade" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "View",
        submenu: [
          {
            label: "Keyboard",
            accelerator: "CmdOrCtrl+1",
            click: () => navigate("keyboard"),
          },
          {
            label: "Lights",
            accelerator: "CmdOrCtrl+2",
            click: () => navigate("lighting"),
          },
          {
            label: "Feel",
            accelerator: "CmdOrCtrl+3",
            click: () => navigate("actuation"),
          },
          {
            label: "Profiles",
            accelerator: "CmdOrCtrl+4",
            click: () => navigate("profiles"),
          },
          {
            label: "Advanced",
            accelerator: "CmdOrCtrl+5",
            click: () => navigate("advanced"),
          },
          {
            label: "System",
            accelerator: "CmdOrCtrl+6",
            click: () => navigate("system"),
          },
          { type: "separator" },
          { role: "reload" },
          { role: "toggleDevTools" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { type: "separator" },
          { role: "togglefullscreen" },
        ],
      },
      {
        label: "Device",
        submenu: [
          {
            label: "Reconnect",
            accelerator: "CmdOrCtrl+Shift+R",
            click: () => sendToRenderer("app:reconnect"),
          },
        ],
      },
      {
        role: "window",
        submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
      },
    ]),
  );
}

if (hasSingleInstanceLock) app.whenReady().then(() => {
  nativeTheme.themeSource = "dark";

  if (
    process.platform === "darwin" &&
    typeof app.setAboutPanelParameters === "function"
  ) {
    try {
      app.setAboutPanelParameters({
        applicationName: "Zenblade",
        applicationVersion: app.getVersion(),
        copyright: "Your personal Zenblade 65 V2 companion",
      });
    } catch (_) {
      /* ignore */
    }
  }

  const icon = resolveAppIcon();
  if (process.platform === "darwin" && icon && app.dock) {
    app.dock.setIcon(icon);
  }
  configureHid(session.defaultSession);
  systemBridge = createSystemBridge({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
  });
  buildMenu();
  createWindow();
  createTray();

  ipcMain.handle("app:getInfo", () => ({
    version: app.getVersion(),
    platform: process.platform,
    name: app.getName(),
  }));
  ipcMain.handle("app:getActiveApplication", async () => {
    const current = await getFrontApplication();
    if (current?.bundleId !== APP_BUNDLE_ID) activeApplication = current;
    return activeApplication;
  });
  ipcMain.on("app:setDesktopState", (_event, next) => {
    const automationWasEnabled = desktopState.automationEnabled;
    Object.assign(desktopState, {
      connected: next?.connected === true,
      profile: Math.max(0, Math.min(2, Number(next?.profile) | 0)),
      lightingOn: next?.lightingOn !== false,
      automationEnabled: next?.automationEnabled === true,
      systemEnabled: next?.systemEnabled === true,
      micMuted: next?.micMuted === true,
    });
    if (desktopState.automationEnabled && !automationWasEnabled) {
      startForegroundMonitor();
    } else if (!desktopState.automationEnabled && automationWasEnabled) {
      stopForegroundMonitor();
    }
    buildTrayMenu();
  });
  ipcMain.handle("app:getSystemContext", async (_event, detectors) => {
    return systemBridge.getContext(detectors);
  });
  ipcMain.handle("app:performSystemAction", async (_event, value) => {
    const audio = await systemBridge.perform(value);
    desktopState.micMuted = audio?.micMuted === true;
    buildTrayMenu();
    return audio;
  });
  ipcMain.handle("app:configureSystemShortcuts", (_event, mappings) => {
    for (const accelerator of registeredSystemShortcuts) {
      globalShortcut.unregister(accelerator);
    }
    registeredSystemShortcuts.clear();
    const failures = [];
    for (const value of Array.isArray(mappings) ? mappings : []) {
      const accelerator = String(value?.accelerator || "");
      if (!/^F(1[3-9]|2[0-4])$/.test(accelerator)) continue;
      const mapping = {
        action: String(value?.action || ""),
        inputUid: String(value?.inputUid || ""),
        outputUid: String(value?.outputUid || ""),
      };
      const ok = globalShortcut.register(accelerator, () => {
        systemBridge.perform(mapping).then((audio) => {
          desktopState.micMuted = audio?.micMuted === true;
          sendToRenderer("app:systemContext", { audio });
          buildTrayMenu();
        }).catch((error) => {
          sendToRenderer("app:systemActionError", error?.message || String(error));
        });
      });
      if (ok) registeredSystemShortcuts.add(accelerator);
      else failures.push(accelerator);
    }
    return {
      registered: [...registeredSystemShortcuts],
      failures,
    };
  });
  ipcMain.handle("app:chooseApplications", async () => {
    const result = await dialog.showOpenDialog(dialogParent(), {
      title: "Choose applications",
      defaultPath: "/Applications",
      buttonLabel: "Add",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Applications", extensions: ["app"] }],
    });
    if (result.canceled) return [];
    const values = await Promise.all(
      result.filePaths.map(readApplicationMetadata),
    );
    const seen = new Set();
    return values.filter((value) => {
      if (!value || seen.has(value.bundleId)) return false;
      seen.add(value.bundleId);
      return true;
    });
  });
  ipcMain.handle("app:exportProfile", async (_event, payload) => {
    const profile = Math.max(0, Math.min(2, Number(payload?.profile) | 0));
    const data = assertSupportedProfileFile(payload?.data);
    const result = await dialog.showSaveDialog(dialogParent(), {
      title: `Export Profile ${profile + 1}`,
      defaultPath: `Zenblade Profile ${profile + 1}.zenbladeprofile`,
      buttonLabel: "Export",
      filters: [{ name: "Zenblade Profile", extensions: ["zenbladeprofile"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.writeFile(
      result.filePath,
      `${JSON.stringify(data, null, 2)}\n`,
      "utf8",
    );
    return { canceled: false };
  });
  ipcMain.handle("app:importProfile", async (_event, targetProfile) => {
    const profile = Math.max(0, Math.min(2, Number(targetProfile) | 0));
    const result = await dialog.showOpenDialog(dialogParent(), {
      title: "Import Zenblade Profile",
      buttonLabel: "Import",
      properties: ["openFile"],
      filters: [{ name: "Zenblade Profile", extensions: ["zenbladeprofile", "json"] }],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    const stat = await fs.stat(filePath);
    if (stat.size > 1024 * 1024) throw new Error("Profile file is too large");
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
      throw new Error("Profile file is not valid JSON");
    }
    const data = assertSupportedProfileFile(parsed);
    const confirmation = await dialog.showMessageBox(dialogParent(), {
      type: "warning",
      title: `Replace Profile ${profile + 1}?`,
      message: `Importing will replace the local settings in Profile ${profile + 1}.`,
      buttons: ["Cancel", "Replace Profile"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirmation.response !== 1) return { canceled: true };
    return { canceled: false, data };
  });
  powerMonitor.on("suspend", () => sendToRenderer("app:suspend"));
  powerMonitor.on("resume", () => sendToRenderer("app:wake"));
  powerMonitor.on("unlock-screen", () => sendToRenderer("app:wake"));

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else showMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !tray) app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  stopForegroundMonitor();
  if (app.isReady()) globalShortcut.unregisterAll();
});
