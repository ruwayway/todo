const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("widgetWindowAPI", {
  minimize: () => ipcRenderer.send("widget:minimize"),
  close: () => ipcRenderer.send("widget:close"),
  show: () => ipcRenderer.send("widget:show"),
  hide: () => ipcRenderer.send("widget:hide"),
  isOpen: () => ipcRenderer.invoke("widget:is-open")
});

window.addEventListener("DOMContentLoaded", () => {
  console.log("Electron widget loaded");
});