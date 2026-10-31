import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { EventEmitter } from "node:events";

const require = createRequire(import.meta.url);
const { createBackgroundController } = require("../desktop/background.cjs");
const exePath = "C:\\Program Files\\GM-CRM\\GM-CRM.exe";
const APP_URL = "https://thanhbuimgarchi-cpu.github.io/gm-manager/";
const plain = (value) => JSON.parse(JSON.stringify(value));

function fixture(options = {}) {
  const reads = [], writes = [], notifications = [], windows = [], trays = [];
  let settings = { openAtLogin: Boolean(options.enabled), executableWillLaunchAtLogin: options.approved !== false };
  let readFails = false, writeFails = false, writeIgnored = false;
  const app = new EventEmitter();
  Object.assign(app, { isPackaged: options.packaged !== false, quitCount: 0, getLoginItemSettings(payload) {
    reads.push(plain(payload));
    if (readFails) throw new Error("synthetic read failure");
    return settings;
  }, setLoginItemSettings(payload) {
    writes.push(plain(payload));
    if (writeFails) throw new Error("synthetic registry write failure");
    if (!writeIgnored) settings = { openAtLogin: payload.openAtLogin, executableWillLaunchAtLogin: payload.enabled };
  }, quit() {
    this.quitCount += 1;
    this.emit("before-quit");
    for (const window of windows) if (!window.destroyed) window.close();
    this.emit("will-quit");
  }, requestSingleInstanceLock: () => options.singleInstance !== false,
  whenReady: () => Promise.resolve(), isReady: () => true,
  setAppUserModelId() {}, setAsDefaultProtocolClient() {}, getPath: () => "C:\\Synthetic-GM-Tests",
  });
  class Window extends EventEmitter {
    constructor(configuration = {}) {
      super(); this.configuration = configuration; this.visible = configuration.show !== false; this.destroyed = false; this.minimized = false; this.focusCount = 0;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, { getURL: () => this.url || APP_URL, setWindowOpenHandler() {}, isDestroyed: () => false, send: (...args) => notifications.push(args) });
      windows.push(this);
    }
    loadURL(url) { this.url = url; }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return this.minimized; }
    isVisible() { return this.visible; }
    restore() { this.minimized = false; }
    show() { this.visible = true; this.emit("show"); }
    hide() { this.visible = false; this.emit("hide"); }
    focus() { this.focusCount += 1; this.emit("focus"); }
    close() {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      this.emit("close", event);
      if (!event.prevented) { this.destroyed = true; this.emit("closed"); }
      return event.prevented;
    }
    static getAllWindows() { return windows.filter((window) => !window.destroyed); }
  }
  class Tray extends EventEmitter {
    constructor(icon) { super(); if (options.trayFails) throw new Error("synthetic tray failure"); this.icon = icon; trays.push(this); }
    isDestroyed() { return Boolean(this.destroyed); }
    destroy() { this.destroyed = true; }
    setToolTip(value) { this.tooltip = value; }
    setContextMenu(value) { if (options.menuFails) throw new Error("synthetic menu failure"); this.menu = value; }
  }
  const nativeImage = { createFromPath: (iconPath) => ({ isEmpty: () => options.iconMissing === true, resize: (size) => ({ iconPath, size }) }) };
  const Menu = { buildFromTemplate: (items) => items };
  let currentWindow;
  const configuration = { app, Tray, Menu, nativeImage, platform: options.platform || "win32", execPath: exePath, argv: options.argv || [exePath], iconPath: "gm-logo-512.png", getWindow: () => currentWindow, createWindow: () => attachNewWindow() };
  const controller = createBackgroundController(configuration);
  app.on("before-quit", controller.beginQuit);
  app.on("will-quit", controller.dispose);
  function attachNewWindow() { currentWindow = new Window(); controller.attachWindow(currentWindow); return currentWindow; }
  return { app, Window, Tray, Menu, nativeImage, configuration, controller, windows, trays, reads, writes, notifications, attachNewWindow, setSettings: (value) => { settings = value; }, failRead: () => { readFails = true; }, failWrite: () => { writeFails = true; }, ignoreWrite: () => { writeIgnored = true; } };
}

test("startup is never enabled on load; writes use the same installed executable and background arguments as reads", () => {
  const f = fixture();
  assert.equal(f.controller.createTray(), true);
  assert.equal(f.controller.getStartupSettings().openAtLogin, false);
  assert.equal(f.writes.length, 0);
  assert.equal(f.controller.setStartupSettings({ openAtLogin: true }).ok, true);
  assert.deepEqual(f.writes[0], { path: exePath, args: ["--background"], name: "com.mgarchi.gmcrm", openAtLogin: true, enabled: true });
  assert.ok(f.reads.every((value) => value.path === exePath && value.args[0] === "--background"));
  const restarted = createBackgroundController(f.configuration);
  assert.equal(restarted.getStartupSettings().openAtLogin, true, "a restarted controller reads Windows, not browser memory");
  assert.equal(restarted.setStartupSettings({ openAtLogin: false }).openAtLogin, false);
  assert.equal(f.writes.at(-1).openAtLogin, false);
});

test("Task Manager disabled entries are shown off and can be explicitly enabled again", () => {
  const f = fixture({ enabled: true, approved: false });
  assert.equal(f.controller.getStartupSettings().openAtLogin, false);
  f.setSettings({ openAtLogin: true, executableWillLaunchAtLogin: true, launchItems: [
    { path: exePath, args: ["--background"], enabled: false, scope: "user" },
    { path: exePath, args: ["--other-mode"], enabled: true, scope: "user" },
  ] });
  assert.equal(f.controller.getStartupSettings().openAtLogin, false, "an unrelated enabled argument list must not mask the disabled startup entry");
  assert.equal(f.controller.setStartupSettings({ openAtLogin: true }).openAtLogin, true);
  assert.equal(f.writes[0].enabled, true);
});

test("invalid startup values cannot touch Windows settings", () => {
  const f = fixture();
  for (const value of [undefined, null, true, [], {}, { openAtLogin: "true" }, { openAtLogin: 1 }]) assert.equal(f.controller.setStartupSettings(value).ok, false);
  assert.equal(f.writes.length, 0);
});

test("read/write errors and rejected OS changes never report an optimistic success", () => {
  const unreadable = fixture(); unreadable.failRead();
  assert.equal(unreadable.controller.setStartupSettings({ openAtLogin: true }).canChange, false);
  assert.equal(unreadable.writes.length, 0);
  const denied = fixture(); denied.failWrite();
  const result = denied.controller.setStartupSettings({ openAtLogin: true });
  assert.equal(result.ok, false); assert.equal(result.openAtLogin, false); assert.ok(result.error);
  const ignored = fixture(); ignored.ignoreWrite();
  assert.equal(ignored.controller.setStartupSettings({ openAtLogin: true }).ok, false);
  assert.equal(ignored.controller.getStartupSettings().openAtLogin, false);
});

test("non-Windows and development builds never register themselves at Windows startup", () => {
  for (const options of [{ platform: "darwin" }, { platform: "linux" }, { packaged: false }]) {
    const f = fixture(options);
    assert.equal(f.controller.setStartupSettings({ openAtLogin: true }).ok, false);
    assert.equal(f.controller.getStartupSettings().canChange, false);
    assert.equal(f.writes.length, 0); assert.equal(f.reads.length, 0);
    if (options.platform) assert.equal(f.controller.createTray(), false);
  }
});

test("close keeps the renderer alive in the tray; icon and menu reopen, restore, hide and quit", () => {
  const f = fixture(); f.controller.createTray();
  const window = f.attachNewWindow(), tray = f.trays[0];
  assert.equal(window.close(), true); assert.equal(window.destroyed, false); assert.equal(window.visible, false);
  window.minimized = true; tray.emit("click");
  assert.equal(window.visible, true); assert.equal(window.minimized, false); assert.ok(window.focusCount > 0);
  tray.menu.find((item) => item.label === "Ẩn xuống khay hệ thống").click();
  assert.equal(window.visible, false);
  tray.menu.find((item) => item.label === "Mở GM Manager").click();
  assert.equal(window.visible, true);
  tray.menu.find((item) => item.label === "Thoát GM Manager").click();
  assert.equal(f.app.quitCount, 1); assert.equal(window.destroyed, true); assert.equal(tray.destroyed, true);
});

test("normal app quit and Windows logout/shutdown bypass close-to-tray", () => {
  for (const eventName of ["query-session-end", "session-end"]) {
    const f = fixture(); f.controller.createTray(); const window = f.attachNewWindow();
    window.emit(eventName, { preventDefault: () => assert.fail("Windows session-end must not be prevented") });
    assert.equal(window.close(), false); assert.equal(window.destroyed, true);
  }
  const f = fixture(); f.controller.createTray(); const window = f.attachNewWindow();
  f.app.quit(); assert.equal(window.destroyed, true);
});

test("missing icons, failed tray creation and missing menus leave ordinary window closing usable", () => {
  for (const options of [{ iconMissing: true }, { trayFails: true }, { menuFails: true }]) {
    const f = fixture(options);
    assert.equal(f.controller.createTray(), false); assert.equal(f.controller.hasTray(), false);
    const window = f.attachNewWindow();
    assert.equal(window.close(), false); assert.equal(window.destroyed, true);
    assert.ok(f.trays.every((tray) => tray.destroyed), "a partly created tray is disposed");
  }
});

test("only an enabled Windows startup launch with a working tray can start hidden", () => {
  const f = fixture({ enabled: true, argv: [exePath, "--background"] });
  assert.equal(f.controller.shouldStartHidden(), false, "no invisible process without a usable tray");
  f.controller.createTray();
  assert.equal(f.controller.shouldStartHidden(), true);
  assert.equal(f.controller.shouldStartHidden([exePath]), false);
  assert.equal(f.controller.shouldStartHidden([exePath, "--background", "gmmanager://open-documents?houseId=QA"]), false);
  f.setSettings({ openAtLogin: false });
  assert.equal(f.controller.shouldStartHidden(), false);
});

test("tray startup changes and focus reconciliation publish the actual state to the renderer", () => {
  const f = fixture(); f.controller.createTray(); const window = f.attachNewWindow();
  f.trays[0].menu.find((item) => item.type === "checkbox").click({ checked: true });
  assert.equal(f.notifications.at(-1)[0], "gmcrm:startup-changed");
  assert.equal(f.notifications.at(-1)[1].openAtLogin, true);
  f.setSettings({ openAtLogin: true, executableWillLaunchAtLogin: false }); window.emit("focus");
  assert.equal(f.notifications.at(-1)[1].openAtLogin, false);
  assert.equal(f.trays[0].menu.find((item) => item.type === "checkbox").checked, false);
  f.controller.dispose(); f.controller.dispose(); assert.equal(f.controller.hasTray(), false);
});

async function mainFixture(options = {}) {
  const f = fixture(options), handlers = new Map();
  const electron = { app: f.app, BrowserWindow: f.Window, Tray: f.Tray, Menu: f.Menu, nativeImage: f.nativeImage,
    Notification: { isSupported: () => false }, ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    shell: { openExternal() {}, openPath: async () => "" }, session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showMessageBox: async () => {} },
  };
  const source = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");
  vm.runInNewContext(source, { require: (name) => name === "electron" ? electron : name === "./path-utils.cjs" ? require("../desktop/path-utils.cjs") : require(name),
    __dirname: path.resolve("desktop"), process: { platform: options.platform || "win32", execPath: exePath, argv: options.argv || [exePath], resourcesPath: "C:\\Synthetic-GM-Resources", defaultApp: false }, URL, setTimeout, clearTimeout,
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { ...f, handlers };
}

test("native startup IPC rejects foreign frames and requires a strict boolean", async () => {
  const f = await mainFixture(), trusted = { senderFrame: { url: APP_URL } }, foreign = { senderFrame: { url: "https://example.org" }, sender: { getURL: () => APP_URL } };
  assert.equal(f.handlers.get("gmcrm:get-startup-settings")(foreign).ok, false);
  assert.equal(f.handlers.get("gmcrm:set-startup-settings")(foreign, { openAtLogin: true }).ok, false);
  assert.equal(f.handlers.get("gmcrm:set-startup-settings")({ senderFrame: { url: "https://thanhbuimgarchi-cpu.github.io/another-repository/" } }, { openAtLogin: true }).ok, false);
  assert.equal(f.handlers.get("gmcrm:set-startup-settings")({ senderFrame: { url: APP_URL, parent: { url: APP_URL } } }, { openAtLogin: true }).ok, false);
  assert.equal(f.handlers.get("gmcrm:set-startup-settings")({ sender: { getURL: () => APP_URL } }, { openAtLogin: true }).ok, false);
  assert.equal(f.handlers.get("gmcrm:set-startup-settings")(trusted, { openAtLogin: "true" }).ok, false);
  assert.equal(f.writes.length, 0);
  assert.equal(f.handlers.get("gmcrm:set-startup-settings")(trusted, { openAtLogin: true }).ok, true);
  assert.equal(f.handlers.get("gmcrm:get-startup-settings")(trusted).openAtLogin, true);
  assert.equal(f.windows[0].configuration.webPreferences.backgroundThrottling, false);
  assert.equal(f.windows[0].configuration.webPreferences.contextIsolation, true);
  assert.equal(f.windows[0].configuration.webPreferences.nodeIntegration, false);
});

test("native background launch stays hidden, normal second-instance foregrounds it, and duplicates create nothing", async () => {
  const f = await mainFixture({ enabled: true, argv: [exePath, "--background"] });
  assert.equal(f.windows.length, 1); assert.equal(f.windows[0].visible, false); assert.equal(f.trays.length, 1);
  f.app.emit("second-instance", {}, [exePath, "--background"]); assert.equal(f.windows[0].visible, false);
  f.app.emit("second-instance", {}, [exePath]); assert.equal(f.windows[0].visible, true); assert.equal(f.windows.length, 1);
  f.windows[0].close(); assert.equal(f.windows[0].destroyed, false);
  f.app.quit(); assert.equal(f.windows[0].destroyed, true);
  const duplicate = await mainFixture({ singleInstance: false });
  assert.equal(duplicate.windows.length, 0); assert.equal(duplicate.trays.length, 0); assert.equal(duplicate.handlers.size, 0);
});

test("the preload exposes a narrow startup API and unsubscribes tray change listeners", async () => {
  const ipc = new EventEmitter(), calls = []; let bridge;
  ipc.invoke = (...args) => { calls.push(args); return Promise.resolve({ supported: true, canChange: true, openAtLogin: true }); };
  vm.runInNewContext(await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"), { require: () => ({ contextBridge: { exposeInMainWorld: (_name, value) => { bridge = value; } }, ipcRenderer: ipc }), process: { platform: "win32" } });
  await bridge.getStartupSettings(); await bridge.setStartupSettings({ openAtLogin: false });
  assert.deepEqual(calls.map((value) => value[0]), ["gmcrm:get-startup-settings", "gmcrm:set-startup-settings"]);
  const changes = [], unsubscribe = bridge.onStartupChanged((value) => changes.push(plain(value)));
  ipc.emit("gmcrm:startup-changed", { sender: "not-exposed" }, { supported: true, canChange: true, openAtLogin: true, injected: "not-exposed" });
  assert.deepEqual(changes, [{ supported: true, canChange: true, openAtLogin: true }]);
  unsubscribe(); assert.equal(ipc.listenerCount("gmcrm:startup-changed"), 0);
  const configuration = JSON.parse(await readFile(new URL("../desktop/package.json", import.meta.url), "utf8"));
  assert.ok(configuration.build.files.includes("background.cjs"), "the installed app includes the native controller");
});
