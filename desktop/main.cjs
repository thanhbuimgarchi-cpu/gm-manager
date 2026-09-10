const { app, BrowserWindow, Notification, ipcMain, shell, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");

const APP_URL = "https://thanhbuimgarchi-cpu.github.io/gm-manager/";
const APP_ORIGIN = new URL(APP_URL).origin;
// The shared Drive used by the installed PC shortcut is mounted on I:. Keep
// the older G: locations as fallbacks for machines that still use that mount.
const WINDOWS_DRIVE_ROOTS = ["I:\\Shared drives", "I:\\My Drive", "G:\\Shared drives", "G:\\My Drive"];
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

async function googleDriveRoots() {
  if (process.platform === "win32") return WINDOWS_DRIVE_ROOTS;
  if (process.platform !== "darwin") return [];
  const home = os.homedir();
  const roots = [path.join(home, "Google Drive", "My Drive")];
  const cloudStorage = path.join(home, "Library", "CloudStorage");
  try {
    const entries = await fs.readdir(cloudStorage, { withFileTypes: true });
    entries.filter((entry) => entry.isDirectory() && /^GoogleDrive/i.test(entry.name)).forEach((entry) => {
      roots.push(path.join(cloudStorage, entry.name, "My Drive"));
    });
  } catch { /* Google Drive Desktop may not be installed or signed in yet. */ }
  return roots;
}

async function findProjectDocumentsFolder(...identifiers) {
  const wanted = new Set(identifiers.map((value) => String(value || "").trim()).filter(Boolean));
  if (!wanted.size) return "";
  const queue = await googleDriveRoots();
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
      if (wanted.has(entry.name)) {
        const documentsFolder = path.join(child, "Tài liệu");
        try {
          if ((await fs.stat(documentsFolder)).isDirectory()) return documentsFolder;
        } catch { /* Keep looking: a legacy project folder may not contain Tài liệu. */ }
      }
      queue.push(child);
    }
  }
  return "";
}

function safeDriveEntryName(value) {
  const name = String(value || "").trim();
  if (!name || name === "." || name === ".." || name.length > 255) return "";
  return /[\\/:*?"<>|\u0000-\u001f]/.test(name) ? "" : name;
}

function sameDriveEntryName(left, right) {
  return String(left || "").normalize("NFC").toLocaleLowerCase() === String(right || "").normalize("NFC").toLocaleLowerCase();
}

async function findDriveFile(documentsFolder, fileName, snapshotName) {
  const wantedName = safeDriveEntryName(fileName);
  if (!wantedName) return "";
  const safeSnapshotName = snapshotName ? safeDriveEntryName(snapshotName) : "";
  const roots = safeSnapshotName ? [path.join(documentsFolder, safeSnapshotName)] : [documentsFolder];
  for (const root of roots) {
    let rootStats;
    try {
      rootStats = await fs.stat(root);
    } catch {
      continue;
    }
    if (!rootStats.isDirectory()) continue;
    const queue = [root];
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
        const child = path.join(folder, entry.name);
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
          queue.push(child);
        } else if (entry.isFile() && sameDriveEntryName(entry.name, wantedName)) {
          return child;
        }
      }
    }
  }
  // A few older Drive Desktop layouts did not preserve the snapshot folder
  // name. If the selected snapshot path is unavailable, use the project
  // Tài liệu folder as a compatibility fallback.
  if (safeSnapshotName) return findDriveFile(documentsFolder, wantedName, "");
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
    const houseId = String(payload.houseId || "").trim();
    const identifiers = [houseId, projectId].filter((value, index, values) => value && values.indexOf(value) === index);
    if (!identifiers.length || identifiers.some((value) => !/^[A-Za-z0-9_-]+$/.test(value))) return "Mã nhà không hợp lệ.";
    const documentsFolder = await findProjectDocumentsFolder(...identifiers);
    return documentsFolder ? shell.openPath(documentsFolder) : process.platform === "darwin" ? "Không tìm thấy Google Drive Desktop hoặc thư mục Tài liệu của mã nhà trên Mac." : "Không tìm thấy thư mục Tài liệu của mã nhà trên ổ G.";
  });
  ipcMain.handle("gmcrm:open-file", async (_event, payload = {}) => {
    const projectId = String(payload.projectId || "").trim();
    const houseId = String(payload.houseId || "").trim();
    const fileName = safeDriveEntryName(payload.fileName);
    const snapshotName = safeDriveEntryName(payload.snapshotName);
    const identifiers = [houseId, projectId].filter((value, index, values) => value && values.indexOf(value) === index);
    if (!identifiers.length || identifiers.some((value) => !/^[A-Za-z0-9_-]+$/.test(value))) return "Mã nhà không hợp lệ.";
    if (!fileName) return "Tên tệp không hợp lệ.";
    const documentsFolder = await findProjectDocumentsFolder(...identifiers);
    if (!documentsFolder) return process.platform === "darwin" ? "Không tìm thấy Google Drive Desktop hoặc thư mục Tài liệu của mã nhà trên Mac." : "Không tìm thấy thư mục Tài liệu của mã nhà trên ổ G.";
    const filePath = await findDriveFile(documentsFolder, fileName, snapshotName);
    if (!filePath) return `Không tìm thấy tệp ${fileName} trong ổ G.`;
    return shell.openPath(filePath);
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
