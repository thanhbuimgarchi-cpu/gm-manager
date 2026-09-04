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

test("Drive root links can be normalized and saved for all devices", () => {
  const values = new Map();
  const folder = { getName: () => "GM Manager" };
  const context = loadContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => values.get(key) || "", setProperty: (key, value) => values.set(key, value) }) },
    DriveApp: { getFolderById: (id) => { assert.equal(id, "1jY12yTvgh4ZvpuX6r4coOrOBwdPEDAqu"); return folder; } },
  });
  assert.equal(context.normalizeDriveFolderId_("https://drive.google.com/drive/folders/1jY12yTvgh4ZvpuX6r4coOrOBwdPEDAqu?usp=sharing"), "1jY12yTvgh4ZvpuX6r4coOrOBwdPEDAqu");
  const saved = context.setDriveRootFolder_({ driveUrl: "https://drive.google.com/drive/folders/1jY12yTvgh4ZvpuX6r4coOrOBwdPEDAqu" });
  assert.equal(saved.ok, true);
  assert.equal(saved.folderId, "1jY12yTvgh4ZvpuX6r4coOrOBwdPEDAqu");
  assert.equal(saved.folderName, "GM Manager");
  assert.equal(values.get("gmcrm-drive-root-folder-id"), "1jY12yTvgh4ZvpuX6r4coOrOBwdPEDAqu");
});

test("house code changes rename the existing Drive customer folder", () => {
  const cache = new Map();
  const makeFolder = (name, id, children = []) => ({
    name,
    getId: () => id,
    getUrl: () => `https://drive.google.com/drive/folders/${id}`,
    getName() { return this.name; },
    setName(value) { this.name = value; },
    getDateCreated: () => new Date("2026-01-01T00:00:00Z"),
    getFolders: () => iterator(children),
    getFiles: () => iterator([]),
  });
  const customer = makeFolder("HP-587", "customer-id-123");
  const month = makeFolder("T9", "month-id-123", [customer]);
  const year = makeFolder("2026", "year-id-123", [month]);
  const customers = makeFolder("Khách hàng", "customers-id-123", [year]);
  const root = makeFolder("GM Manager", "root-id-123", [customers]);
  const context = loadContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => "root-id-123" }) },
    CacheService: { getScriptCache: () => ({ get: (key) => cache.get(key) || "", put: (key, value) => cache.set(key, value), remove: (key) => cache.delete(key) }) },
    DriveApp: { getFolderById: (id) => { if (id === "root-id-123" || id === "customer-id-123") return id === "root-id-123" ? root : customer; throw new Error("missing folder"); } },
  });
  const result = context.renameCustomerFolder_({ year: 2026, month: 9, projectId: "GM03092026V", oldHouseId: "HP-587", houseId: "HP-888" });
  assert.equal(result.ok, true);
  assert.equal(customer.getName(), "HP-888");
});

test("Drive listings exclude spreadsheet files", () => {
  const context = loadContext();
  assert.equal(context.isSpreadsheetFile_("Phiếu thông tin khách hàng.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), true);
  assert.equal(context.isSpreadsheetFile_("danh-sach.csv", "text/csv"), true);
  assert.equal(context.isSpreadsheetFile_("hop-dong.pdf", "application/pdf"), false);
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

test("work notes stay black until an assignee accepts the work", () => {
  const context = loadContext();
  const due = new Date();
  due.setDate(due.getDate() + 2);
  const dueDate = [String(due.getDate()).padStart(2, "0"), String(due.getMonth() + 1).padStart(2, "0"), due.getFullYear()].join("/");
  const notes = context.normalizeWorkNotes_([
    { id: "note-1", priority: "Gấp", workType: "Thiết kế", assignee: "An", content: "Duyệt bản vẽ", dueDate, actualDate: "31/08/2026", acceptedAt: "28/08/2026", status: "Đỏ" },
    { id: "note-2", priority: "Không hợp lệ", workType: "Khác", dueDate: "31/08/2026", actualDate: "2026/08/31", status: "Tím" },
  ]);
  const normalized = JSON.parse(JSON.stringify(notes));
  assert.deepEqual(normalized, [
    { id: "note-1", priority: "Gấp", workType: "Thiết kế", assignee: "An", assigneeEmail: "", creatorEmail: "", creatorName: "", acceptedBy: "", content: "Duyệt bản vẽ", dueDate, actualDate: "31/08/2026", completedAt: "", acceptedAt: "28/08/2026", status: "Đỏ" },
    { id: "note-2", priority: "Bình thường", workType: "Tư vấn", assignee: "", assigneeEmail: "", creatorEmail: "", creatorName: "", acceptedBy: "", content: "", dueDate: "31/08/2026", actualDate: "", completedAt: "", acceptedAt: "", status: "Đen" },
  ]);
});

test("publishing work notes falls back to shared script properties when Drive is read-only", () => {
  const values = new Map();
  const properties = {
    getProperty: (key) => values.get(key) || null,
    setProperty: (key, value) => values.set(key, String(value)),
    deleteProperty: (key) => values.delete(key),
  };
  const context = loadContext({
    Utilities: { base64EncodeWebSafe: (value) => Buffer.from(value).toString("base64url") },
    PropertiesService: { getScriptProperties: () => properties },
  });
  context.workNotesFolder_ = () => { throw new Error("Truy cập bị từ chối: DriveApp."); };
  context.cacheJson_ = () => {};
  context.syncActiveWorkNotes_ = () => {};
  const payload = {
    year: 2026,
    month: 9,
    projectId: "GM03092026TEST",
    notes: [{ id: "note-1", priority: "Gấp", workType: "Tư vấn", content: "Gọi khách", dueDate: "05/09/2026" }],
  };
  const result = context.syncWorkNotes_(payload);
  assert.equal(result.ok, true);
  assert.equal(result.storage, "script-properties");
  assert.equal(context.loadWorkNotes_(payload).notes[0].content, "Gọi khách");
});

test("workspace cache is shared without touching Drive", () => {
  const values = new Map();
  const properties = {
    getProperty: (key) => values.get(key) || null,
    setProperty: (key, value) => values.set(key, String(value)),
    deleteProperty: (key) => values.delete(key),
  };
  const context = loadContext({ PropertiesService: { getScriptProperties: () => properties } });
  const years = [{ year: 2026, months: [{ label: "T9", records: [{ projectId: "GM03092026TEST", details: { HVT: "Khách thử" }, designProgress: [] }] }] }];
  assert.equal(context.saveWorkspaceCache_({ updatedAt: 100, years }).ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(context.loadWorkspaceCache_({}).years)), years);
  assert.equal(context.saveWorkspaceCache_({ updatedAt: 90, years: [] }).ignored, true);
  assert.deepEqual(JSON.parse(JSON.stringify(context.loadWorkspaceCache_({}).years)), years);
});

test("admin receives the active work-note overview across every customer", () => {
  const context = loadContext();
  context.readActiveWorkNotes_ = () => [
    { id: "note-a", projectId: "GM-A", assigneeEmail: "an@company.com", actualDate: "" },
    { id: "note-b", projectId: "GM-B", assigneeEmail: "binh@company.com", actualDate: "" },
    { id: "note-done", projectId: "GM-C", assigneeEmail: "an@company.com", actualDate: "29/08/2026" },
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(context.loadAssignedWorkNotes_({ email: "admin" }).notes.map((note) => note.id))), ["note-a", "note-b"]);
  assert.deepEqual(JSON.parse(JSON.stringify(context.loadAssignedWorkNotes_({ email: "an@company.com" }).notes.map((note) => note.id))), ["note-a"]);
});

test("legacy personnel rows without email remain assignable by stable member id", () => {
  const context = loadContext();
  context.readActiveWorkNotes_ = () => [{ id: "note-legacy", assigneeEmail: "member:person-1", actualDate: "" }];
  context.employeeRosterMember_ = () => ({ id: "person-1", email: "employee@example.com", status: "Có" });
  assert.equal(context.personnelAssignmentKey_({ id: "person-1", email: "" }), "member:person-1");
  assert.equal(context.loadAssignedWorkNotes_({ email: "employee@example.com" }).notes[0].id, "note-legacy");
});

test("Pancake group names map to a house code only when the GM marker is present", () => {
  const context = loadContext();
  assert.equal(context.pancakeHouseIdFromGroupName_("HP-587-GM-Tư vấn"), "HP-587");
  assert.equal(context.pancakeHouseIdFromGroupName_("bc thi công dv 75 - GM"), "bc thi công dv 75");
  assert.equal(context.pancakeHouseIdFromGroupName_("HP-587-Tư vấn"), "");
});

test("Pancake customer messages are grouped into two-hour windows", () => {
  const context = loadContext();
  const groups = context.groupPancakeMessages_(
    { id: "conversation-1", from: { name: "HP-587-GM-Tư vấn" }, page_customer: { name: "Nguyễn Tùng" } },
    [
      { id: "m-2", text: "Tin thứ hai", inserted_at: "2026-09-03T10:20:00.000Z", from: { name: "Nguyễn Tùng" } },
      { id: "m-1", text: "Tin thứ nhất", inserted_at: "2026-09-03T09:00:00.000Z", from: { name: "Nguyễn Tùng" } },
      { id: "m-3", text: "Tin mới", inserted_at: "2026-09-03T13:00:01.000Z", from: { name: "Nguyễn Tùng" } },
    ],
    { houseId: "HP-587", projectId: "GM09092026NT", customerName: "Nguyễn Tùng", year: 2026, month: 9 },
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0].messageCount, 2);
  assert.equal(groups[0].messages[0].content, "Tin thứ nhất");
  assert.equal(groups[1].messages[0].content, "Tin mới");
});

test("employee credentials are stored as a hash and verified by the server", () => {
  const values = new Map();
  const context = loadContext({
    Utilities: {
      base64EncodeWebSafe: (value) => Buffer.from(value).toString("base64url"),
      getUuid: () => "fixed-salt",
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (_algorithm, value) => [...Buffer.from(value)],
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => values.get(key) || null, setProperty: (key, value) => values.set(key, value), deleteProperty: (key) => values.delete(key) }) },
  });
  context.employeeRosterMember_ = (email) => email === "an@company.com" ? { email, status: "Có" } : null;
  assert.equal(context.registerEmployeeAccount_({ email: "an@company.com", password: "matkhau" }).ok, true);
  assert.equal(values.has("gmcrm-employee-account-YW5AY29tcGFueS5jb20"), true);
  assert.equal(context.verifyEmployeeLogin_({ email: "an@company.com", password: "matkhau" }).valid, true);
  assert.equal(context.verifyEmployeeLogin_({ email: "an@company.com", password: "sai-mat-khau" }).valid, false);
});

test("customer portal keeps a published token private and returns only project progress", () => {
  const context = loadContext();
  assert.equal(context.normalizeCustomerShareToken_("A".repeat(48)), "a".repeat(48));
  assert.equal(context.normalizeCustomerShareToken_("not-a-token"), "");
  const portalRecord = context.customerPortalRecord_({
    projectId: "GM20092001A",
    name: "Khách hàng thử",
    houseId: "BT-08",
    customerShareToken: "a".repeat(48),
    designProgress: [{ content: "Duyệt mặt bằng", plannedDate: "20/09/2026", actualDate: "" }],
    interiorDesignProgress: [],
    acceptanceDesignProgress: [],
    warrantyProgress: [{ content: "Kiểm tra", reportedDate: "21/09/2026", completedDate: "22/09/2026" }],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(portalRecord)), {
    projectId: "GM20092001A",
    name: "Khách hàng thử",
    houseId: "BT-08",
    designProgress: [{ content: "Duyệt mặt bằng", plannedDate: "20/09/2026", actualDate: "" }],
    interiorDesignProgress: [],
    acceptanceDesignProgress: [],
    warrantyProgress: [{ content: "Kiểm tra", plannedDate: "21/09/2026", actualDate: "22/09/2026" }],
  });
});
