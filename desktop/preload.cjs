const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gmDesktop", {
  isWindows: process.platform === "win32",
  isDesktop: true,
  platform: process.platform,
  notificationSupport: () => ipcRenderer.invoke("gmcrm:notification-support"),
  selectWorkspaceFolder: () => ipcRenderer.invoke("gmcrm:select-workspace-folder"),
  validateWorkspaceFolder: (payload = {}) => ipcRenderer.invoke("gmcrm:validate-workspace-folder", payload),
  openDocumentFolder: (payload) => ipcRenderer.invoke("gmcrm:open-document-folder", payload),
  showNotification: (payload) => ipcRenderer.invoke("gmcrm:notify", payload),
  openDrive: (payload) => ipcRenderer.invoke("gmcrm:open-drive", payload),
  openFile: (payload) => ipcRenderer.invoke("gmcrm:open-file", payload),
});
