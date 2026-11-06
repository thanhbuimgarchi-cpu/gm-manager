import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createInstallerHandoff } = require("../desktop/install-update.cjs");
const content = Buffer.from("MZ - fixture-only installer bytes, never executed");
const digest = value => createHash("sha256").update(value).digest("hex");

function fixture(options = {}) {
  const updateDirectory = path.resolve(options.directory || "work/Program Files/Bùi Đức Thành/updates");
  const staging = path.join(updateDirectory, "install-aB12cD");
  const installerPath = path.join(staging, "GM-CRM-Setup-1.3.0.exe");
  const calls = [], order = [];
  const app = { isPackaged: options.packaged !== false, quit() { order.push("quit"); } };
  const child = new EventEmitter();
  child.unref = () => { order.push("unref"); };
  const data = options.content || content;
  let position = 0;
  const fs = {
    async lstat(value) { return { isFile: () => value === installerPath, isDirectory: () => value === staging, isSymbolicLink: () => Boolean(options.symlink) }; },
    async realpath(value) { return options.escapedRealpath && value === installerPath ? path.resolve("outside/GM-CRM-Setup-1.3.0.exe") : value; },
    async open() { position = 0; return {
      async stat() { return { isFile: () => true, size: options.fileSize ?? data.length }; },
      async read(buffer) { const length = Math.min(buffer.length, data.length - position); data.copy(buffer, 0, position, position + length); position += length; return { bytesRead: length }; },
      async close() { order.push("verified-file-closed"); },
    }; },
  };
  const spawn = (...args) => {
    calls.push(args); order.push("spawn-called");
    if (options.throwSpawn) throw new Error("synthetic spawn failure");
    queueMicrotask(() => child.emit(options.eventError ? "error" : "spawn", options.eventError ? new Error("synthetic native error") : undefined));
    return child;
  };
  const controller = createInstallerHandoff({ app, spawn, updateDirectory: options.lazyDirectory ? () => updateDirectory : updateDirectory, platform: options.platform || "win32", fs });
  const value = { installerPath, version: "1.3.0", size: content.length, sha256: digest(content) };
  return { controller, value, calls, order, child };
}

test("a verified installer starts silently with fixed arguments, then quits and NSIS restarts the installed app", async () => {
  const f = fixture({ lazyDirectory: true });
  assert.deepEqual(await f.controller.installVerifiedUpdate(f.value), { ok: true, installing: true, version: "1.3.0" });
  assert.deepEqual(f.calls, [[f.value.installerPath, ["--updated", "/S", "--force-run"], { detached: true, stdio: "ignore", windowsHide: true, shell: false }]]);
  assert.deepEqual(f.order, ["verified-file-closed", "spawn-called", "unref", "quit"]);
  assert.ok(!f.calls[0][1].some(value => value.startsWith("/D=")), "NSIS uses the existing GUID InstallLocation, avoiding old quoted /D path corruption");
});

test("double clicks coalesce and a completed handoff never starts a second installer", async () => {
  const f = fixture();
  const first = f.controller.installVerifiedUpdate(f.value), second = f.controller.installVerifiedUpdate(f.value);
  assert.equal(first, second);
  await first;
  await f.controller.installVerifiedUpdate(f.value);
  assert.equal(f.calls.length, 1);
  assert.equal(f.order.filter(value => value === "quit").length, 1);
});

test("spawn failures keep the existing app running and a failed attempt can be retried", async () => {
  for (const options of [{ throwSpawn: true }, { eventError: true }]) {
    const f = fixture(options);
    await assert.rejects(f.controller.installVerifiedUpdate(f.value), /synthetic/);
    assert.ok(!f.order.includes("quit"));
    assert.ok(!f.order.includes("unref"));
    await assert.rejects(f.controller.installVerifiedUpdate(f.value));
    assert.equal(f.calls.length, 2);
  }
});

test("paths outside the native-owned staging layout and malformed manifests never execute", async () => {
  for (const change of [
    { installerPath: path.resolve("outside/GM-CRM-Setup-1.3.0.exe") },
    { installerPath: path.resolve("work/Program Files/Bùi Đức Thành/updates/GM-CRM-Setup-1.3.0.exe") },
    { installerPath: path.resolve("work/Program Files/Bùi Đức Thành/updates/install-aB12cD/other.exe") },
    { installerPath: "https://example.com/setup.exe" },
    { version: "1.3.0\n" }, { version: "01.3.0" }, { version: "../../evil" },
    { size: -1 }, { size: 1024 ** 3 + 1 }, { sha256: "not-hashed" },
  ]) {
    const f = fixture();
    await assert.rejects(f.controller.installVerifiedUpdate({ ...f.value, ...change }));
    assert.equal(f.calls.length, 0); assert.ok(!f.order.includes("quit"));
  }
});

test("staged symlinks and realpath escapes cannot become executable handoffs", async () => {
  for (const options of [{ symlink: true }, { escapedRealpath: true }]) {
    const f = fixture(options);
    await assert.rejects(f.controller.installVerifiedUpdate(f.value), /Vị trí/);
    assert.equal(f.calls.length, 0);
  }
});

test("a staged file is rehashed after preparation so changed or truncated bytes never run", async () => {
  for (const options of [{ content: Buffer.from("bad-file") }, { content: Buffer.alloc(content.length, 1) }, { fileSize: content.length + 1 }]) {
    const f = fixture(options);
    await assert.rejects(f.controller.installVerifiedUpdate(f.value), /Bộ cài/);
    assert.equal(f.calls.length, 0); assert.ok(!f.order.includes("quit"));
  }
});

test("unsupported and development applications cannot start an installer", async () => {
  for (const options of [{ platform: "darwin" }, { platform: "linux" }, { packaged: false }]) {
    const f = fixture(options);
    await assert.rejects(f.controller.installVerifiedUpdate(f.value), /Windows/);
    assert.equal(f.calls.length, 0);
  }
});
