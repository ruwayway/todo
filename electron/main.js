const { app, BrowserWindow, Menu, Tray, ipcMain, screen, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow;
let widgetWindow;
let tray = null;

const APP_URL = "https://todoriseuteu.onrender.com"; // 네 Render 주소로 바꿔
const userDataPath = app.getPath("userData");
const widgetStatePath = path.join(userDataPath, "widget-state.json");

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("todocal", process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient("todocal");
}

function getDefaultState() {
  const primary = screen.getPrimaryDisplay().workArea;
  return {
    x: primary.x + primary.width - 340,
    y: primary.y + 40,
    width: 310,
    height: 500,
    alwaysOnTop: true,
    opacity: 1,
    ignoreMouseEvents: false,
    theme: "yellow"
  };
}

function readWidgetState() {
  try {
    if (fs.existsSync(widgetStatePath)) {
      const saved = JSON.parse(fs.readFileSync(widgetStatePath, "utf-8"));
      return { ...getDefaultState(), ...saved };
    }
  } catch (e) {
    console.error("위젯 상태 읽기 실패:", e);
  }
  return getDefaultState();
}

function saveWidgetState(extra = {}) {
  try {
    if (!widgetWindow || widgetWindow.isDestroyed()) return;
    const bounds = widgetWindow.getBounds();
    const current = readWidgetState();
    const next = {
      ...current,
      ...bounds,
      ...extra
    };
    fs.writeFileSync(widgetStatePath, JSON.stringify(next, null, 2), "utf-8");
  } catch (e) {
    console.error("위젯 상태 저장 실패:", e);
  }
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
    show: false,
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

function applyWidgetPreferences() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const state = readWidgetState();

  widgetWindow.setAlwaysOnTop(!!state.alwaysOnTop);
  widgetWindow.setOpacity(typeof state.opacity === "number" ? state.opacity : 1);
  widgetWindow.setIgnoreMouseEvents(!!state.ignoreMouseEvents, {
    forward: state.ignoreMouseEvents
  });

  widgetWindow.webContents.send("widget:apply-settings", {
    alwaysOnTop: !!state.alwaysOnTop,
    opacity: typeof state.opacity === "number" ? state.opacity : 1,
    ignoreMouseEvents: !!state.ignoreMouseEvents,
    theme: state.theme || "yellow"
  });

  updateTrayMenu();
}

function createWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.show();
    widgetWindow.focus();
    return;
  }

  const state = readWidgetState();

  widgetWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 270,
    minHeight: 360,
    maxWidth: 420,
    frame: false,
    transparent: false,
    alwaysOnTop: !!state.alwaysOnTop,
    resizable: true,
    skipTaskbar: true,
    show: false,
    title: "오늘의 업무 위젯",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  widgetWindow.loadURL(`${APP_URL}/widget.html`);

  widgetWindow.once("ready-to-show", () => {
    applyWidgetPreferences();
    widgetWindow.show();
  });

  widgetWindow.on("moved", () => saveWidgetState());
  widgetWindow.on("resized", () => saveWidgetState());

  widgetWindow.on("closed", () => {
    widgetWindow = null;
    updateTrayMenu();
  });
}

function showWidgetWindow() {
  if (!widgetWindow || widgetWindow.isDestroyed()) {
    createWidgetWindow();
    return;
  }
  widgetWindow.show();
  widgetWindow.focus();
  updateTrayMenu();
}

function hideWidgetWindow() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.hide();
    updateTrayMenu();
  }
}

function handleDeepLink(url) {
  if (!url) return;

  if (url.startsWith("todocal://open-widget")) {
    showWidgetWindow();
  }

  if (url.startsWith("todocal://open-app")) {
    createMainWindow();
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
}

function createTray() {
  const empty = nativeImage.createEmpty();
  tray = new Tray(empty);

  tray.setToolTip("Todo Calendar Widget");
  tray.on("double-click", () => {
    showWidgetWindow();
  });

  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;

  const state = readWidgetState();
  const visible = !!(widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible());

  const menu = Menu.buildFromTemplate([
    {
      label: visible ? "위젯 숨기기" : "위젯 보이기",
      click: () => {
        if (visible) hideWidgetWindow();
        else showWidgetWindow();
      }
    },
    {
      label: "메인 열기",
      click: () => {
        createMainWindow();
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { type: "separator" },
    {
      label: state.alwaysOnTop ? "항상 위 고정 해제" : "항상 위 고정",
      click: () => {
        const next = !readWidgetState().alwaysOnTop;
        saveWidgetState({ alwaysOnTop: next });
        applyWidgetPreferences();
      }
    },
    {
      label: state.ignoreMouseEvents ? "클릭 무시 해제" : "클릭 무시",
      click: () => {
        const next = !readWidgetState().ignoreMouseEvents;
        saveWidgetState({ ignoreMouseEvents: next });
        applyWidgetPreferences();
      }
    },
    {
      label: "투명도",
      submenu: [
        {
          label: "100%",
          click: () => {
            saveWidgetState({ opacity: 1 });
            applyWidgetPreferences();
          }
        },
        {
          label: "90%",
          click: () => {
            saveWidgetState({ opacity: 0.9 });
            applyWidgetPreferences();
          }
        },
        {
          label: "80%",
          click: () => {
            saveWidgetState({ opacity: 0.8 });
            applyWidgetPreferences();
          }
        },
        {
          label: "70%",
          click: () => {
            saveWidgetState({ opacity: 0.7 });
            applyWidgetPreferences();
          }
        }
      ]
    },
    {
      label: "테마",
      submenu: [
        {
          label: "노랑",
          click: () => {
            saveWidgetState({ theme: "yellow" });
            applyWidgetPreferences();
          }
        },
        {
          label: "핑크",
          click: () => {
            saveWidgetState({ theme: "pink" });
            applyWidgetPreferences();
          }
        },
        {
          label: "민트",
          click: () => {
            saveWidgetState({ theme: "mint" });
            applyWidgetPreferences();
          }
        }
      ]
    },
    { type: "separator" },
    {
      label: "종료",
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine) => {
    const deepLink = commandLine.find((arg) => arg.startsWith("todocal://"));
    if (deepLink) handleDeepLink(deepLink);
    showWidgetWindow();
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);

    app.setLoginItemSettings({
      openAtLogin: true
    });

    createMainWindow();
    createWidgetWindow();
    createTray();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
        createWidgetWindow();
      } else {
        showWidgetWindow();
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
  if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.hide();
  updateTrayMenu();
});

ipcMain.on("widget:show", () => {
  showWidgetWindow();
});

ipcMain.on("widget:hide", () => {
  hideWidgetWindow();
});

ipcMain.on("app:show-main", () => {
  createMainWindow();
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.handle("widget:is-open", () => {
  return !!(widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible());
});

ipcMain.handle("widget:get-settings", () => {
  return readWidgetState();
});

ipcMain.on("widget:set-always-on-top", (event, value) => {
  saveWidgetState({ alwaysOnTop: !!value });
  applyWidgetPreferences();
});

ipcMain.on("widget:set-opacity", (event, value) => {
  const opacity = Math.max(0.5, Math.min(1, Number(value) || 1));
  saveWidgetState({ opacity });
  applyWidgetPreferences();
});

ipcMain.on("widget:set-ignore-mouse", (event, value) => {
  saveWidgetState({ ignoreMouseEvents: !!value });
  applyWidgetPreferences();
});

ipcMain.on("widget:set-theme", (event, value) => {
  const theme = ["yellow", "pink", "mint"].includes(value) ? value : "yellow";
  saveWidgetState({ theme });
  applyWidgetPreferences();
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

app.on("window-all-closed", (e) => {
  e.preventDefault();
});