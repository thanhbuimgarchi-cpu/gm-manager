import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
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
    for (const channel of ["gmcrm:get-app-info", "gmcrm:check-for-updates", "gmcrm:download-update", "gmcrm:install-update", "gmcrm:get-update-state"]) assert.equal((await handlers.get(channel)(event)).ok, false);
    assert.equal(await handlers.get("gmcrm:update-prepared")(event, { requestId: "forged", ok: true }), false);
  }
  assert.equal(plain(handlers.get("gmcrm:get-app-info")(trusted)).version, "1.1.0");
  assert.equal(plain(handlers.get("gmcrm:get-app-info")(trusted)).integratedUpdates, true);
  assert.deepEqual(plain(handlers.get("gmcrm:get-update-state")(trusted)), { phase: "idle", percent: 0 });
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

async function integratedFixture(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gm-update-test-"));
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("gm-update-test-"));
    await rm(directory, { recursive: true, force: true });
  });
  const bytes = Buffer.from("MZ synthetic installer bytes - never executable");
  const release = { ...manifest("1.3.0"), size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), ...options.manifest };
  const requests = [], events = [], handoffs = [], opened = [];
  const state = { ...options };
  const binary = (content = bytes, extra = {}) => ({
    ok: true, status: 200, headers: new Headers(),
    body: new ReadableStream({ start(controller) { controller.enqueue(content); controller.close(); } }),
    ...extra,
  });
  const controller = createDesktopUpdateController({
    getVersion: () => options.version || "1.2.1", platform: options.platform || "win32", isPackaged: options.packaged !== false,
    updateDirectory: options.directory || directory,
    fetcher: async (url, request) => {
      requests.push({ url, request });
      if (url.startsWith(MANIFEST_URL)) return reply(release);
      return state.fetchBinary ? state.fetchBinary(url, request) : binary();
    },
    onProgress: event => { events.push(event); if (options.badProgressListener) throw new Error("Renderer closed"); },
    openExternal: async url => opened.push(url),
    installVerifiedUpdate: options.noHandoff ? undefined : async payload => { handoffs.push(payload); if (state.handoffFails) return { ok: false, error: "Không thể chạy bộ cài kiểm thử." }; return { ok: true }; },
  });
  return { directory, bytes, release, requests, events, handoffs, opened, controller, state, binary };
}

test("integrated updates stream, verify and atomically stage an installer before the native handoff", async t => {
  const f = await integratedFixture(t);
  assert.equal(f.controller.getAppInfo().integratedUpdates, true);
  assert.deepEqual(f.controller.getUpdateState(), { phase: "idle", percent: 0 });
  const result = await f.controller.installUpdate({ url: "https://evil.invalid/run.exe", installerPath: "C:\\evil.exe" });
  assert.deepEqual(result, { ok: true, version: "1.3.0", restarting: true });
  assert.deepEqual(f.opened, [], "integrated updates never open a browser");
  assert.equal(f.handoffs.length, 1);
  const handoff = f.handoffs[0];
  assert.equal(path.dirname(path.dirname(handoff.installerPath)), f.directory);
  assert.match(path.basename(path.dirname(handoff.installerPath)), /^install-[A-Za-z0-9]{6}$/);
  assert.equal(path.basename(handoff.installerPath), "GM-CRM-Setup-1.3.0.exe");
  assert.equal(handoff.sha256, f.release.sha256); assert.equal(handoff.size, f.bytes.length);
  assert.deepEqual(await readFile(handoff.installerPath), f.bytes);
  assert.deepEqual(await readdir(path.dirname(handoff.installerPath)), ["GM-CRM-Setup-1.3.0.exe"], "no partial installer remains after verification");
  assert.deepEqual(f.events.map(e => e.phase), ["checking", "downloading", "downloading", "verifying", "ready", "installing"]);
  assert.equal(f.requests[1].url, f.release.installerUrl);
  assert.equal(f.requests[1].request.redirect, "manual");
  assert.ok(f.requests[1].request.signal instanceof AbortSignal);
  assert.deepEqual(await f.controller.installUpdate(), result);
  assert.equal(f.handoffs.length, 1, "repeated clicks after handoff cannot launch the installer again");
});

test("double-clicks share one streamed download, with native progress available to a reopened renderer", async t => {
  let releaseStream;
  const f = await integratedFixture(t, { fetchBinary: async () => ({ ok: true, status: 200, headers: new Headers(), body: new ReadableStream({ start(controller) { releaseStream = controller; } }) }) });
  const first = f.controller.installUpdate(), second = f.controller.installUpdate();
  assert.equal(first, second);
  while (!releaseStream) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.controller.getUpdateState().phase, "downloading");
  releaseStream.enqueue(f.bytes.subarray(0, 8));
  await new Promise(resolve => setImmediate(resolve));
  releaseStream.enqueue(f.bytes.subarray(8)); releaseStream.close();
  assert.equal((await first).ok, true);
  assert.equal(f.requests.length, 2); assert.equal(f.handoffs.length, 1);
  assert.equal(f.controller.getUpdateState().phase, "installing");
});

test("truncated, oversized, tampered or header-mismatched downloads never hand off and remove their own staging directory", async t => {
  for (const failure of ["truncated", "oversized", "hash", "header", "http-error", "missing-body"]) {
    const f = await integratedFixture(t);
    f.state.fetchBinary = async () => {
      if (failure === "truncated") return f.binary(f.bytes.subarray(0, 5));
      if (failure === "oversized") return f.binary(Buffer.concat([f.bytes, Buffer.from("x")]));
      if (failure === "hash") return f.binary(Buffer.alloc(f.bytes.length));
      if (failure === "header") return f.binary(f.bytes, { headers: new Headers({ "content-length": "1" }) });
      if (failure === "http-error") return f.binary(f.bytes, { ok: false, status: 503 });
      return { ok: true, status: 200, headers: new Headers() };
    };
    const result = await f.controller.installUpdate();
    assert.equal(result.ok, false, failure);
    assert.equal(f.handoffs.length, 0, failure);
    assert.equal(f.controller.getUpdateState().phase, "error", failure);
    assert.deepEqual(await readdir(f.directory), [], failure);
  }
});

test("failed stream or native preparation can be retried safely with a new verified staging directory", async t => {
  const f = await integratedFixture(t, { fetchBinary: async () => { throw new Error("Synthetic disconnected transfer"); } });
  assert.equal((await f.controller.installUpdate()).ok, false);
  assert.deepEqual(await readdir(f.directory), []);
  f.state.fetchBinary = async () => f.binary(); f.state.handoffFails = true;
  assert.equal((await f.controller.installUpdate()).ok, false);
  assert.deepEqual(await readdir(f.directory), []);
  f.state.handoffFails = false;
  assert.equal((await f.controller.installUpdate()).ok, true);
  assert.equal(f.handoffs.length, 2, "only the valid retry and failed preparation reach the callback");
});

test("trusted GitHub redirects work while unknown or insecure destinations are rejected before any request", async t => {
  const destination = "https://release-assets.githubusercontent.com/github-production-release-asset/fixture/setup.exe?temporary=token";
  const good = await integratedFixture(t);
  good.state.fetchBinary = async url => url === good.release.installerUrl
    ? { ok: false, status: 302, headers: new Headers({ location: destination }) }
    : good.binary(good.bytes, { url: destination });
  assert.equal((await good.controller.installUpdate()).ok, true);
  assert.equal(good.requests.at(-1).url, destination);
  for (const target of ["https://evil.invalid/setup.exe", "http://release-assets.githubusercontent.com/setup.exe", "https://user:secret@github.com/setup.exe", "https://github.com:8443/setup.exe"]) {
    const f = await integratedFixture(t, { fetchBinary: async () => ({ ok: false, status: 302, headers: new Headers({ location: target }) }) });
    assert.equal((await f.controller.installUpdate()).ok, false);
    assert.equal(f.requests.length, 2, "only manifest and pinned installer URL are requested");
    assert.equal(f.handoffs.length, 0);
  }
  const loop = await integratedFixture(t, { fetchBinary: async () => ({ ok: false, status: 302, headers: new Headers({ location: destination }) }) });
  assert.equal((await loop.controller.installUpdate()).ok, false);
  assert.equal(loop.requests.length, 7, "redirect loops stop at five hops after the initial installer request");
});

test("unsupported, latest or unpublished versions do not download an executable", async t => {
  for (const options of [{ platform: "darwin" }, { packaged: false }, { noHandoff: true }]) {
    const f = await integratedFixture(t, options);
    assert.equal((await f.controller.installUpdate()).ok, false);
    assert.equal(f.requests.length, 0); assert.equal(f.handoffs.length, 0);
  }
  const current = await integratedFixture(t, { version: "1.3.0" });
  assert.deepEqual(await current.controller.installUpdate(), { ok: true, current: true, version: "1.3.0" });
  assert.equal(current.requests.length, 1); assert.equal(current.handoffs.length, 0);
  const absent = await integratedFixture(t, { manifest: { available: false } });
  assert.equal((await absent.controller.installUpdate()).ok, false);
  assert.equal(absent.requests.length, 1); assert.equal(absent.handoffs.length, 0);
});

test("filesystem failures preserve the running application and progress listeners cannot interrupt verification", async t => {
  const unavailable = await integratedFixture(t);
  const fileInsteadOfDirectory = path.join(unavailable.directory, "not-a-directory");
  await writeFile(fileInsteadOfDirectory, "keep me");
  const f = await integratedFixture(t, { directory: fileInsteadOfDirectory });
  assert.equal((await f.controller.installUpdate()).ok, false);
  assert.equal(f.handoffs.length, 0);
  assert.equal(await readFile(fileInsteadOfDirectory, "utf8"), "keep me");
  const listener = await integratedFixture(t, { badProgressListener: true });
  assert.equal((await listener.controller.installUpdate()).ok, true);
});

test("the native-owned update directory resolves lazily and relative roots never receive an installer", async t => {
  const f = await integratedFixture(t);
  let resolved = 0;
  const lazy = await integratedFixture(t, { directory: () => { resolved += 1; return f.directory; } });
  assert.equal(lazy.controller.getAppInfo().integratedUpdates, true);
  assert.equal(resolved, 0, "reading app capabilities must not read app paths before ready");
  assert.equal((await lazy.controller.installUpdate()).ok, true);
  assert.equal(resolved, 1);
  assert.equal(path.dirname(path.dirname(lazy.handoffs[0].installerPath)), f.directory);
  const invalid = await integratedFixture(t, { directory: () => "relative/path" });
  assert.equal((await invalid.controller.installUpdate()).ok, false);
  assert.equal(invalid.handoffs.length, 0);
});
