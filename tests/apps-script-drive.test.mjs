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

test("document listing adds today's dated snapshot when a project only has an older one", () => {
  const context = loadContext({ Utilities: { formatDate: () => "26-08-2026" } });
  let snapshots = [{ folder: { getFiles: () => iterator([]) }, id: "old", name: "20-08-2026-GM26082026TEST", date: "20/08/2026" }];
  const documentsFolder = {
    createFolder(name) {
      const created = { getFiles: () => iterator([]) };
      snapshots = [{ folder: created, id: "today", name, date: "26/08/2026" }, ...snapshots];
      return created;
    },
  };
  context.getCustomerFolder_ = () => ({});
  context.documentsFolderForProject_ = () => documentsFolder;
  context.listDocumentSnapshots_ = () => snapshots;
  context.readDocumentManifest_ = () => ({ files: {}, snapshots: {} });
  context.projectSourceFiles_ = () => ({});
  context.createDocumentSnapshot_ = () => { throw new Error("Hãy gắn Công việc và Tính chất cho ít nhất một tệp trước khi tạo bản ngày mới."); };
  const result = context.listDocuments_({ year: 2026, month: 8, projectId: "GM26082026TEST" });
  assert.equal(result.snapshots.length, 2);
  assert.equal(result.snapshots[0].date, "26/08/2026");
  assert.equal(result.activeSnapshotId, "today");
});
