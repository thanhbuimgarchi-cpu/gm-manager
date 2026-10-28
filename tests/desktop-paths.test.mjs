import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
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

test("a workspace must contain both customer and personnel folders", async (t) => {
  const { temporary } = await fixture(t);
  const incomplete = path.join(temporary, "Incomplete", "GM Manager");
  await mkdir(path.join(incomplete, "Khách hàng"), { recursive: true });
  assert.equal(await helpers.normalizeWorkspaceRoot(incomplete), "");
  assert.equal(await helpers.normalizeWorkspaceRoot("GM Manager"), "");
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

test("native selection persists its root and IPC only accepts the application origin", async (t) => {
  const { temporary, root, snapshot } = await fixture(t);
  const ipcHandlers = new Map();
  const appEvents = new Map();
  const opened = [];
  const registrations = [];
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
    require: (name) => name === "electron" ? electron : name === "./path-utils.cjs" ? helpers : require(name),
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
});
