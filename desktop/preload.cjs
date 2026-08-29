const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gmDesktop", {
  isWindows: process.platform === "win32",
  showNotification: (payload) => ipcRenderer.invoke("gmcrm:notify", payload),
  openDrive: (payload) => ipcRenderer.invoke("gmcrm:open-drive", payload),
});
