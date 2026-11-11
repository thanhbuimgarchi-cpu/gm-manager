const { app, BrowserWindow, Notification, ipcMain, shell, session, dialog, Tray, Menu, nativeImage, nativeTheme } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { safeDriveEntryName, sameDriveEntryName, isWithinRoot, normalizeWorkspaceRoot, findProjectDocumentsAtRoot, findDocumentSnapshotFolder, workspaceLookupRoots } = require("./path-utils.cjs");
const { createBackgroundController } = require(path.join(__dirname, "background.cjs"));
const { createDesktopUpdateController } = require(path.join(__dirname, "update.cjs"));
const { createInstallerHandoff } = require(path.join(__dirname, "install-update.cjs"));
const { createUpdatePreparation } = require(path.join(__dirname, "update-preparation.cjs"));

const APP_URL = "https://thanhbuimgarchi-cpu.github.io/gm-manager/";
const APP_ORIGIN = new URL(APP_URL).origin;
const DESKTOP_BACKGROUND = { light: "#ffffff", dark: "#1d222b" };
// Chromium's normal-contrast menu background on Windows.
const WINDOWS_CAPTION_BACKGROUND = { light: "#ffffff", dark: "#292a2d" };
const WINDOWS_DRIVE_ROOTS = ["I:\\Shared drives", "I:\\My Drive", "G:\\Shared drives", "G:\\My Drive"];
const APP_ICON = app.isPackaged ? path.join(process.resourcesPath, "gm-logo-512.png") : path.join(__dirname, "..", "public", "gm-logo-512.png");
let mainWindow = null;
let colorTheme = "light";
let workspaceFolder;
let pendingForegroundLaunch = false;
const pendingProtocolUrls = [];
const activeNotifications = new Set();
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
const backgroundController = createBackgroundController({ app, Tray, Menu, nativeImage, platform: process.platform, execPath: process.execPath, argv: process.argv, iconPath: APP_ICON, getWindow: () => mainWindow, createWindow: () => createWindow() });
const updateDirectory = () => path.join(app.getPath("userData"), "desktop-updates");
const updatePreparation = createUpdatePreparation({ getWindow: () => mainWindow });
const installerHandoff = createInstallerHandoff({ app, spawn, updateDirectory, platform: process.platform });
const desktopUpdateController = createDesktopUpdateController({
  getVersion: () => app.getVersion(), platform: process.platform, isPackaged: app.isPackaged,
  fetcher: (...args) => fetch(...args), openExternal: (url) => shell.openExternal(url),
  updateDirectory,
  onProgress: (state) => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed?.()) {
      try { mainWindow.webContents.send("gmcrm:update-progress", state); } catch { /* Renderer may be reloading. */ }
    }
  },
  installVerifiedUpdate: async (update) => {
    await updatePreparation.prepare();
    return installerHandoff.installVerifiedUpdate(update);
  },
});
app.on("before-quit", backgroundController.beginQuit);
app.on("will-quit", backgroundController.dispose);

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

function trustedStartupIpcSender(event) {
  try {
    const frame = event.senderFrame;
    if (!frame || frame.parent || (frame.top && frame.top !== frame) || (event.sender?.mainFrame && event.sender.mainFrame !== frame)) return false;
    const url = new URL(frame.url);
    return url.origin === APP_ORIGIN && (url.pathname === "/gm-manager" || url.pathname.startsWith("/gm-manager/"));
  } catch { return false; }
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
  if (!folder) return { ok: false, path: "", error: "Chưa xác định được thư mục dữ liệu. Hãy chọn trực tiếp thư mục GM Manager hoặc Khách hàng đã được chia sẻ." };
  try { await saveWorkspaceFolder(folder); } catch { return { ok: false, path: "", error: "Không thể lưu vị trí thư mục trên máy này. Hãy thử chọn lại." }; }
  return { ok: true, path: folder };
}

async function selectWorkspaceFolder() {
  const options = { title: "Chọn ổ đĩa hoặc thư mục chứa dữ liệu GM Manager", buttonLabel: "Chọn vị trí này", properties: ["openDirectory"], defaultPath: await readWorkspaceFolder() || undefined };
  const selected = mainWindow && !mainWindow.isDestroyed() ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
  if (selected.canceled || !selected.filePaths[0]) return { ok: false, canceled: true, path: await readWorkspaceFolder() || "" };
  return validateWorkspaceFolder({ path: selected.filePaths[0] });
}

function applyWindowCaptionTheme(window) {
  if (process.platform !== "win32" || !window || window.isDestroyed()) return;
  const usesSystemColors = nativeTheme?.shouldUseHighContrastColors || nativeTheme?.inForcedColorsMode;
  window.setAccentColor?.(usesSystemColors ? null : WINDOWS_CAPTION_BACKGROUND[colorTheme]);
}

function createWindow({ show = true } = {}) {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 700,
    title: "GM-CRM",
    icon: APP_ICON,
    backgroundColor: DESKTOP_BACKGROUND[colorTheme],
    show,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: process.platform !== "win32",
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  applyWindowCaptionTheme(window);
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
  backgroundController.attachWindow(window);
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

async function lookupWithinDeadline(deadline, lookup) {
  const remaining = Math.min(1500, deadline - Date.now());
  if (remaining <= 0) return "";
  let timer;
  try {
    return await Promise.race([
      lookup(),
      new Promise((resolve) => { timer = setTimeout(() => resolve(""), remaining); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function* documentWorkspaceRoots(deadline) {
  const selectedRoot = await readWorkspaceFolder();
  if (selectedRoot) {
    yield* workspaceLookupRoots(selectedRoot);
    return;
  }
  // Older installations have no saved location. Discover a workspace first,
  // then use the same exact year/month/customer lookup as a selected root.
  const found = new Set();
  for (const drive of await googleDriveRoots()) {
    if (Date.now() >= deadline) break;
    const root = await lookupWithinDeadline(deadline, () => normalizeWorkspaceRoot(drive));
    if (root && !found.has(root)) {
      found.add(root);
      yield root;
    }
  }
}

async function findProjectDocumentsFolder(payload) {
  const deadline = Date.now() + 6000;
  for await (const root of documentWorkspaceRoots(deadline)) {
    const documents = await lookupWithinDeadline(deadline, () => findProjectDocumentsAtRoot(root, payload));
    if (documents) return documents;
  }
  return "";
}

async function missingDocumentsMessage(payload = {}) {
  if (!await readWorkspaceFolder()) return "Hãy chọn thư mục GM Manager hoặc Khách hàng trong phần đăng nhập trước.";
  const house = safeDriveEntryName(payload.houseId || payload.projectId) || "hồ sơ";
  return `Không tìm thấy thư mục Tài liệu của ${house} tại vị trí GM Manager đã chọn. Hãy kiểm tra Drive đã đồng bộ hoặc chọn lại thư mục GM Manager/Khách hàng.`;
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
  return "";
}

async function openDocumentFolder(payload = {}) {
  let fallbackFolder = "";
  const deadline = Date.now() + 6000;
  for await (const root of documentWorkspaceRoots(deadline)) {
    const folder = await lookupWithinDeadline(deadline, () => findDocumentSnapshotFolder(root, payload));
    if (!folder) continue;
    if (!payload.fileName) return shell.openPath(folder);
    fallbackFolder ||= folder;
    const file = await lookupWithinDeadline(deadline, () => findDriveFile(folder, payload.fileName, ""));
    if (file) return shell.openPath(path.dirname(file));
  }
  return fallbackFolder ? shell.openPath(fallbackFolder) : missingDocumentsMessage(payload);
}

async function handleProtocolUrl(value) {
  let url;
  try { url = new URL(value); } catch { return; }
  if (url.protocol !== "gmmanager:" || url.hostname !== "open-documents" || (url.pathname && url.pathname !== "/")) return;
  const payload = { houseId: url.searchParams.get("houseId"), projectId: url.searchParams.get("projectId"), year: url.searchParams.get("year"), month: url.searchParams.get("month"), snapshotName: url.searchParams.get("snapshotName") || "" };
  if (![payload.houseId, payload.projectId].some((name) => safeDriveEntryName(name)) || (payload.snapshotName && !safeDriveEntryName(payload.snapshotName))) return;
  if (!/^\d{4}$/.test(payload.year || "") || !Number.isInteger(Number(payload.month)) || Number(payload.month) < 1 || Number(payload.month) > 12) return;
  const requestedWorkspace = url.searchParams.get("workspacePath");
  if (requestedWorkspace && requestedWorkspace.length > 4096) return;
  let validation = await validateWorkspaceFolder(requestedWorkspace ? { path: requestedWorkspace } : {});
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
  if (!backgroundController.shouldStartHidden(argv) || target) {
    if (app.isReady()) backgroundController.showWindow();
    else pendingForegroundLaunch = true;
  }
});
if (singleInstance) app.on("open-url", (event, target) => {
  event.preventDefault();
  if (app.isReady()) void handleProtocolUrl(target);
  else pendingProtocolUrls.push(target);
});

if (singleInstance) app.whenReady().then(() => {
  app.setAppUserModelId("com.mgarchi.gmcrm");
  if (nativeTheme) {
    nativeTheme.themeSource = colorTheme;
    nativeTheme.on("updated", () => applyWindowCaptionTheme(mainWindow));
  }
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
  const deniedStartupSettings = () => ({ supported: false, canChange: false, openAtLogin: false, ok: false, error: "Nguồn yêu cầu không hợp lệ." });
  ipcMain.handle("gmcrm:get-startup-settings", (event) => trustedStartupIpcSender(event) ? backgroundController.getStartupSettings() : deniedStartupSettings());
  ipcMain.handle("gmcrm:set-startup-settings", (event, payload) => trustedStartupIpcSender(event) ? backgroundController.setStartupSettings(payload) : deniedStartupSettings());
  ipcMain.handle("gmcrm:set-color-theme", (event, theme) => {
    if (!trustedStartupIpcSender(event) || (theme !== "light" && theme !== "dark")) return false;
    if (theme === colorTheme) return true;
    colorTheme = theme;
    if (nativeTheme) nativeTheme.themeSource = theme;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(DESKTOP_BACKGROUND[theme]);
      applyWindowCaptionTheme(mainWindow);
    }
    return true;
  });
  const deniedUpdate = () => ({ supported: false, updateAvailable: false, ok: false, error: "Nguồn yêu cầu không hợp lệ." });
  ipcMain.handle("gmcrm:get-app-info", (event) => trustedStartupIpcSender(event) ? desktopUpdateController.getAppInfo() : deniedUpdate());
  ipcMain.handle("gmcrm:check-for-updates", (event) => trustedStartupIpcSender(event) ? desktopUpdateController.checkForUpdates() : deniedUpdate());
  ipcMain.handle("gmcrm:download-update", (event) => trustedStartupIpcSender(event) ? desktopUpdateController.downloadUpdate() : deniedUpdate());
  ipcMain.handle("gmcrm:install-update", (event) => trustedStartupIpcSender(event) ? desktopUpdateController.installUpdate() : deniedUpdate());
  ipcMain.handle("gmcrm:get-update-state", (event) => trustedStartupIpcSender(event) ? desktopUpdateController.getUpdateState() : deniedUpdate());
  ipcMain.handle("gmcrm:update-prepared", (event, payload) => trustedStartupIpcSender(event) && updatePreparation.acknowledge(event.sender, payload));
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
    return documentsFolder ? shell.openPath(documentsFolder) : missingDocumentsMessage(payload);
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
    if (payload.snapshotName && !snapshotName) return "Ngày tài liệu không hợp lệ.";
    const documentsFolders = [];
    const deadline = Date.now() + 6000;
    for await (const root of documentWorkspaceRoots(deadline)) {
      const documentsFolder = await lookupWithinDeadline(deadline, () => findProjectDocumentsAtRoot(root, payload));
      if (!documentsFolder) continue;
      documentsFolders.push(documentsFolder);
      const filePath = await lookupWithinDeadline(deadline, () => findDriveFile(documentsFolder, fileName, snapshotName));
      if (filePath) return shell.openPath(filePath);
    }
    // Older Drive Desktop layouts may flatten day folders. Only consider
    // those files after checking the exact day on every equivalent mount.
    if (snapshotName) for (const documentsFolder of documentsFolders) {
      const filePath = await lookupWithinDeadline(deadline, () => findDriveFile(documentsFolder, fileName, ""));
      if (filePath) return shell.openPath(filePath);
    }
    return documentsFolders.length ? `Không tìm thấy tệp ${fileName} trong thư mục Google Drive trên máy tính.` : missingDocumentsMessage(payload);
  });
  const initialProtocolUrl = process.argv.find((argument) => /^gmmanager:\/\//i.test(argument));
  if (initialProtocolUrl) pendingProtocolUrls.push(initialProtocolUrl);
  backgroundController.createTray();
  createWindow({ show: pendingForegroundLaunch || pendingProtocolUrls.length > 0 || !backgroundController.shouldStartHidden() });
  pendingProtocolUrls.splice(0).forEach((target) => { void handleProtocolUrl(target); });
  app.on("activate", () => {
    if (process.platform === "win32") backgroundController.showWindow();
    else if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && !backgroundController.hasTray()) app.quit();
});
