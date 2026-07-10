const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  session,
  Menu,
  nativeTheme,
  nativeImage,
} = require("electron");
const path = require("path");
const {
  vendorId: PWNAGE_VID,
  productIds: ZENBLADE_PID_LIST,
} = require("../shared/device-ids.json");

const ZENBLADE_PIDS = new Set(ZENBLADE_PID_LIST);

if (typeof app.setName === "function") {
  app.setName("Zenblade");
}

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

let mainWindow = null;

function configureHid(ses) {
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(
      permission === "hid" ||
        permission === "clipboard-read" ||
        permission === "clipboard-sanitized-write",
    );
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
    backgroundThrottling: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: true,
      v8CacheOptions: "code",
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (process.platform === "darwin" && icon && app.dock) {
      app.dock.setIcon(icon);
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
            click: () => mainWindow?.webContents.send("app:reconnect"),
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

app.whenReady().then(() => {
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
  buildMenu();
  createWindow();

  ipcMain.handle("app:getInfo", () => ({
    version: app.getVersion(),
    platform: process.platform,
    name: app.getName(),
  }));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
