"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");

const MANIFEST_URL = "https://thanhbuimgarchi-cpu.github.io/gm-manager/desktop-version.json";
const DOWNLOAD_PREFIX = "https://github.com/thanhbuimgarchi-cpu/gm-manager/releases/download/desktop-latest/";
const MAX_MANIFEST_BYTES = 64 * 1024;

function parseDesktopVersion(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/.test(value)) return null;
  return value.split(".").map(Number);
}

function compareDesktopVersions(left, right) {
  const a = parseDesktopVersion(left), b = parseDesktopVersion(right);
  if (!a || !b) throw new Error("Phiên bản ứng dụng PC không hợp lệ.");
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}

function validateDesktopManifest(value) {
  if (value && typeof value === "object" && !Array.isArray(value) && value.available === false) return { available: false };
  if (!value || typeof value !== "object" || Array.isArray(value) || !parseDesktopVersion(value.version)) throw new Error("Thông tin cập nhật bản PC không hợp lệ.");
  const installerUrl = `${DOWNLOAD_PREFIX}GM-CRM-Setup-${value.version}.exe`;
  if (value.installerUrl !== installerUrl || typeof value.sha256 !== "string" || !/^[a-fA-F0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 1024 * 1024 * 1024) throw new Error("Bộ cài cập nhật chưa được xác nhận.");
  return { version: value.version, installerUrl, sha256: value.sha256.toLowerCase(), size: value.size };
}

// The manifest and executable destination are native-owned. Renderer calls
// cannot supply a URL, path, executable arguments, checksum or version.
function createDesktopUpdateController({ getVersion, platform, isPackaged, fetcher, openExternal, updateDirectory, onProgress, installVerifiedUpdate }) {
  let pending = null;
  let pendingInstall = null;
  let installedResult = null;
  let updateState = { phase: "idle", percent: 0 };
  const integratedUpdates = platform === "win32" && Boolean(isPackaged)
    && (typeof updateDirectory === "function" || (typeof updateDirectory === "string" && path.isAbsolute(updateDirectory))) && typeof installVerifiedUpdate === "function";
  function getAppInfo() { return { version: getVersion(), platform, isPackaged: Boolean(isPackaged), ...(integratedUpdates ? { integratedUpdates: true } : {}) }; }
  function baseState() { return { supported: platform === "win32" && Boolean(isPackaged), currentVersion: getVersion(), latestVersion: "", updateAvailable: false }; }
  function getUpdateState() { return { ...updateState }; }
  function progress(value) {
    updateState = { ...value };
    try { onProgress?.(getUpdateState()); } catch { /* A closing renderer must not interrupt a verified download. */ }
  }

  async function readManifest() {
    const response = await fetcher(`${MANIFEST_URL}?time=${Date.now()}`, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000), headers: { accept: "application/json" } });
    if (!response.ok || Number(response.headers?.get?.("content-length") || 0) > MAX_MANIFEST_BYTES) throw new Error("Không thể đọc thông tin cập nhật PC.");
    let body;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > MAX_MANIFEST_BYTES) { await reader.cancel(); throw new Error("Thông tin cập nhật PC quá lớn."); }
          chunks.push(Buffer.from(part.value));
        }
      } finally { reader.releaseLock(); }
      body = Buffer.concat(chunks).toString("utf8");
    } else body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_MANIFEST_BYTES) throw new Error("Thông tin cập nhật PC quá lớn.");
    return validateDesktopManifest(JSON.parse(body));
  }

  async function readInstallerResponse(installerUrl, signal) {
    let requestedUrl = installerUrl;
    const trusted = (value) => {
      try {
        const destination = new URL(value);
        return destination.protocol === "https:" && !destination.username && !destination.password
          && (!destination.port || destination.port === "443")
          && ["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(destination.hostname);
      } catch { return false; }
    };
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      if (!trusted(requestedUrl)) throw new Error("Địa chỉ bộ cài cập nhật không hợp lệ.");
      const response = await fetcher(requestedUrl, { cache: "no-store", redirect: "manual", signal, headers: { accept: "application/octet-stream" } });
      if (response.url && !trusted(response.url)) throw new Error("Địa chỉ bộ cài cập nhật không hợp lệ.");
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      try { await response.body?.cancel?.(); } catch { /* A redirect body may already be closed. */ }
      const location = response.headers?.get?.("location");
      if (!location || redirects === 5) throw new Error("Không tải được bộ cài PC. Hãy kiểm tra kết nối rồi thử lại.");
      requestedUrl = new URL(location, requestedUrl).href;
    }
    throw new Error("Không tải được bộ cài PC. Hãy kiểm tra kết nối rồi thử lại.");
  }

  function checkForUpdates() {
    const state = baseState();
    if (!state.supported) return Promise.resolve(state);
    if (pending) return pending;
    pending = (async () => {
      try {
        const manifest = await readManifest();
        if (manifest.available === false) return { ...state, available: false };
        return { ...state, latestVersion: manifest.version, updateAvailable: compareDesktopVersions(manifest.version, state.currentVersion) > 0, downloadUrl: manifest.installerUrl };
      } catch {
        return { ...state, error: "Chưa kiểm tra được bản cập nhật PC. Hãy thử lại khi có mạng." };
      } finally { pending = null; }
    })();
    return pending;
  }

  async function downloadUpdate() {
    const state = await checkForUpdates();
    if (state.available === false) return { ok: false, error: "Bộ cài cập nhật PC chưa được phát hành." };
    if (state.error || !state.supported || !state.updateAvailable || !state.downloadUrl) return { ok: false, error: state.error || "Ứng dụng PC đang dùng bản mới nhất." };
    try {
      await openExternal(state.downloadUrl);
      return { ok: true };
    } catch { return { ok: false, error: "Không mở được bộ cài cập nhật. Hãy thử lại." }; }
  }

  function installUpdate() {
    if (!integratedUpdates) return Promise.resolve({ ok: false, error: "Bản PC này chưa hỗ trợ cập nhật trong ứng dụng." });
    if (pendingInstall) return pendingInstall;
    if (installedResult) return Promise.resolve(installedResult);
    pendingInstall = (async () => {
      let stagingDirectory;
      let stagingRoot;
      let handle;
      let reader;
      let downloadController;
      try {
        progress({ phase: "checking", percent: 0 });
        const manifest = await readManifest();
        if (manifest.available === false) throw new Error("Bộ cài cập nhật PC chưa được phát hành.");
        if (compareDesktopVersions(manifest.version, getVersion()) <= 0) {
          progress({ phase: "idle", percent: 0 });
          return { ok: true, current: true, version: getVersion() };
        }
        const configuredDirectory = typeof updateDirectory === "function" ? updateDirectory() : updateDirectory;
        if (typeof configuredDirectory !== "string" || !path.isAbsolute(configuredDirectory)) throw new Error("Không xác định được thư mục cập nhật PC.");
        stagingRoot = path.resolve(configuredDirectory);
        await fs.mkdir(stagingRoot, { recursive: true });
        stagingDirectory = await fs.mkdtemp(path.join(stagingRoot, "install-"));
        const partialPath = path.join(stagingDirectory, "installer.part");
        const installerPath = path.join(stagingDirectory, `GM-CRM-Setup-${manifest.version}.exe`);
        handle = await fs.open(partialPath, "wx", 0o600);
        downloadController = new AbortController();
        const downloadTimeout = setTimeout(() => downloadController.abort(), 30 * 60 * 1000);
        downloadTimeout.unref?.();
        let received = 0;
        const hash = createHash("sha256");
        try {
          progress({ phase: "downloading", version: manifest.version, received, total: manifest.size, percent: 0 });
          const response = await readInstallerResponse(manifest.installerUrl, downloadController.signal);
          if (!response.ok || (response.status !== undefined && response.status !== 200)) throw new Error("Không tải được bộ cài PC. Hãy kiểm tra kết nối rồi thử lại.");
          const contentLength = response.headers?.get?.("content-length");
          if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) !== manifest.size)) throw new Error("Kích thước bộ cài không khớp. Hãy thử cập nhật lại.");
          if (!response.body?.getReader) throw new Error("Không đọc được dữ liệu bộ cài PC.");
          reader = response.body.getReader();
          let lastPercent = -1;
          for (;;) {
            let idleTimeout;
            const part = await Promise.race([
              reader.read(),
              new Promise((_, reject) => { idleTimeout = setTimeout(() => { downloadController.abort(); reject(new Error("Tải bộ cài bị gián đoạn. Hãy kiểm tra kết nối rồi thử lại.")); }, 60_000); idleTimeout.unref?.(); }),
            ]).finally(() => clearTimeout(idleTimeout));
            if (part.done) break;
            if (!(part.value instanceof Uint8Array)) throw new Error("Dữ liệu bộ cài PC không hợp lệ.");
            received += part.value.byteLength;
            if (received > manifest.size) throw new Error("Kích thước bộ cài không khớp. Hãy thử cập nhật lại.");
            hash.update(part.value);
            await handle.writeFile(part.value);
            const percent = Math.floor(received * 100 / manifest.size);
            if (percent !== lastPercent) { lastPercent = percent; progress({ phase: "downloading", version: manifest.version, received, total: manifest.size, percent }); }
          }
        } finally { clearTimeout(downloadTimeout); }
        progress({ phase: "verifying", version: manifest.version, received, total: manifest.size, percent: 100 });
        if (received !== manifest.size || hash.digest("hex") !== manifest.sha256) throw new Error("Bộ cài tải về chưa toàn vẹn. Hãy cập nhật lại; ứng dụng hiện tại vẫn được giữ nguyên.");
        await handle.sync();
        await handle.close();
        handle = null;
        await fs.rename(partialPath, installerPath);
        progress({ phase: "ready", version: manifest.version, received, total: manifest.size, percent: 100 });
        // Main must save/flush the renderer before starting this callback's
        // installer handoff. Only this verified, native-generated path is used.
        progress({ phase: "installing", version: manifest.version, percent: 100 });
        const result = await installVerifiedUpdate({ installerPath, version: manifest.version, sha256: manifest.sha256, size: manifest.size });
        if (result?.ok === false) throw new Error(result.error || "Chưa khởi động được bộ cài PC. Hãy thử lại.");
        installedResult = { ok: true, version: manifest.version, restarting: true };
        return installedResult;
      } catch (error) {
        downloadController?.abort();
        try { await reader?.cancel(); } catch { /* The transport may already be closed. */ }
        try { await handle?.close(); } catch { /* A failed write may have already closed the file. */ }
        if (stagingDirectory && path.dirname(stagingDirectory) === stagingRoot && path.basename(stagingDirectory).startsWith("install-")) {
          try { await fs.rm(stagingDirectory, { recursive: true, force: true }); } catch { /* An interrupted partial must never be executed. */ }
        }
        const message = error instanceof Error && /[\u00c0-\u1fff]/.test(error.message) ? error.message : "Không thể cập nhật PC. Hãy kiểm tra kết nối và dung lượng ổ đĩa rồi thử lại.";
        progress({ phase: "error", percent: 0, error: message });
        return { ok: false, error: message };
      } finally {
        try { reader?.releaseLock(); } catch { /* Already released by a failed transport. */ }
        pendingInstall = null;
      }
    })();
    return pendingInstall;
  }

  return { getAppInfo, checkForUpdates, downloadUpdate, installUpdate, getUpdateState };
}

module.exports = { createDesktopUpdateController, parseDesktopVersion, compareDesktopVersions, validateDesktopManifest, MANIFEST_URL };
