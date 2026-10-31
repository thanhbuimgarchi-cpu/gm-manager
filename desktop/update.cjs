"use strict";

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

// Checking is read-only. Downloading opens a known, version-specific installer
// in the browser only after a user action; it never runs an installer or quits
// the user's current workspace automatically.
function createDesktopUpdateController({ getVersion, platform, isPackaged, fetcher, openExternal }) {
  let pending = null;
  function getAppInfo() { return { version: getVersion(), platform, isPackaged: Boolean(isPackaged) }; }
  function baseState() { return { supported: platform === "win32" && Boolean(isPackaged), currentVersion: getVersion(), latestVersion: "", updateAvailable: false }; }

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

  return { getAppInfo, checkForUpdates, downloadUpdate };
}

module.exports = { createDesktopUpdateController, parseDesktopVersion, compareDesktopVersions, validateDesktopManifest, MANIFEST_URL };
