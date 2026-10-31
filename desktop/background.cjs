"use strict";

const STARTUP_ARGUMENTS = ["--background"];
const STARTUP_NAME = "com.mgarchi.gmcrm";

// Native state stays in Windows, not in browser cache. This controller is
// dependency-injected so lifecycle tests never modify the host's Run keys.
function createBackgroundController({ app, Tray, Menu, nativeImage, platform, execPath, argv, iconPath, getWindow, createWindow }) {
  let tray = null;
  let quitting = false;
  const isWindows = platform === "win32";
  const canChange = isWindows && Boolean(app.isPackaged) && typeof execPath === "string" && !!execPath;
  const startupOptions = () => ({ path: execPath, args: [...STARTUP_ARGUMENTS] });
  const baseState = () => ({ supported: isWindows, canChange, openAtLogin: false });

  function getStartupSettings() {
    if (!isWindows) return baseState();
    if (!canChange) return { ...baseState(), error: "Hãy dùng bản GM Manager đã cài đặt để bật khởi động cùng Windows." };
    try {
      const current = app.getLoginItemSettings(startupOptions());
      const launchItems = Array.isArray(current.launchItems) ? current.launchItems.filter((item) => {
        const itemPath = String(item.path || "").trim().replace(/^"|"$/g, "").toLowerCase();
        return itemPath === execPath.toLowerCase() && Array.isArray(item.args) && item.args.length === STARTUP_ARGUMENTS.length && item.args.every((value, index) => value === STARTUP_ARGUMENTS[index]);
      }) : [];
      const startupApproved = !launchItems.length || launchItems.some((item) => item.enabled !== false);
      return { ...baseState(), openAtLogin: Boolean(current.openAtLogin && current.executableWillLaunchAtLogin !== false && startupApproved) };
    } catch {
      return { ...baseState(), canChange: false, error: "Không thể đọc thiết lập khởi động của Windows. Hãy thử lại." };
    }
  }

  function publishStartupSettings(state) {
    const window = getWindow();
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed?.()) {
      try { window.webContents.send("gmcrm:startup-changed", state); } catch { /* A renderer may be closing. */ }
    }
  }

  function setStartupSettings(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.openAtLogin !== "boolean") {
      return { ...getStartupSettings(), ok: false, error: "Thiết lập khởi động không hợp lệ." };
    }
    const before = getStartupSettings();
    if (!before.canChange) return { ...before, ok: false };
    try {
      app.setLoginItemSettings({ ...startupOptions(), name: STARTUP_NAME, openAtLogin: payload.openAtLogin, enabled: payload.openAtLogin });
      const actual = getStartupSettings();
      const result = actual.error || actual.openAtLogin !== payload.openAtLogin
        ? { ...actual, ok: false, error: actual.error || "Windows chưa áp dụng thay đổi khởi động. Hãy kiểm tra lại trong Ứng dụng khởi động của Windows." }
        : { ...actual, ok: true };
      refreshTrayMenu(result);
      publishStartupSettings(result);
      return result;
    } catch {
      const result = { ...getStartupSettings(), ok: false, error: "Không thể thay đổi thiết lập khởi động cùng Windows. Hãy thử lại." };
      refreshTrayMenu(result);
      publishStartupSettings(result);
      return result;
    }
  }

  function hasTray() { return Boolean(tray && !tray.isDestroyed()); }

  function showWindow() {
    const window = getWindow();
    const target = window && !window.isDestroyed() ? window : createWindow();
    if (target.isMinimized()) target.restore();
    target.show();
    target.focus();
    refreshTrayMenu();
    return target;
  }

  function hideWindow() {
    const window = getWindow();
    if (hasTray() && window && !window.isDestroyed()) window.hide();
    refreshTrayMenu();
  }

  function beginQuit() { quitting = true; }

  function quit() {
    beginQuit();
    app.quit();
  }

  function refreshTrayMenu(state = getStartupSettings()) {
    if (!hasTray()) return false;
    const window = getWindow();
    try {
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: "Mở GM Manager", click: showWindow },
        { label: "Ẩn xuống khay hệ thống", enabled: Boolean(window && !window.isDestroyed() && window.isVisible?.()), click: hideWindow },
        { type: "separator" },
        { label: "Khởi động cùng Windows", type: "checkbox", checked: state.openAtLogin, enabled: state.canChange, click: (item) => { setStartupSettings({ openAtLogin: item.checked }); } },
        { type: "separator" },
        { label: "Thoát GM Manager", click: quit },
      ]));
      return true;
    } catch { return false; /* Keep the previous usable menu if rebuilding fails. */ }
  }

  function createTray() {
    if (!isWindows || hasTray()) return hasTray();
    let candidate;
    try {
      const icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) return false;
      candidate = new Tray(icon.resize({ width: 32, height: 32 }));
      candidate.setToolTip("GM Manager • Đang chạy nền");
      candidate.on("click", showWindow);
      candidate.on("double-click", showWindow);
      candidate.on("right-click", () => refreshTrayMenu());
      tray = candidate;
      if (!refreshTrayMenu()) throw new Error("Tray menu is unavailable");
      return true;
    } catch {
      try { candidate?.destroy(); } catch { /* Already disposed. */ }
      tray = null;
      return false;
    }
  }

  function attachWindow(window) {
    window.on("close", (event) => {
      if (!quitting && hasTray()) {
        event.preventDefault();
        window.hide();
      }
    });
    // Windows shutdown/logout does not always emit app.before-quit. Never
    // intercept the close following the OS session-end sequence.
    window.on("query-session-end", beginQuit);
    window.on("session-end", beginQuit);
    window.on("show", () => refreshTrayMenu());
    window.on("hide", () => refreshTrayMenu());
    window.on("focus", () => {
      const state = getStartupSettings();
      refreshTrayMenu(state);
      publishStartupSettings(state);
    });
  }

  function shouldStartHidden(argumentsToCheck = argv) {
    return isWindows && canChange && hasTray() && Array.isArray(argumentsToCheck)
      && argumentsToCheck.includes(STARTUP_ARGUMENTS[0])
      && !argumentsToCheck.some((value) => /^gmmanager:\/\//i.test(value))
      && getStartupSettings().openAtLogin;
  }

  function dispose() {
    const current = tray;
    tray = null;
    try { if (current && !current.isDestroyed()) current.destroy(); } catch { /* Already disposed by Windows. */ }
  }

  return { getStartupSettings, setStartupSettings, createTray, attachWindow, hasTray, shouldStartHidden, showWindow, beginQuit, quit, dispose };
}

module.exports = { createBackgroundController, STARTUP_ARGUMENTS, STARTUP_NAME };
