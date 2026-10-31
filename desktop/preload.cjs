const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gmDesktop", {
  isWindows: process.platform === "win32",
  isDesktop: true,
  platform: process.platform,
  notificationSupport: () => ipcRenderer.invoke("gmcrm:notification-support"),
  getStartupSettings: () => ipcRenderer.invoke("gmcrm:get-startup-settings"),
  setStartupSettings: (payload) => ipcRenderer.invoke("gmcrm:set-startup-settings", payload),
  onStartupChanged: (listener) => {
    if (typeof listener !== "function") return () => {};
    const handler = (_event, value) => {
      if (!value || typeof value.supported !== "boolean" || typeof value.openAtLogin !== "boolean") return;
      listener({ supported: value.supported, canChange: value.canChange === true, openAtLogin: value.openAtLogin, ...(typeof value.error === "string" ? { error: value.error } : {}) });
    };
    ipcRenderer.on("gmcrm:startup-changed", handler);
    return () => ipcRenderer.removeListener("gmcrm:startup-changed", handler);
  },
  selectWorkspaceFolder: () => ipcRenderer.invoke("gmcrm:select-workspace-folder"),
  validateWorkspaceFolder: (payload = {}) => ipcRenderer.invoke("gmcrm:validate-workspace-folder", payload),
  openDocumentFolder: (payload) => ipcRenderer.invoke("gmcrm:open-document-folder", payload),
  showNotification: (payload) => ipcRenderer.invoke("gmcrm:notify", payload),
  openDrive: (payload) => ipcRenderer.invoke("gmcrm:open-drive", payload),
  openFile: (payload) => ipcRenderer.invoke("gmcrm:open-file", payload),
});
