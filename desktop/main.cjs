const { app, BrowserWindow, Notification, ipcMain, shell, session } = require("electron");
const path = require("node:path");

const APP_URL = "https://thanhbuimgarchi-cpu.github.io/gm-manager/";
const APP_ORIGIN = new URL(APP_URL).origin;

function isTrustedUrl(value) {
  try {
    return new URL(value).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 700,
    title: "GM-CRM",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  window.loadURL(APP_URL);
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isTrustedUrl(url)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.mgarchi.gmcrm");
  const trustedNotificationRequest = (webContents) => isTrustedUrl(webContents.getURL());
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "notifications" && trustedNotificationRequest(webContents));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return permission === "notifications" && (requestingOrigin === APP_ORIGIN || (webContents && trustedNotificationRequest(webContents)));
  });
  ipcMain.handle("gmcrm:notify", (_event, payload = {}) => {
    const title = String(payload.title || "GM-CRM").slice(0, 120);
    const body = String(payload.body || "").slice(0, 240);
    new Notification({ title, body }).show();
    return true;
  });
  // This is deliberately a fixed local path: the renderer cannot request an
  // arbitrary program or path through the desktop bridge.
  ipcMain.handle("gmcrm:open-drive", () => shell.openPath("G:\\"));
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
