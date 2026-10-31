import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const { createDesktopUpdateController, parseDesktopVersion, compareDesktopVersions, validateDesktopManifest, MANIFEST_URL } = require("../desktop/update.cjs");
const manifest = (version = "1.2.0") => ({ version, installerUrl: `https://github.com/thanhbuimgarchi-cpu/gm-manager/releases/download/desktop-latest/GM-CRM-Setup-${version}.exe`, sha256: "a".repeat(64), size: 111000000 });
const reply = (value) => ({ ok: true, headers: { get: () => null }, text: async () => JSON.stringify(value) });
const plain = (value) => JSON.parse(JSON.stringify(value));
function fixture(options = {}) {
  const reads = [], opened = [];
  const controller = createDesktopUpdateController({
    getVersion: () => options.version || "1.1.0", platform: options.platform || "win32", isPackaged: options.packaged !== false,
    fetcher: async (...args) => { reads.push(args); return options.fetcher ? options.fetcher(...args) : reply(options.manifest || manifest()); },
    openExternal: async (url) => { opened.push(url); if (options.openFails) throw new Error("Synthetic browser failure"); },
  });
  return { controller, reads, opened };
}

test("desktop versions are compared numerically and malformed versions never become executable URLs", () => {
  assert.equal(compareDesktopVersions("1.10.0", "1.2.9"), 1);
  assert.equal(compareDesktopVersions("1.2.0", "1.2.0"), 0);
  assert.equal(compareDesktopVersions("1.1.9", "1.2.0"), -1);
  for (const bad of ["v1.2.0", "1.2", "1.2.0-beta", "01.2.0", "1.2.0/../../run", "1000000.0.0", "", null]) {
    assert.equal(parseDesktopVersion(bad), null);
    assert.throws(() => validateDesktopManifest({ ...manifest(), version: bad }));
  }
});

test("the manifest accepts only the versioned installer in this repository and verified release metadata", () => {
  assert.deepEqual(validateDesktopManifest(manifest()), manifest());
  assert.deepEqual(validateDesktopManifest({ available: false }), { available: false });
  for (const installerUrl of ["https://example.org/setup.exe", manifest().installerUrl + "?redirect=other", manifest().installerUrl + "#fragment", manifest().installerUrl.replace("1.2.0.exe", "1.3.0.exe"), manifest().installerUrl.replace("github.com/", "github.com.evil.invalid/")]) assert.throws(() => validateDesktopManifest({ ...manifest(), installerUrl }));
  for (const invalid of [{ sha256: "not-a-sha" }, { size: 0 }, { size: 2 ** 40 }, { size: "111" }]) assert.throws(() => validateDesktopManifest({ ...manifest(), ...invalid }));
});

test("checking is read-only, cache-busted and deadline bounded; only a newer native version is offered", async () => {
  const f = fixture();
  assert.deepEqual(f.controller.getAppInfo(), { version: "1.1.0", platform: "win32", isPackaged: true });
  const state = await f.controller.checkForUpdates();
  assert.equal(state.currentVersion, "1.1.0"); assert.equal(state.latestVersion, "1.2.0"); assert.equal(state.updateAvailable, true);
  assert.ok(f.reads[0][0].startsWith(`${MANIFEST_URL}?time=`));
  assert.equal(f.reads[0][1].redirect, "error"); assert.equal(f.reads[0][1].cache, "no-store"); assert.ok(f.reads[0][1].signal instanceof AbortSignal);
  assert.deepEqual(f.opened, []);
  for (const version of ["1.2.0", "1.3.0"]) assert.equal((await fixture({ version }).controller.checkForUpdates()).updateAvailable, false);
});

test("a browser download requires an explicit call and always checks the pinned release before opening", async () => {
  const f = fixture();
  await f.controller.checkForUpdates();
  assert.equal(f.opened.length, 0);
  assert.deepEqual(await f.controller.downloadUpdate(), { ok: true });
  assert.deepEqual(f.opened, [manifest().installerUrl]);
  assert.equal(f.reads.length, 2, "a later download validates the current manifest again");
  assert.equal((await fixture({ version: "1.2.0" }).controller.downloadUpdate()).ok, false);
  assert.equal((await fixture({ openFails: true }).controller.downloadUpdate()).ok, false);
  assert.match((await fixture({ manifest: { available: false } }).controller.downloadUpdate()).error, /chưa được phát hành/);
});

test("concurrent checks coalesce and failures can be retried without pretending the client is current", async () => {
  let release;
  const f = fixture({ fetcher: () => new Promise((resolve) => { release = resolve; }) });
  const first = f.controller.checkForUpdates(), second = f.controller.checkForUpdates();
  assert.equal(first, second); assert.equal(f.reads.length, 1);
  release(reply(manifest()));
  assert.equal((await first).updateAvailable, true);
  let fails = true;
  const recover = fixture({ fetcher: async () => { if (fails) throw new Error("Synthetic offline"); return reply(manifest()); } });
  assert.ok((await recover.controller.checkForUpdates()).error);
  assert.deepEqual(recover.opened, []);
  fails = false;
  assert.equal((await recover.controller.checkForUpdates()).updateAvailable, true);
});

test("unsupported platforms and development runs do not fetch or open installers", async () => {
  for (const options of [{ platform: "darwin" }, { platform: "linux" }, { packaged: false }]) {
    const f = fixture(options);
    assert.equal((await f.controller.checkForUpdates()).supported, false);
    assert.equal((await f.controller.downloadUpdate()).ok, false);
    assert.equal(f.reads.length, 0); assert.equal(f.opened.length, 0);
  }
});

test("oversized headers and streamed bodies are rejected without retaining an unbounded response", async () => {
  let read = false;
  const header = fixture({ fetcher: async () => ({ ok: true, headers: { get: () => "70000" }, text: async () => { read = true; return "{}"; } }) });
  assert.ok((await header.controller.checkForUpdates()).error); assert.equal(read, false);
  let cancelled = false, released = false;
  const stream = fixture({ fetcher: async () => ({ ok: true, headers: { get: () => null }, body: { getReader: () => ({ read: async () => ({ value: new Uint8Array(70000), done: false }), cancel: async () => { cancelled = true; }, releaseLock: () => { released = true; } }) } }) });
  assert.ok((await stream.controller.checkForUpdates()).error); assert.equal(cancelled, true); assert.equal(released, true);
});

test("an incomplete release does not claim an update or expose a download URL", async () => {
  const f = fixture({ manifest: { available: false } });
  const result = await f.controller.checkForUpdates();
  assert.equal(result.available, false); assert.equal(result.updateAvailable, false); assert.equal(result.downloadUrl, undefined); assert.equal(result.error, undefined);
});

test("native update IPC uses the top GM Manager frame, pins the download, and packages the helper", async () => {
  const handlers = new Map(), opened = [];
  const app = Object.assign(new EventEmitter(), { isPackaged: true, requestSingleInstanceLock: () => true, quit() {}, whenReady: () => Promise.resolve(), isReady: () => true, getVersion: () => "1.1.0", setAppUserModelId() {}, setAsDefaultProtocolClient() {}, getLoginItemSettings: () => ({ openAtLogin: false }) });
  class Window extends EventEmitter {
    constructor() { super(); this.webContents = { setWindowOpenHandler() {}, on() {}, getURL: () => "https://thanhbuimgarchi-cpu.github.io/gm-manager/" }; }
    loadURL() {} isDestroyed() { return false; }
  }
  const electron = { app, BrowserWindow: Window, Notification: { isSupported: () => false }, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, shell: { openExternal: async (url) => opened.push(url) }, session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } }, dialog: {} };
  const source = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");
  vm.runInNewContext(source, { require: (name) => name === "electron" ? electron : require(name.startsWith("./") ? path.resolve("desktop", name) : name), __dirname: path.resolve("desktop"), process: { platform: "win32", execPath: "C:\\GM\\GM-CRM.exe", argv: [], resourcesPath: "C:\\GM\\resources" }, URL, fetch: async () => reply(manifest()), setTimeout, clearTimeout });
  await new Promise((resolve) => setImmediate(resolve));
  const frame = { url: "https://thanhbuimgarchi-cpu.github.io/gm-manager/", parent: null }; frame.top = frame;
  const trusted = { senderFrame: frame, sender: { mainFrame: frame } };
  for (const event of [{}, { senderFrame: { url: "https://example.org/" } }, { senderFrame: { url: "https://thanhbuimgarchi-cpu.github.io/another-repository/" } }, { senderFrame: { ...frame, parent: {} } }]) {
    for (const channel of ["gmcrm:get-app-info", "gmcrm:check-for-updates", "gmcrm:download-update"]) assert.equal((await handlers.get(channel)(event)).ok, false);
  }
  assert.equal(plain(handlers.get("gmcrm:get-app-info")(trusted)).version, "1.1.0");
  assert.equal((await handlers.get("gmcrm:check-for-updates")(trusted)).updateAvailable, true);
  assert.equal((await handlers.get("gmcrm:download-update")(trusted, { url: "https://example.org/evil.exe" })).ok, true);
  assert.deepEqual(opened, [manifest().installerUrl]);
  const desktopPackage = JSON.parse(await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"));
  assert.ok(desktopPackage.build.files.includes("update.cjs"));
});

test("preload offers version and update methods without exposing IPC or executable parameters", async () => {
  const calls = []; let bridge;
  const source = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  vm.runInNewContext(source, { process: { platform: "win32" }, require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } }, ipcRenderer: { invoke: async (...args) => { calls.push(args); return {}; } } }) });
  await bridge.getAppInfo(); await bridge.checkForUpdates(); await bridge.downloadUpdate("https://example.org/evil.exe");
  assert.deepEqual(calls, [["gmcrm:get-app-info"], ["gmcrm:check-for-updates"], ["gmcrm:download-update"]]);
});
