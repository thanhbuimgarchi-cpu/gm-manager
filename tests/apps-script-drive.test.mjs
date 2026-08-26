import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../apps-script/Code.js", import.meta.url), "utf8");

function iterator(items) {
  let index = 0;
  return { hasNext: () => index < items.length, next: () => items[index++] };
}

function folder(name, createdAt) {
  return {
    name,
    trashed: false,
    getName() { return this.name; },
    getDateCreated() { return new Date(createdAt); },
    getFolders() { return iterator([]); },
    getFiles() { return iterator([]); },
    setTrashed(value) { this.trashed = value; },
  };
}

function loadContext(extra = {}) {
  const context = vm.createContext({ console, ...extra });
  vm.runInContext(source, context);
  return context;
}

test("Drive folder matching tolerates Unicode normalization and casing", () => {
  const context = loadContext();
  const composed = "Dự toán";
  const decomposed = composed.normalize("NFD").toUpperCase();
  assert.equal(context.normalizeDriveName_(composed), context.normalizeDriveName_(decomposed));
});

test("getOrCreateFolder_ reuses the oldest folder and trashes empty duplicates", () => {
  const older = folder("Nghiệm thu", "2026-01-01T00:00:00Z");
  const newer = folder("NGHIỆM THU".normalize("NFD"), "2026-02-01T00:00:00Z");
  const parent = {
    getFolders: () => iterator([newer, older]),
    createFolder: () => { throw new Error("must not create another duplicate"); },
  };
  const context = loadContext();
  assert.equal(context.getOrCreateFolder_(parent, "Nghiệm thu"), older);
  assert.equal(newer.trashed, true);
  assert.equal(older.trashed, false);
});
