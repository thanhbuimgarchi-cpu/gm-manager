const { app, BrowserWindow, Notification, ipcMain, shell, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");

const APP_URL = "https://thanhbuimgarchi-cpu.github.io/gm-manager/";
const APP_ORIGIN = new URL(APP_URL).origin;
const DRIVE_ROOT = "G:\\My Drive";
const APP_ICON = app.isPackaged ? path.join(process.resourcesPath, "gm-logo-512.png") : path.join(__dirname, "..", "public", "gm-logo-512.png");
let mainWindow = null;

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
    icon: APP_ICON,
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
  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

function openNotificationTarget(target) {
  const targetUrl = isTrustedUrl(target) ? target : APP_URL;
  const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (window.webContents.getURL() !== targetUrl) void window.loadURL(targetUrl);
}

async function findProjectDocumentsFolder(projectId) {
  const queue = [DRIVE_ROOT];
  const visited = new Set();
  while (queue.length) {
    const folder = queue.shift();
    if (!folder || visited.has(folder)) continue;
    visited.add(folder);
    let entries;
    try {
      entries = await fs.readdir(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const child = path.join(folder, entry.name);
      if (entry.name === projectId) {
        const documentsFolder = path.join(child, "Tài liệu");
        try {
          if ((await fs.stat(documentsFolder)).isDirectory()) return documentsFolder;
        } catch { /* Keep looking: the same project ID can exist in an old archive. */ }
      }
      queue.push(child);
    }
  }
  return "";
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
    const body = String(payload.body || "").slice(0, 700);
    const notification = new Notification({ title, body, icon: APP_ICON });
    notification.on("click", () => openNotificationTarget(String(payload.url || APP_URL)));
    notification.show();
    return true;
  });
  ipcMain.handle("gmcrm:open-drive", async (_event, payload = {}) => {
    const projectId = String(payload.projectId || "").trim();
    if (!/^[A-Za-z0-9_-]+$/.test(projectId)) return "Mã dự án không hợp lệ.";
    const documentsFolder = await findProjectDocumentsFolder(projectId);
    return documentsFolder ? shell.openPath(documentsFolder) : "Không tìm thấy thư mục Tài liệu của dự án trên ổ G.";
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
