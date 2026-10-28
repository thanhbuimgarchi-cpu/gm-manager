import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const workerSource = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
const desktopSource = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");
const frontendSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const appUrl = "https://thanhbuimgarchi-cpu.github.io/gm-manager/";
const targetUrl = `${appUrl}?gmcrmProject=DV-75&gmcrmNote=note-1&gmcrmYear=2026&gmcrmMonth=10`;

function workerFixture(windows = []) {
  const listeners = new Map();
  const notifications = [];
  const opened = [];
  const clients = {
    matchAll: async () => windows,
    openWindow: async (url) => { opened.push(url); return { url }; },
  };
  const self = {
    location: { origin: new URL(appUrl).origin },
    registration: { scope: appUrl, showNotification: async (title, options) => { notifications.push({ title, options }); } },
    clients,
    addEventListener: (name, listener) => listeners.set(name, listener),
  };
  vm.runInNewContext(workerSource, { self, clients, URL, console });
  const send = async (name, value) => {
    let pending;
    listeners.get(name)({ ...value, waitUntil: (promise) => { pending = promise; } });
    assert.ok(pending, `${name} must extend the worker lifetime until delivery/navigation finishes`);
    await pending;
  };
  return { send, notifications, opened };
}

test("service-worker notifications preserve the content and exact work-note link", async () => {
  const fixture = workerFixture();
  const body = "Cần lập tức · DV-75\nHoàn thiện phương án mặt bằng.\nDự kiến: 30/10/2026";
  await fixture.send("message", { data: { type: "GM_CRM_NOTIFY", title: "Có việc mới được giao", body, tag: "note-1", url: targetUrl } });
  assert.equal(fixture.notifications[0].options.body, body);
  assert.equal(fixture.notifications[0].options.data.url, targetUrl);
  assert.equal(fixture.notifications[0].options.renotify, true);
});

test("push events support JSON, plain text and empty payloads", async () => {
  const fixture = workerFixture();
  await fixture.send("push", { data: { json: () => ({ title: "Tin mới", body: "Nội dung", url: targetUrl }) } });
  await fixture.send("push", { data: { json: () => { throw new Error("plain text"); }, text: () => "Tin nhắn dạng chữ" } });
  await fixture.send("push", { data: { json: () => null } });
  assert.equal(fixture.notifications[0].title, "Tin mới");
  assert.equal(fixture.notifications[1].options.body, "Tin nhắn dạng chữ");
  assert.equal(fixture.notifications[2].options.body, "GM-CRM có cập nhật mới.");
});

test("clicking a notification navigates and focuses an existing app instead of opening duplicates", async () => {
  const actions = [];
  const client = { url: appUrl, navigate: async (url) => { actions.push(["navigate", url]); return client; }, focus: async () => actions.push(["focus"]) };
  const fixture = workerFixture([{ url: "https://example.com/" }, client]);
  await fixture.send("notificationclick", { notification: { data: { url: targetUrl }, close: () => actions.push(["close"]) } });
  assert.deepEqual(actions, [["close"], ["navigate", targetUrl], ["focus"]]);
  assert.deepEqual(fixture.opened, []);
});

test("an already open exact notification target is focused without reloading its form", async () => {
  let focused = 0;
  const fixture = workerFixture([{ url: targetUrl, navigate: () => { throw new Error("must preserve current form"); }, focus: async () => { focused += 1; } }]);
  await fixture.send("notificationclick", { notification: { data: { url: targetUrl }, close() {} } });
  assert.equal(focused, 1);
  assert.deepEqual(fixture.opened, []);
});

test("notification clicks open the exact app URL when no app window exists", async () => {
  const fixture = workerFixture();
  await fixture.send("notificationclick", { notification: { data: { url: targetUrl }, close() {} } });
  assert.deepEqual(fixture.opened, [targetUrl]);
});

test("invalid or external notification targets return to the app scope", async () => {
  for (const url of ["https://example.com/", "javascript:alert(1)", "https://thanhbuimgarchi-cpu.github.io/other-project/", "https://user:pass@thanhbuimgarchi-cpu.github.io/gm-manager/"]) {
    const fixture = workerFixture();
    await fixture.send("notificationclick", { notification: { data: { url }, close() {} } });
    assert.deepEqual(fixture.opened, [appUrl]);
  }
});

test("a window closed during notification navigation falls back to a fresh app window", async () => {
  const fixture = workerFixture([{ url: appUrl, navigate: async () => { throw new Error("tab closed"); }, focus() {} }]);
  await fixture.send("notificationclick", { notification: { data: { url: targetUrl }, close() {} } });
  assert.deepEqual(fixture.opened, [targetUrl]);
});

async function desktopFixture({ notificationEvent = "show", supported = true } = {}) {
  const handlers = new Map();
  const notifications = [];
  const windows = [];
  const actions = [];
  class FakeWindow {
    constructor() {
      this.url = "";
      this.webContents = { setWindowOpenHandler() {}, on() {}, getURL: () => this.url };
      windows.push(this);
    }
    loadURL(url) { this.url = url; actions.push(["load", url]); }
    on() {}
    isDestroyed() { return false; }
    isMinimized() { return true; }
    restore() { actions.push(["restore"]); }
    show() { actions.push(["show-window"]); }
    focus() { actions.push(["focus-window"]); }
    static getAllWindows() { return windows; }
  }
  class FakeNotification {
    constructor(options) { this.options = options; this.listeners = new Map(); notifications.push(this); }
    on(event, callback) { this.listeners.set(event, callback); }
    once(event, callback) { this.listeners.set(event, callback); }
    show() { actions.push(["show-notification"]); this.listeners.get(notificationEvent)?.(); }
    static isSupported() { return supported; }
  }
  const app = { isPackaged: false, requestSingleInstanceLock: () => true, quit() {}, on() {}, whenReady: () => Promise.resolve(), setAppUserModelId() {}, setAsDefaultProtocolClient() {} };
  const electron = { app, BrowserWindow: FakeWindow, Notification: FakeNotification, ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, shell: {}, dialog: {}, session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } } };
  const context = vm.createContext({
    require: (name) => name === "electron" ? electron : name === "./path-utils.cjs" ? require("../desktop/path-utils.cjs") : require(name),
    __dirname: fileURLToPath(new URL("../desktop/", import.meta.url)),
    process: { platform: "win32", argv: [], defaultApp: false },
    URL, console, setTimeout, clearTimeout,
  });
  vm.runInContext(desktopSource, context);
  await Promise.resolve();
  actions.length = 0;
  return { handlers, notifications, actions };
}

test("the native PC notification receives its content and opens the assigned note on click", async () => {
  const fixture = await desktopFixture();
  const body = "Gấp · DV-75 · Kiểm tra hồ sơ kiến trúc";
  const result = fixture.handlers.get("gmcrm:notify")({ senderFrame: { url: appUrl } }, { title: "GM Manager · Có việc mới", body, url: targetUrl });
  assert.equal(await result, true);
  assert.equal(fixture.notifications[0].options.body, body);
  assert.equal(fixture.notifications[0].options.title, "GM Manager · Có việc mới");
  fixture.notifications[0].listeners.get("click")();
  assert.ok(fixture.actions.some(([action, url]) => action === "load" && url === targetUrl));
  assert.ok(fixture.actions.some(([action]) => action === "focus-window"));
});

test("the native notification bridge rejects requests from other sites", async () => {
  const fixture = await desktopFixture();
  assert.equal(await fixture.handlers.get("gmcrm:notify")({ senderFrame: { url: "https://example.com/" } }, { body: "blocked" }), false);
  assert.equal(fixture.notifications.length, 0);
});

test("native notification failures are reported as false rather than enabling the UI", async () => {
  for (const options of [{ notificationEvent: "failed" }, { supported: false }]) {
    const fixture = await desktopFixture(options);
    assert.equal(await fixture.handlers.get("gmcrm:notify")({ senderFrame: { url: appUrl } }, { body: "Not shown" }), false);
  }
});

const ts = require("typescript");
const parsedFrontend = ts.createSourceFile("page.tsx", frontendSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const frontendDeclarations = new Map();
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && ["markNotificationsEnabled", "sendTestNotification"].includes(node.name.getText(parsedFrontend))) frontendDeclarations.set(node.name.getText(parsedFrontend), node.getText(parsedFrontend));
  ts.forEachChild(node, visit);
};
visit(parsedFrontend);
const frontendNotificationCode = ts.transpileModule(
  [...frontendDeclarations.values()].map((declaration) => `const ${declaration};`).join("\n").replaceAll("import.meta.env.BASE_URL", JSON.stringify("/gm-manager/")) + "\nglobalThis.enable = sendTestNotification;",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText;

function frontendFixture({ permission = "granted", requestPermission, desktop = null, showNotification, ready, fakeTimeout = false } = {}) {
  const storage = new Map();
  const state = {};
  const shown = [];
  const registration = { showNotification: showNotification || (async (title, options) => { shown.push({ title, options }); }) };
  const Notification = { permission, requestPermission: requestPermission || (async () => "granted") };
  let scheduledTimeout;
  const context = vm.createContext({
    window: { Notification, location: { origin: new URL(appUrl).origin }, localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) }, setTimeout: fakeTimeout ? (callback) => { scheduledTimeout = callback; return 1; } : setTimeout, clearTimeout: fakeTimeout ? () => {} : clearTimeout },
    navigator: { serviceWorker: { ready: ready || Promise.resolve(registration) } },
    Notification, Error,
    desktopBridge: () => desktop,
    enablingNotifications: false,
    setEnablingNotifications: (value) => { context.enablingNotifications = value; state.busy = value; },
    setNotificationsEnabled: (value) => { state.enabled = value; },
    setNotificationPermission: (value) => { state.permission = value; },
    setNotice: (value) => { state.notice = value; },
    notificationEnabledStorageKey: "gm-manager-notifications-enabled-v1",
    mobileNotificationSetupKey: "gm-manager-mobile-notification-setup-v1",
    serviceWorkerRegistration: { current: ready ? null : registration },
    isMobileDevice: () => false,
  });
  vm.runInContext(frontendNotificationCode, context);
  return { enable: context.enable, storage, state, shown, runTimeout: () => scheduledTimeout?.() };
}

test("Bật thông báo stores the enabled state only after browser delivery succeeds", async () => {
  const fixture = frontendFixture({ permission: "default" });
  await fixture.enable();
  assert.equal(fixture.state.enabled, true);
  assert.equal(fixture.state.busy, false);
  assert.equal(fixture.storage.get("gm-manager-notifications-enabled-v1"), "enabled");
  assert.equal(fixture.shown[0].options.data.url, appUrl);
});

test("denied browser permission does not claim notifications are enabled", async () => {
  const fixture = frontendFixture({ permission: "denied" });
  await fixture.enable();
  assert.equal(fixture.state.enabled, false);
  assert.equal(fixture.storage.get("gm-manager-notifications-enabled-v1"), "disabled");
  assert.equal(fixture.shown.length, 0);
});

test("permission, registration and native errors are caught without leaving Bật thông báo busy", async () => {
  const fixtures = [
    frontendFixture({ permission: "default", requestPermission: async () => { throw new Error("permission failed"); } }),
    frontendFixture({ showNotification: async () => { throw new Error("registration failed"); } }),
    frontendFixture({ desktop: { isDesktop: true, showNotification: async () => { throw new Error("native failed"); } } }),
    frontendFixture({ desktop: { isDesktop: true, showNotification: async () => false } }),
  ];
  for (const fixture of fixtures) {
    await fixture.enable();
    assert.equal(fixture.state.enabled, false);
    assert.equal(fixture.state.busy, false);
    assert.equal(fixture.storage.get("gm-manager-notifications-enabled-v1"), "disabled");
  }
});

test("an unavailable service worker times out instead of hanging the notification button", async () => {
  const fixture = frontendFixture({ ready: new Promise(() => {}), fakeTimeout: true });
  const pending = fixture.enable();
  fixture.runTimeout();
  await pending;
  assert.equal(fixture.state.busy, false);
  assert.equal(fixture.state.enabled, false);
});

test("native acceptance persists the notification setting across later app launches", async () => {
  const received = [];
  const fixture = frontendFixture({ desktop: { isDesktop: true, showNotification: async (payload) => { received.push(payload); return true; } } });
  await fixture.enable();
  assert.equal(received[0].url, appUrl);
  assert.equal(fixture.storage.get("gm-manager-notifications-enabled-v1"), "enabled");
  assert.equal(fixture.state.permission, "granted");
});
