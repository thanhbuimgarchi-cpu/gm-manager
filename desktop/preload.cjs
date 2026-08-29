const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gmDesktop", {
  isWindows: process.platform === "win32",
  isDesktop: true,
  platform: process.platform,
  showNotification: (payload) => ipcRenderer.invoke("gmcrm:notify", payload),
  openDrive: (payload) => ipcRenderer.invoke("gmcrm:open-drive", payload),
});
