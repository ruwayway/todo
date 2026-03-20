const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path = require("path");

let mainWindow;
let widgetWindow;

const APP_URL = "https://todoriseuteu.onrender.com";

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("todocal", process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient("todocal");
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(`${APP_URL}/login.html`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.show();
    widgetWindow.focus();
    return;
  }

  widgetWindow = new BrowserWindow({
    width: 310,
    height: 500,
    minWidth: 270,
    minHeight: 360,
    maxWidth: 420,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: true,
    skipTaskbar: false,
    title: "오늘의 업무 위젯",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  widgetWindow.loadURL(`${APP_URL}/widget.html`);

  widgetWindow.on("closed", () => {
    widgetWindow = null;
  });
}

function showWidgetWindow() {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    createWidgetWindow();
    return;
  }
  widgetWindow.show();
  widgetWindow.focus();
}

function hideWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.hide();
  }
}

function handleDeepLink(url) {
  if (!url) return;

  if (url.startsWith("todocal://open-widget")) {
    createMainWindow();
    showWidgetWindow();
  }

  if (url.startsWith("todocal://open-app")) {
    createMainWindow();
  }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine) => {
    const deepLink = commandLine.find((arg) => arg.startsWith("todocal://"));
    if (deepLink) handleDeepLink(deepLink);

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);

    createMainWindow();
    createWidgetWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
        createWidgetWindow();
      }
    });

    if (process.platform === "win32") {
      const deepLink = process.argv.find((arg) => arg.startsWith("todocal://"));
      if (deepLink) handleDeepLink(deepLink);
    }
  });
}

ipcMain.on("widget:minimize", () => {
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.minimize();
});

ipcMain.on("widget:close", () => {
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.close();
});

ipcMain.on("widget:show", () => {
  showWidgetWindow();
});

ipcMain.on("widget:hide", () => {
  hideWidgetWindow();
});

ipcMain.handle("widget:is-open", () => {
  return !!(widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible());
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});