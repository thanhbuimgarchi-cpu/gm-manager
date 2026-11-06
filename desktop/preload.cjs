const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gmDesktop", {
  isWindows: process.platform === "win32",
  isDesktop: true,
  platform: process.platform,
  notificationSupport: () => ipcRenderer.invoke("gmcrm:notification-support"),
  getAppInfo: () => ipcRenderer.invoke("gmcrm:get-app-info"),
  checkForUpdates: () => ipcRenderer.invoke("gmcrm:check-for-updates"),
  downloadUpdate: () => ipcRenderer.invoke("gmcrm:download-update"),
  installUpdate: () => ipcRenderer.invoke("gmcrm:install-update"),
  getUpdateState: () => ipcRenderer.invoke("gmcrm:get-update-state"),
  onUpdateProgress: (listener) => {
    if (typeof listener !== "function") return () => {};
    const handler = (_event, state) => {
      if (state && typeof state.phase === "string") listener(state);
    };
    ipcRenderer.on("gmcrm:update-progress", handler);
    return () => ipcRenderer.removeListener("gmcrm:update-progress", handler);
  },
  onBeforeUpdate: (listener) => {
    if (typeof listener !== "function") return () => {};
    const handler = async (_event, requestId) => {
      if (typeof requestId !== "string" || requestId.length > 100) return;
      let result;
      try { await listener(); result = { requestId, ok: true }; }
      catch (error) { result = { requestId, ok: false, error: String(error?.message || "Chưa thể lưu dữ liệu trước khi cập nhật.").slice(0, 500) }; }
      try { await ipcRenderer.invoke("gmcrm:update-prepared", result); } catch { /* The main process may have exited after the acknowledgement. */ }
    };
    ipcRenderer.on("gmcrm:prepare-update", handler);
    return () => ipcRenderer.removeListener("gmcrm:prepare-update", handler);
  },
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
