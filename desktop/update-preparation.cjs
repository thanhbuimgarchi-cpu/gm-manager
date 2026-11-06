"use strict";

const { randomUUID } = require("node:crypto");

// A verified installer may only close the app after the current renderer has
// saved its drafts. A stale page, another window or a missing listener cannot
// acknowledge this one-use request.
function createUpdatePreparation({ getWindow, timeoutMs = 15000, requestId = randomUUID }) {
  let pending = null;
  function prepare() {
    if (pending) return pending.promise;
    const window = getWindow();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed?.()) return Promise.reject(new Error("Hãy mở lại GM Manager trước khi cập nhật."));
    const id = requestId();
    let finish, timer;
    const promise = new Promise((resolve, reject) => {
      finish = (error) => { clearTimeout(timer); pending = null; error ? reject(error) : resolve(); };
      timer = setTimeout(() => finish(new Error("Ứng dụng chưa xác nhận lưu dữ liệu. Hãy tải lại giao diện rồi thử cập nhật.")), timeoutMs);
    });
    pending = { id, contents: window.webContents, promise, finish };
    try { window.webContents.send("gmcrm:prepare-update", id); }
    catch { finish(new Error("Chưa thể lưu dữ liệu trước khi cập nhật. Hãy thử lại.")); }
    return promise;
  }
  function acknowledge(contents, payload) {
    if (!pending || contents !== pending.contents || !payload || payload.requestId !== pending.id || typeof payload.ok !== "boolean") return false;
    pending.finish(payload.ok ? null : new Error(typeof payload.error === "string" && payload.error.trim() ? payload.error.slice(0, 500) : "Hãy hoàn tất công việc đang nhập trước khi cập nhật."));
    return true;
  }
  return { prepare, acknowledge };
}

module.exports = { createUpdatePreparation };
