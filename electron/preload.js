const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("widgetWindowAPI", {
  minimize: () => ipcRenderer.send("widget:minimize"),
  close: () => ipcRenderer.send("widget:close"),
  show: () => ipcRenderer.send("widget:show"),
  hide: () => ipcRenderer.send("widget:hide"),
  isOpen: () => ipcRenderer.invoke("widget:is-open"),
  showMain: () => ipcRenderer.send("app:show-main"),
  getSettings: () => ipcRenderer.invoke("widget:get-settings"),
  setAlwaysOnTop: (value) => ipcRenderer.send("widget:set-always-on-top", value),
  setOpacity: (value) => ipcRenderer.send("widget:set-opacity", value),
  setIgnoreMouse: (value) => ipcRenderer.send("widget:set-ignore-mouse", value),
  setTheme: (value) => ipcRenderer.send("widget:set-theme", value),
  onApplySettings: (callback) => {
    ipcRenderer.on("widget:apply-settings", (_, settings) => callback(settings));
  }
});

window.addEventListener("DOMContentLoaded", () => {
  console.log("Electron widget loaded");
});