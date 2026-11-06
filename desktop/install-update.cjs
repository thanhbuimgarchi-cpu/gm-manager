"use strict";

const path = require("node:path");
const fsPromises = require("node:fs/promises");
const { createHash } = require("node:crypto");

const MAX_INSTALLER_SIZE = 1024 * 1024 * 1024;
const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const samePath = (left, right) => path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();

// The downloader owns all inputs to this helper. No renderer URL, executable
// path or command-line options are accepted by its IPC endpoint.
function createInstallerHandoff({ app, spawn, updateDirectory, platform, fs = fsPromises }) {
  let pending = null;
  let handedOff = null;

  async function validateAndVerify(value) {
    if (platform !== "win32" || !app.isPackaged) throw new Error("Cập nhật tự động chỉ hỗ trợ bản Windows đã cài đặt.");
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.version !== "string" || value.version !== value.version.trim() || !VERSION.test(value.version) || typeof value.installerPath !== "string" || value.installerPath.includes("\0") || typeof value.sha256 !== "string" || value.sha256.length !== 64 || !/^[a-fA-F0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > MAX_INSTALLER_SIZE) throw new Error("Bộ cài cập nhật chưa được xác nhận.");
    const directory = typeof updateDirectory === "function" ? updateDirectory() : updateDirectory;
    if (typeof directory !== "string" || !path.isAbsolute(directory) || !path.isAbsolute(value.installerPath)) throw new Error("Vị trí bộ cài cập nhật không hợp lệ.");
    const installer = path.resolve(value.installerPath);
    const staging = path.dirname(installer);
    if (!samePath(path.dirname(staging), directory) || !/^install-[A-Za-z0-9]{6,64}$/.test(path.basename(staging)) || path.basename(installer) !== `GM-CRM-Setup-${value.version}.exe`) throw new Error("Vị trí bộ cài cập nhật không hợp lệ.");
    const [parentInfo, fileInfo, realRoot, realStaging, realInstaller] = await Promise.all([
      fs.lstat(staging), fs.lstat(installer), fs.realpath(directory), fs.realpath(staging), fs.realpath(installer),
    ]);
    if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || !fileInfo.isFile() || fileInfo.isSymbolicLink() || !samePath(path.dirname(realStaging), realRoot) || !samePath(path.dirname(realInstaller), realStaging) || path.basename(realInstaller) !== path.basename(installer)) throw new Error("Vị trí bộ cài cập nhật không hợp lệ.");

    // Recheck after renderer preparation, immediately before handoff. Cached
    // bytes must still match the manifest that the native downloader verified.
    const handle = await fs.open(installer, "r");
    try {
      const information = await handle.stat();
      if (!information.isFile() || information.size !== value.size) throw new Error("Bộ cài cập nhật không đủ dữ liệu. Hãy thử cập nhật lại.");
      const hash = createHash("sha256");
      const buffer = Buffer.allocUnsafe(64 * 1024);
      let bytes = 0;
      for (;;) {
        const chunk = await handle.read(buffer, 0, buffer.length, null);
        if (!chunk.bytesRead) break;
        bytes += chunk.bytesRead;
        if (bytes > value.size) throw new Error("Bộ cài cập nhật đã thay đổi. Hãy thử cập nhật lại.");
        hash.update(buffer.subarray(0, chunk.bytesRead));
      }
      if (bytes !== value.size || hash.digest("hex") !== value.sha256.toLowerCase()) throw new Error("Bộ cài cập nhật không đúng mã kiểm tra. Hãy thử cập nhật lại.");
    } finally { await handle.close(); }
    return installer;
  }

  async function handoff(value) {
    const installer = await validateAndVerify(value);
    await new Promise((resolve, reject) => {
      let child;
      try {
        // electron-builder's NSIS installer reuses InstallLocation and its
        // existing per-user/per-machine scope by the unchanged app GUID. Do
        // not pass /D: builder 26.15.3 retains a closing quote for spaced paths.
        // The assisted installer requests normal Windows UAC for a silent
        // per-machine upgrade and --force-run opens the installed app as user.
        child = spawn(installer, ["--updated", "/S", "--force-run"], { detached: true, stdio: "ignore", windowsHide: true, shell: false });
        child.once("error", reject);
        child.once("spawn", () => {
          child.unref();
          resolve();
        });
      } catch (error) { reject(error); }
    });
    handedOff = { ok: true, installing: true, version: value.version };
    app.quit();
    return handedOff;
  }

  function installVerifiedUpdate(value) {
    if (handedOff) return Promise.resolve(handedOff);
    if (!pending) pending = handoff(value).finally(() => { pending = null; });
    return pending;
  }

  return { installVerifiedUpdate };
}

module.exports = { createInstallerHandoff };
