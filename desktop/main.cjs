const { app, BrowserWindow, Notification, ipcMain, shell, session, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { safeDriveEntryName, sameDriveEntryName, isWithinRoot, normalizeWorkspaceRoot, findProjectDocumentsAtRoot, findDocumentSnapshotFolder } = require("./path-utils.cjs");

const APP_URL = "https://thanhbuimgarchi-cpu.github.io/gm-manager/";
const APP_ORIGIN = new URL(APP_URL).origin;
// The shared Drive used by the installed PC shortcut is mounted on I:. Keep
// the older G: locations as fallbacks for machines that still use that mount.
const WINDOWS_DRIVE_ROOTS = ["I:\\Shared drives", "I:\\My Drive", "G:\\Shared drives", "G:\\My Drive"];
const APP_ICON = app.isPackaged ? path.join(process.resourcesPath, "gm-logo-512.png") : path.join(__dirname, "..", "public", "gm-logo-512.png");
let mainWindow = null;
let workspaceFolder;
const pendingProtocolUrls = [];
const activeNotifications = new Set();
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

function isTrustedUrl(value) {
  try {
    return new URL(value).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function trustedIpcSender(event) {
  return isTrustedUrl(event.senderFrame?.url || event.sender?.getURL?.() || "");
}

async function readWorkspaceFolder() {
  if (workspaceFolder !== undefined) return workspaceFolder;
  try {
    const saved = JSON.parse(await fs.readFile(path.join(app.getPath("userData"), "workspace-location.json"), "utf8"));
    workspaceFolder = typeof saved.path === "string" ? saved.path : "";
  } catch { workspaceFolder = ""; }
  return workspaceFolder;
}

async function saveWorkspaceFolder(folder) {
  if (workspaceFolder === folder) return;
  const configPath = path.join(app.getPath("userData"), "workspace-location.json");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(`${configPath}.tmp`, JSON.stringify({ path: folder }), "utf8");
  await fs.rename(`${configPath}.tmp`, configPath);
  workspaceFolder = folder;
}

async function validateWorkspaceFolder(payload = {}) {
  const requested = typeof payload.path === "string" && payload.path.trim() ? payload.path : await readWorkspaceFolder();
  const folder = await normalizeWorkspaceRoot(requested);
  if (!folder) return { ok: false, path: "", error: "Hãy chọn thư mục GM Manager có đủ hai thư mục Khách hàng và Nhân lực." };
  try { await saveWorkspaceFolder(folder); } catch { return { ok: false, path: "", error: "Không thể lưu vị trí thư mục trên máy này. Hãy thử chọn lại." }; }
  return { ok: true, path: folder };
}

async function selectWorkspaceFolder() {
  const options = { title: "Chọn thư mục GM Manager", buttonLabel: "Chọn thư mục", properties: ["openDirectory"], defaultPath: await readWorkspaceFolder() || undefined };
  const selected = mainWindow && !mainWindow.isDestroyed() ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true, path: await readWorkspaceFolder() || "" };
  return validateWorkspaceFolder({ path: selected.filePaths[0] });
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

async function findProjectDocumentsFolder(payload) {
  const selectedRoot = await readWorkspaceFolder();
  if (selectedRoot) return findProjectDocumentsAtRoot(selectedRoot, payload);
  const identifiers = [payload.houseId, payload.projectId];
  const wanted = new Set(identifiers.map((value) => String(value || "").trim()).filter(Boolean));
  if (!wanted.size) return "";
  const queue = (await googleDriveRoots()).map((folder) => ({ folder, depth: 0 }));
  const visited = new Set();
  while (queue.length && visited.size < 2000) {
    const { folder, depth } = queue.shift();
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
      if (depth < 6) queue.push({ folder: child, depth: depth + 1 });
    }
  }
  return "";
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
          try {
            const [realRoot, realChild] = await Promise.all([fs.realpath(documentsFolder), fs.realpath(child)]);
            if (isWithinRoot(realRoot, realChild)) return child;
          } catch { /* A Drive file may move while its directory is being read. */ }
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

async function openDocumentFolder(payload = {}) {
  const selectedRoot = await readWorkspaceFolder();
  if (!selectedRoot) return "Hãy chọn thư mục GM Manager trong phần đăng nhập trước.";
  const folder = await findDocumentSnapshotFolder(selectedRoot, payload);
  if (!folder) return "Không tìm thấy thư mục Tài liệu của hồ sơ hoặc ngày đã chọn tại vị trí GM Manager đã lưu.";
  if (payload.fileName) {
    const file = await findDriveFile(folder, payload.fileName, "");
    if (file) return shell.openPath(path.dirname(file));
  }
  return shell.openPath(folder);
}

async function handleProtocolUrl(value) {
  let url;
  try { url = new URL(value); } catch { return; }
  if (url.protocol !== "gmmanager:" || url.hostname !== "open-documents" || (url.pathname && url.pathname !== "/")) return;
  const payload = { houseId: url.searchParams.get("houseId"), projectId: url.searchParams.get("projectId"), year: url.searchParams.get("year"), month: url.searchParams.get("month"), snapshotName: url.searchParams.get("snapshotName") || "" };
  if (![payload.houseId, payload.projectId].some((name) => safeDriveEntryName(name)) || (payload.snapshotName && !safeDriveEntryName(payload.snapshotName))) return;
  if (!/^\d{4}$/.test(payload.year || "") || !Number.isInteger(Number(payload.month)) || Number(payload.month) < 1 || Number(payload.month) > 12) return;
  let validation = await validateWorkspaceFolder();
  if (!validation.ok) validation = await selectWorkspaceFolder();
  if (!validation.ok) return;
  const error = await openDocumentFolder(payload);
  if (error) await dialog.showMessageBox({ type: "info", title: "GM Manager", message: error });
}

if (singleInstance) app.on("second-instance", (_event, argv) => {
  const target = argv.find((argument) => /^gmmanager:\/\//i.test(argument));
  if (target) {
    if (app.isReady()) void handleProtocolUrl(target);
    else pendingProtocolUrls.push(target);
  }
  if (mainWindow && !mainWindow.isDestroyed()) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
});
if (singleInstance) app.on("open-url", (event, target) => {
  event.preventDefault();
  if (app.isReady()) void handleProtocolUrl(target);
  else pendingProtocolUrls.push(target);
});

if (singleInstance) app.whenReady().then(() => {
  app.setAppUserModelId("com.mgarchi.gmcrm");
  if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient("gmmanager", process.execPath, [path.resolve(process.argv[1])]);
  else app.setAsDefaultProtocolClient("gmmanager");
  const trustedNotificationRequest = (webContents) => isTrustedUrl(webContents.getURL());
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "notifications" && trustedNotificationRequest(webContents));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return permission === "notifications" && (requestingOrigin === APP_ORIGIN || (webContents && trustedNotificationRequest(webContents)));
  });
  ipcMain.handle("gmcrm:select-workspace-folder", (event) => trustedIpcSender(event) ? selectWorkspaceFolder() : { ok: false, path: "", error: "Nguồn yêu cầu không hợp lệ." });
  ipcMain.handle("gmcrm:validate-workspace-folder", (event, payload = {}) => trustedIpcSender(event) ? validateWorkspaceFolder(payload) : { ok: false, path: "", error: "Nguồn yêu cầu không hợp lệ." });
  ipcMain.handle("gmcrm:open-document-folder", (event, payload = {}) => trustedIpcSender(event) ? openDocumentFolder(payload) : "Nguồn yêu cầu không hợp lệ.");
  ipcMain.handle("gmcrm:notification-support", (event) => trustedIpcSender(event) && Notification.isSupported());
  ipcMain.handle("gmcrm:notify", async (event, payload = {}) => {
    if (!trustedIpcSender(event)) return false;
    if (!Notification.isSupported()) return false;
    const title = String(payload.title || "GM-CRM").slice(0, 120);
    const body = String(payload.body || "").slice(0, 700);
    let notification;
    try { notification = new Notification({ title, body, icon: APP_ICON }); } catch { return false; }
    activeNotifications.add(notification);
    notification.on("click", () => openNotificationTarget(String(payload.url || APP_URL)));
    // A successful .show() call alone is not proof the OS accepted the toast.
    // Wait for Electron's display event or a definite failure before reporting
    // success to the web UI. OS focus modes can still suppress toast banners.
    return new Promise((resolve) => {
      let settled = false;
      const finish = (shown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (!shown) activeNotifications.delete(notification);
        resolve(shown);
      };
      const timeout = setTimeout(() => finish(false), 4000);
      notification.once("show", () => finish(true));
      notification.on("failed", () => { activeNotifications.delete(notification); finish(false); });
      notification.on("close", () => { activeNotifications.delete(notification); finish(false); });
      try { notification.show(); } catch { finish(false); }
    });
  });
  ipcMain.handle("gmcrm:open-drive", async (event, payload = {}) => {
    if (!trustedIpcSender(event)) return "Nguồn yêu cầu không hợp lệ.";
    const projectId = String(payload.projectId || "").trim();
    const houseId = String(payload.houseId || "").trim();
    const identifiers = [houseId, projectId].filter((value, index, values) => value && values.indexOf(value) === index);
    if (!identifiers.length || identifiers.some((value) => !safeDriveEntryName(value))) return "Mã nhà không hợp lệ.";
    const documentsFolder = await findProjectDocumentsFolder(payload);
    return documentsFolder ? shell.openPath(documentsFolder) : process.platform === "darwin" ? "Không tìm thấy Google Drive Desktop hoặc thư mục Tài liệu của mã nhà trên Mac." : "Không tìm thấy thư mục Tài liệu của mã nhà trên ổ I hoặc G.";
  });
  ipcMain.handle("gmcrm:open-file", async (event, payload = {}) => {
    if (!trustedIpcSender(event)) return "Nguồn yêu cầu không hợp lệ.";
    const projectId = String(payload.projectId || "").trim();
    const houseId = String(payload.houseId || "").trim();
    const fileName = safeDriveEntryName(payload.fileName);
    const snapshotName = safeDriveEntryName(payload.snapshotName);
    const identifiers = [houseId, projectId].filter((value, index, values) => value && values.indexOf(value) === index);
    if (!identifiers.length || identifiers.some((value) => !safeDriveEntryName(value))) return "Mã nhà không hợp lệ.";
    if (!fileName) return "Tên tệp không hợp lệ.";
    const documentsFolder = await findProjectDocumentsFolder(payload);
    if (!documentsFolder) return process.platform === "darwin" ? "Không tìm thấy Google Drive Desktop hoặc thư mục Tài liệu của mã nhà trên Mac." : "Không tìm thấy thư mục Tài liệu của mã nhà trên ổ I hoặc G.";
    const filePath = await findDriveFile(documentsFolder, fileName, snapshotName);
    if (!filePath) return `Không tìm thấy tệp ${fileName} trong thư mục Google Drive trên máy tính.`;
    return shell.openPath(filePath);
  });
  createWindow();
  const initialProtocolUrl = process.argv.find((argument) => /^gmmanager:\/\//i.test(argument));
  if (initialProtocolUrl) pendingProtocolUrls.push(initialProtocolUrl);
  pendingProtocolUrls.splice(0).forEach((target) => { void handleProtocolUrl(target); });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
