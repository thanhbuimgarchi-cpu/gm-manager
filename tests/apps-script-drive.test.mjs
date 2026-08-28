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

test("basic customer detail skips the three progress workbooks", () => {
  const context = loadContext();
  context.readXlsxSheets_ = () => ({
    "0. GM-CRM": [],
    "1. Chủ đầu tư": [],
    "2. Nhu cầu": [],
    "3. Thửa đất": [],
    "4. Công năng": [],
    "5. Hệ thống": [],
    "6. Thông tin ghi âm": [],
  });
  let progressReads = 0;
  context.readDesignProgress_ = () => { progressReads += 1; return []; };
  context.readWarrantyProgress_ = () => { progressReads += 1; return []; };
  const record = context.recordFromWorkbook_({ getName: () => "customer.xlsx" }, "GM26082026TEST", {}, false);
  assert.equal(progressReads, 0);
  assert.equal(record.progressHydrated, false);
});

test("document list hides temporary and backup drawing files", () => {
  const context = loadContext();
  ["ban-ve.bak", "ban-ve.dwl", "ban-ve.DWL2", "ban-ve.sv$", "ban-ve.ac$", "~$hop-dong.docx", "temp.tmp"].forEach((name) => {
    assert.equal(context.isHiddenDocumentFile_(name), true, name);
  });
  ["ban-ve.dwg", "ho-so.pdf", "thong-tin.xlsx"].forEach((name) => {
    assert.equal(context.isHiddenDocumentFile_(name), false, name);
  });
});

test("document listing never creates a new day by itself", () => {
  const context = loadContext({ Utilities: { formatDate: () => "26-08-2026" } });
  let snapshots = [{ folder: { getFiles: () => iterator([]) }, id: "old", name: "20-08-2026-GM26082026TEST", date: "20/08/2026" }];
  const documentsFolder = {
    createFolder: () => { throw new Error("must not create a day while listing"); },
  };
  context.documentsFolderForProject_ = () => documentsFolder;
  context.listDocumentSnapshots_ = () => snapshots;
  context.readDocumentManifest_ = () => ({ files: {}, snapshots: {} });
  const result = context.listDocuments_({ year: 2026, month: 8, projectId: "GM26082026TEST" });
  assert.equal(result.snapshots.length, 1);
  assert.equal(result.snapshots[0].date, "20/08/2026");
  assert.equal(result.activeSnapshotId, "old");
});

test("new-day command creates only one snapshot for the real current date", () => {
  const context = loadContext({ Utilities: { formatDate: () => "26-08-2026" } });
  let snapshots = [];
  const documentsFolder = {
    createFolder(name) {
      const created = { getId: () => "today" };
      snapshots = [{ folder: created, id: "today", name, date: "26/08/2026" }];
      return created;
    },
  };
  context.documentsFolderForProject_ = () => documentsFolder;
  context.listDocumentSnapshots_ = () => snapshots;
  context.clearDocumentCache_ = () => {};
  context.readDocumentManifest_ = () => ({ files: {}, snapshots: {} });
  const created = context.createDocumentSnapshot_({ year: 2026, month: 8, projectId: "GM26082026TEST" });
  assert.equal(created.alreadyExists, false);
  assert.equal(created.snapshot.date, "26/08/2026");
  const repeated = context.createDocumentSnapshot_({ year: 2026, month: 8, projectId: "GM26082026TEST" });
  assert.equal(repeated.alreadyExists, true);
  assert.equal(repeated.snapshot.id, "today");
});

test("deleting a document day trashes only that day and removes its manifest metadata", () => {
  const context = loadContext();
  const dayFolder = {
    trashed: false,
    getFiles: () => iterator([{ getId: () => "file-a" }, { getId: () => "file-b" }]),
    setTrashed(value) { this.trashed = value; },
  };
  const manifest = { files: { "file-a": { work: "Tư vấn" }, "file-b": { work: "Thiết kế" }, keep: { work: "Bảo hành" } }, snapshots: { day: { locked: false }, keepDay: { locked: true } } };
  let wroteManifest = null;
  let cleared = false;
  context.documentsFolderForProject_ = () => ({ id: "documents" });
  context.documentSnapshotForProject_ = () => ({ id: "day", folder: dayFolder });
  context.readDocumentManifest_ = () => manifest;
  context.writeDocumentManifest_ = (_folder, next) => { wroteManifest = structuredClone(next); };
  context.clearDocumentCache_ = () => { cleared = true; };
  const result = context.deleteDocumentSnapshot_({ year: 2026, month: 8, projectId: "GM26082026TEST", snapshotId: "day" });
  assert.equal(result.ok, true);
  assert.equal(result.deletedSnapshotId, "day");
  assert.equal(dayFolder.trashed, true);
  assert.equal(wroteManifest.files["file-a"], undefined);
  assert.equal(wroteManifest.files["file-b"], undefined);
  assert.deepEqual(wroteManifest.files.keep, { work: "Bảo hành" });
  assert.equal(wroteManifest.snapshots.day, undefined);
  assert.equal(wroteManifest.snapshots.keepDay.locked, true);
  assert.equal(cleared, true);
});

test("work notes only keep the allowed choices and valid due dates", () => {
  const context = loadContext();
  const notes = context.normalizeWorkNotes_([
    { id: "note-1", priority: "Gấp", workType: "Thiết kế", assignee: "An", content: "Duyệt bản vẽ", dueDate: "2026-08-31", status: "Đỏ" },
    { id: "note-2", priority: "Không hợp lệ", workType: "Khác", dueDate: "31/08/2026", status: "Tím" },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(notes)), [
    { id: "note-1", priority: "Gấp", workType: "Thiết kế", assignee: "An", content: "Duyệt bản vẽ", dueDate: "2026-08-31", status: "Đỏ" },
    { id: "note-2", priority: "Bình thường", workType: "Tư vấn", assignee: "", content: "", dueDate: "", status: "Cam" },
  ]);
});
