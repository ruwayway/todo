const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const path = require("path");

let mainWindow;
let widgetWindow;

function createMainWindow() {
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

  mainWindow.loadURL("http://localhost:3000/login.html");
}

function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
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

  widgetWindow.loadURL("http://localhost:3000/widget.html");

  widgetWindow.on("closed", () => {
    widgetWindow = null;
  });
}

function hideWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.hide();
  }
}

function showWidgetWindow() {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    createWidgetWindow();
    return;
  }

  widgetWindow.show();
  widgetWindow.focus();
}

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
});

ipcMain.on("widget:minimize", () => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.minimize();
  }
});

ipcMain.on("widget:close", () => {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.close();
  }
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});