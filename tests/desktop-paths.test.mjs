import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import test from "node:test";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const helpers = require("../desktop/path-utils.cjs");

async function fixture(t) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "gm-manager-path-test-"));
  const root = path.join(temporary, "Shared drives", "GM Manager", "GM Manager");
  const documents = path.join(root, "Khách hàng", "2026", "T10", "DV 75", "Tài liệu");
  const snapshot = path.join(documents, "28-10-2026-DV 75");
  await Promise.all([mkdir(snapshot, { recursive: true }), mkdir(path.join(root, "Nhân lực"), { recursive: true })]);
  t.after(async () => {
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith("gm-manager-path-test-"));
    await rm(temporary, { recursive: true, force: true });
  });
  return { temporary, root, documents, snapshot };
}

test("choosing the inner, outer, or drive folder resolves the same valid workspace", async (t) => {
  const { temporary, root } = await fixture(t);
  for (const selected of [root, path.dirname(root), temporary]) {
    assert.equal(await helpers.normalizeWorkspaceRoot(selected), root);
  }
});

test("pasted customer, month and document-day paths resolve to the existing workspace ancestor", async (t) => {
  const { root, snapshot } = await fixture(t);
  for (const selected of [path.join(root, "Khách hàng"), path.dirname(snapshot), snapshot, `  "${snapshot}"  `]) {
    assert.equal(await helpers.normalizeWorkspaceRoot(selected), root);
  }
  assert.equal(await helpers.normalizeWorkspaceRoot(path.join(snapshot, "missing-folder")), "");
});

test("a selected storage folder can discover GM Manager below arbitrary team directories", async (t) => {
  const { temporary } = await fixture(t);
  const selected = path.join(temporary, "Other drive");
  const root = path.join(selected, "Company", "Shared with team", "Project data", "GM Manager");
  await Promise.all([mkdir(path.join(root, "Khách hàng"), { recursive: true }), mkdir(path.join(root, "Nhân lực"), { recursive: true })]);
  assert.equal(await helpers.normalizeWorkspaceRoot(selected), root);
});

test("a Customers-only share can be discovered from the drive, its parent or a descendant", async (t) => {
  const { temporary } = await fixture(t);
  const drive = path.join(temporary, "Other drive");
  const share = path.join(drive, "Shared with me", "Documents only");
  const customers = path.join(share, "Khách hàng");
  const documents = path.join(customers, "2026", "T10", "DV 75", "Tài liệu");
  const snapshot = path.join(documents, "28-10-2026-DV 75");
  await mkdir(snapshot, { recursive: true });
  for (const selected of [drive, share, customers, snapshot]) {
    assert.equal(await helpers.normalizeWorkspaceRoot(selected), customers);
  }
  assert.equal(await helpers.findDocumentSnapshotFolder(customers, { year: 2026, month: 10, houseId: "DV 75", snapshotName: path.basename(snapshot) }), snapshot);
  assert.equal(await helpers.findProjectDocumentsAtRoot(customers, { year: 2026, month: 9, houseId: "DV 75" }), "");
});

test("an incomplete GM Manager is accepted through its Customers folder", async (t) => {
  const { temporary } = await fixture(t);
  const incomplete = path.join(temporary, "Incomplete", "GM Manager");
  const customers = path.join(incomplete, "Khách hàng");
  await mkdir(customers, { recursive: true });
  assert.equal(await helpers.normalizeWorkspaceRoot(incomplete), customers);
  assert.equal(await helpers.normalizeWorkspaceRoot("GM Manager"), "");
});

test("broad searches prefer a full workspace, and ambiguous shares require a narrower selection", async (t) => {
  const { temporary } = await fixture(t);
  const drive = path.join(temporary, "Other drive");
  const first = path.join(drive, "Share A", "Khách hàng");
  const second = path.join(drive, "Share B", "Khách hàng");
  await Promise.all([mkdir(first, { recursive: true }), mkdir(second, { recursive: true })]);
  assert.equal(await helpers.normalizeWorkspaceRoot(drive), "");
  assert.equal(await helpers.normalizeWorkspaceRoot(first), first);
  const nearest = path.join(drive, "Khách hàng");
  await mkdir(nearest);
  assert.equal(await helpers.normalizeWorkspaceRoot(drive), nearest);
  const complete = path.join(drive, "Shared with team", "Project data", "GM Manager");
  await Promise.all([mkdir(path.join(complete, "Khách hàng"), { recursive: true }), mkdir(path.join(complete, "Nhân lực"), { recursive: true })]);
  assert.equal(await helpers.normalizeWorkspaceRoot(drive), complete);
});

test("shared Customers discovery does not follow links outside the selected drive", async (t) => {
  const { temporary } = await fixture(t);
  const drive = path.join(temporary, "Other drive");
  const outside = path.join(temporary, "Outside", "Khách hàng");
  await Promise.all([mkdir(drive), mkdir(outside, { recursive: true })]);
  await symlink(outside, path.join(drive, "Khách hàng"), process.platform === "win32" ? "junction" : "dir");
  assert.equal(await helpers.normalizeWorkspaceRoot(drive), "");
});

test("document paths use the selected year, month, house and snapshot only", async (t) => {
  const { root, documents, snapshot } = await fixture(t);
  const selected = { houseId: "DV 75", year: 2026, month: 10 };
  assert.equal(await helpers.findProjectDocumentsAtRoot(root, selected), documents);
  assert.equal(await helpers.findDocumentSnapshotFolder(root, { ...selected, snapshotName: "28-10-2026-DV 75" }), snapshot);
  assert.equal(await helpers.findDocumentSnapshotFolder(root, { ...selected, month: 9 }), "");
  assert.equal(await helpers.findDocumentSnapshotFolder(root, { ...selected, snapshotName: "27-10-2026-DV 75" }), "");
});

test("unsafe path segments and out-of-root paths are rejected", async (t) => {
  const { root } = await fixture(t);
  for (const name of ["..", ".", "DV/75", "DV\\75", "C:\\Windows", "evil\u0000name"]) assert.equal(helpers.safeDriveEntryName(name), "");
  assert.equal(await helpers.findDocumentSnapshotFolder(root, { year: "../../", month: 10, houseId: "DV 75" }), "");
  assert.equal(await helpers.findDocumentSnapshotFolder(root, { year: 2026, month: 10, houseId: "DV 75", snapshotName: ".." }), "");
  assert.equal(helpers.isWithinRoot(root, path.resolve(root, "..", "other")), false);
  assert.equal(helpers.sameDriveEntryName("Tài liệu", "TÀI LIỆU"), true);
});

test("equivalent Windows mounts preserve the exact shortcut target and selected root first", () => {
  const root = String.raw`I:\.shortcut-targets-by-id\1jY12yTvgh4ZvpuX6r4coOrOBwdPEDAqu\GM Manager`;
  const roots = helpers.workspaceLookupRoots(root);
  assert.equal(roots[0], root);
  assert.equal(roots[1], String.raw`G:\.shortcut-targets-by-id\1jY12yTvgh4ZvpuX6r4coOrOBwdPEDAqu\GM Manager`);
  assert.equal(roots.length, 26);
  assert.equal(new Set(roots).size, 26);
  assert.ok(roots.every((candidate) => candidate.slice(1) === root.slice(1)));
  const share = root + String.raw`\Khách hàng`;
  assert.ok(helpers.workspaceLookupRoots(share).every((candidate) => candidate.slice(1) === share.slice(1)));
  for (const ordinary of [String.raw`I:\Shared drives\GM Manager`, "/Volumes/Google Drive/GM Manager"]) {
    assert.deepEqual(helpers.workspaceLookupRoots(ordinary), [ordinary]);
  }
  assert.deepEqual(helpers.workspaceLookupRoots(""), []);
  assert.deepEqual(helpers.workspaceLookupRoots("relative/GM Manager"), []);
});

test("document lookup rejects a customer link escaping the workspace", async (t) => {
  const { temporary, root } = await fixture(t);
  const outside = path.join(temporary, "Another account", "Tài liệu");
  await mkdir(outside, { recursive: true });
  await symlink(path.dirname(outside), path.join(root, "Khách hàng", "2026", "T10", "OTHER"),
    process.platform === "win32" ? "junction" : "dir");
  assert.equal(await helpers.findProjectDocumentsAtRoot(root, { year: 2026, month: 10, houseId: "OTHER" }), "");
});

test("native selection persists its root and IPC only accepts the application origin", async (t) => {
  const { temporary, root, snapshot } = await fixture(t);
  const ipcHandlers = new Map();
  const appEvents = new Map();
  const opened = [];
  const registrations = [];
  const mirroredRoots = new Map();
  let stalledRoot = "";
  const nativeHelpers = {
    ...helpers,
    workspaceLookupRoots: (root) => mirroredRoots.get(root) || helpers.workspaceLookupRoots(root),
    findProjectDocumentsAtRoot: (root, payload) => root === stalledRoot ? new Promise(() => {}) : helpers.findProjectDocumentsAtRoot(root, payload),
  };
  let notificationMode = "show";
  class NativeNotification extends EventEmitter {
    static isSupported() { return notificationMode !== "unsupported"; }
    show() { queueMicrotask(() => this.emit(notificationMode === "show" ? "show" : "failed")); }
  }
  const app = {
    isPackaged: false, requestSingleInstanceLock: () => true, quit() {},
    whenReady: () => Promise.resolve(), isReady: () => true,
    getPath: () => path.join(temporary, "userData"),
    on: (event, handler) => appEvents.set(event, handler),
    setAppUserModelId() {}, setAsDefaultProtocolClient: (...args) => registrations.push(args),
  };
  class Window {
    constructor() { this.webContents = { setWindowOpenHandler() {}, on() {}, getURL: () => "https://thanhbuimgarchi-cpu.github.io/gm-manager/" }; }
    loadURL() {} on() {} isDestroyed() { return false; } isMinimized() { return false; } show() {} focus() {}
    static getAllWindows() { return []; }
  }
  const electron = {
    app, BrowserWindow: Window, Notification: NativeNotification,
    ipcMain: { handle: (channel, handler) => ipcHandlers.set(channel, handler) },
    shell: { openPath: async (folder) => { opened.push(folder); return ""; }, openExternal() {} },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [path.dirname(root)] }), showMessageBox: async () => {} },
  };
  const source = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");
  vm.runInNewContext(source, {
    require: (name) => name === "electron" ? electron : name === "./path-utils.cjs" ? nativeHelpers : require(name),
    __dirname: path.resolve("desktop"), process: { platform: process.platform, argv: [], defaultApp: false }, URL, setTimeout, clearTimeout,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const trusted = { senderFrame: { url: "https://thanhbuimgarchi-cpu.github.io/gm-manager/" } };
  const untrusted = { senderFrame: { url: "https://example.org/" } };
  const select = ipcHandlers.get("gmcrm:select-workspace-folder");
  assert.equal((await select(untrusted)).ok, false);
  assert.equal((await select(trusted)).path, root);
  assert.equal(JSON.parse(await readFile(path.join(temporary, "userData", "workspace-location.json"), "utf8")).path, root);
  assert.equal((await ipcHandlers.get("gmcrm:validate-workspace-folder")(trusted)).ok, true);
  assert.equal((await ipcHandlers.get("gmcrm:validate-workspace-folder")(trusted, { path: snapshot })).path, root);
  const payload = { year: 2026, month: 10, houseId: "DV 75", snapshotName: "28-10-2026-DV 75" };
  assert.equal(await ipcHandlers.get("gmcrm:open-document-folder")(trusted, payload), "");
  assert.equal(opened.at(-1), snapshot);
  assert.notEqual(await ipcHandlers.get("gmcrm:open-document-folder")(untrusted, payload), "");
  assert.equal(registrations[0][0], "gmmanager");
  assert.equal(ipcHandlers.get("gmcrm:notification-support")(trusted), true);
  assert.equal(await ipcHandlers.get("gmcrm:notify")(trusted, { title: "Test", body: "Synthetic notification" }), true);
  notificationMode = "failed";
  assert.equal(await ipcHandlers.get("gmcrm:notify")(trusted, { title: "Test" }), false);
  notificationMode = "unsupported";
  assert.equal(ipcHandlers.get("gmcrm:notification-support")(trusted), false);
  assert.equal(await ipcHandlers.get("gmcrm:notify")(trusted, { title: "Test" }), false);
  assert.equal(await ipcHandlers.get("gmcrm:notify")(untrusted, { title: "Test" }), false);
  appEvents.get("second-instance")({}, ["gmmanager://open-documents?year=2026&month=10&houseId=DV%2075&snapshotName=28-10-2026-DV%2075"]);
  for (let attempt = 0; opened.length < 2 && attempt < 30; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(opened.length, 2);
  const alternateRoot = path.join(temporary, "Another drive", "GM Manager");
  const alternateSnapshot = path.join(alternateRoot, "Khách hàng", "2026", "T10", "DV 75", "Tài liệu", payload.snapshotName);
  await Promise.all([mkdir(alternateSnapshot, { recursive: true }), mkdir(path.join(alternateRoot, "Nhân lực"), { recursive: true })]);
  const query = new URLSearchParams({ ...payload, year: String(payload.year), month: String(payload.month), workspacePath: path.join(alternateRoot, "Khách hàng") });
  appEvents.get("second-instance")({}, [`gmmanager://open-documents?${query}`]);
  for (let attempt = 0; opened.length < 3 && attempt < 30; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(opened.at(-1), alternateSnapshot);
  assert.equal(JSON.parse(await readFile(path.join(temporary, "userData", "workspace-location.json"), "utf8")).path, alternateRoot);

  const sharedDrive = path.join(temporary, "Customers share");
  const sharedCustomers = path.join(sharedDrive, "Khách hàng");
  const sharedSnapshot = path.join(sharedCustomers, "2026", "T10", "DV 75", "Tài liệu", payload.snapshotName);
  await mkdir(sharedSnapshot, { recursive: true });
  assert.equal((await ipcHandlers.get("gmcrm:validate-workspace-folder")(trusted, { path: sharedDrive })).path, sharedCustomers);
  assert.equal(JSON.parse(await readFile(path.join(temporary, "userData", "workspace-location.json"), "utf8")).path, sharedCustomers);
  assert.equal(await ipcHandlers.get("gmcrm:open-document-folder")(trusted, payload), "");
  assert.equal(opened.at(-1), sharedSnapshot);

  const shortcutSuffix = path.join(".shortcut-targets-by-id", "same-remote-folder-123", "GM Manager");
  const savedRoot = path.join(temporary, "Mount I", shortcutSuffix);
  const mirrorRoot = path.join(temporary, "Mount G", shortcutSuffix);
  const mirrorDocuments = path.join(mirrorRoot, "Khách hàng", "2026", "T11", "HG-112", "Tài liệu");
  const mirrorSnapshot = path.join(mirrorDocuments, "11-11-2026-HG-112");
  await Promise.all([
    mkdir(path.join(savedRoot, "Khách hàng"), { recursive: true }),
    mkdir(path.join(savedRoot, "Nhân lực"), { recursive: true }),
    mkdir(mirrorSnapshot, { recursive: true }),
    mkdir(path.join(mirrorRoot, "Nhân lực"), { recursive: true }),
  ]);
  mirroredRoots.set(savedRoot, [savedRoot, mirrorRoot]);
  assert.equal((await ipcHandlers.get("gmcrm:validate-workspace-folder")(trusted, { path: savedRoot })).path, savedRoot);
  const mirrorPayload = { year: 2026, month: 11, houseId: "HG-112", snapshotName: "11-11-2026-HG-112" };
  assert.equal(await ipcHandlers.get("gmcrm:open-drive")(trusted, mirrorPayload), "");
  assert.equal(opened.at(-1), mirrorDocuments, "a stale saved mount can use the exact same shared-folder target");

  const savedDocuments = path.join(savedRoot, "Khách hàng", "2026", "T11", "HG-112", "Tài liệu");
  await mkdir(path.join(savedDocuments, "10-11-2026-HG-112"), { recursive: true });
  await writeFile(path.join(savedDocuments, "10-11-2026-HG-112", "drawing.pdf"), "synthetic older file");
  await writeFile(path.join(mirrorSnapshot, "drawing.pdf"), "synthetic current file");
  assert.equal(await ipcHandlers.get("gmcrm:open-file")(trusted, { ...mirrorPayload, fileName: "drawing.pdf" }), "");
  assert.equal(opened.at(-1), path.join(mirrorSnapshot, "drawing.pdf"), "an older same-named file cannot hide the exact day on another mount");
  assert.equal(await ipcHandlers.get("gmcrm:open-document-folder")(trusted, mirrorPayload), "");
  assert.equal(opened.at(-1), mirrorSnapshot);
  await mkdir(path.join(savedDocuments, mirrorPayload.snapshotName));
  assert.equal(await ipcHandlers.get("gmcrm:open-document-folder")(trusted, { ...mirrorPayload, fileName: "drawing.pdf" }), "");
  assert.equal(opened.at(-1), mirrorSnapshot, "a present but empty selected-day folder does not stop the mirror file search");
  assert.equal(await ipcHandlers.get("gmcrm:open-drive")(trusted, mirrorPayload), "");
  assert.equal(opened.at(-1), savedDocuments, "the selected account stays preferred when its requested folder exists");

  const missingPeriod = await ipcHandlers.get("gmcrm:open-drive")(trusted, { ...mirrorPayload, month: 10 });
  assert.match(missingPeriod, /chọn lại thư mục/);
  assert.match(await ipcHandlers.get("gmcrm:open-file")(trusted, { ...mirrorPayload, snapshotName: "../", fileName: "drawing.pdf" }), /không hợp lệ/);
  const legacyPayload = { ...mirrorPayload, snapshotName: "legacy-flat-day", fileName: "drawing.pdf" };
  assert.equal(await ipcHandlers.get("gmcrm:open-file")(trusted, legacyPayload), "");
  assert.equal(opened.at(-1), path.join(savedDocuments, "10-11-2026-HG-112", "drawing.pdf"), "legacy flattened layouts remain readable after exact-day candidates are exhausted");
  assert.equal(JSON.parse(await readFile(path.join(temporary, "userData", "workspace-location.json"), "utf8")).path, savedRoot);

  stalledRoot = savedRoot;
  assert.equal(await ipcHandlers.get("gmcrm:open-drive")(trusted, mirrorPayload), "");
  assert.equal(opened.at(-1), mirrorDocuments, "a disconnected account cannot prevent opening the synchronized equivalent mount");
  stalledRoot = "";
  assert.equal((await ipcHandlers.get("gmcrm:validate-workspace-folder")(trusted, { path: alternateRoot })).path, alternateRoot);
  assert.match(await ipcHandlers.get("gmcrm:open-drive")(trusted, mirrorPayload), /chọn lại thư mục/,
    "an ordinary selected root cannot switch to an unrelated workspace containing the same house code");
});
