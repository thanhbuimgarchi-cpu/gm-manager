import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
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
  const values = new Map();
  const utilities = {
    base64EncodeWebSafe: (value) => Buffer.from(value).toString("base64url"),
    base64DecodeWebSafe: (value) => [...Buffer.from(value, "base64url")],
    newBlob: (value) => ({ getDataAsString: () => Buffer.from(value).toString("utf8") }),
    getUuid: randomUUID,
    Charset: { UTF_8: "utf8" }, DigestAlgorithm: { SHA_256: "sha256" },
    computeHmacSha256Signature: (value, secret) => [...createHmac("sha256", secret).update(value).digest()],
    computeDigest: (_algorithm, value) => [...createHash("sha256").update(value).digest()],
    formatDate: (date, timeZone, format) => {
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
      const part = (type) => parts.find((item) => item.type === type)?.value;
      const tokens = { dd: part("day"), MM: part("month"), yyyy: part("year"), HH: part("hour"), mm: part("minute"), ss: part("second") };
      return format.replace(/yyyy|dd|MM|HH|mm|ss/g, (token) => tokens[token]);
    },
  };
  const context = vm.createContext({
    console,
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => values.get(key) ?? null, setProperty: (key, value) => values.set(key, String(value)), deleteProperty: (key) => values.delete(key) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ...extra,
    Utilities: { ...utilities, ...extra.Utilities },
  });
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
  const properties = new Map([["gmcrm-drive-root-folder-id", "root-id-123"]]);
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
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties.get(key) || "", setProperty: (key, value) => properties.set(key, value), deleteProperty: (key) => properties.delete(key) }) },
    CacheService: { getScriptCache: () => ({ get: (key) => cache.get(key) || "", put: (key, value) => cache.set(key, value), remove: (key) => cache.delete(key) }) },
    DriveApp: { getFolderById: (id) => { if (id === "root-id-123" || id === "customer-id-123") return id === "root-id-123" ? root : customer; throw new Error("missing folder"); } },
  });
  const result = context.renameCustomerFolder_({ year: 2026, month: 9, projectId: "GM03092026V", oldHouseId: "HP-587", houseId: "HP-888" });
  assert.equal(result.ok, true);
  assert.equal(customer.getName(), "HP-888");
});

function customerMutationFixture() {
  const folders = new Map();
  let createdCount = 0;
  const makeFolder = (name, id, children = []) => {
    const value = {
      name, children, trashed: false, trashCalls: 0,
      getName() { return this.name; },
      getId: () => id,
      getUrl: () => `https://drive.google.com/drive/folders/${id}`,
      getDateCreated: () => new Date("2026-01-01T00:00:00Z"),
      getFolders() { return iterator(this.children.filter((child) => !child.trashed)); },
      getFiles: () => iterator([]),
      getFilesByName: () => iterator([]),
      createFolder() { createdCount += 1; throw new Error("mutations must not create missing Drive folders"); },
      setName(next) { this.name = next; },
      isTrashed() { return this.trashed; },
      setTrashed(next) { this.trashed = next; this.trashCalls += 1; },
    };
    folders.set(id, value);
    return value;
  };
  const target = makeFolder("HP-587", "target-folder-id");
  const keep = makeFolder("NT5-38", "keep-folder-id");
  const otherMonthTarget = makeFolder("HP-587", "other-month-target-id");
  const month = makeFolder("T9", "month-folder-id", [target, keep]);
  const otherMonth = makeFolder("T8", "other-month-id", [otherMonthTarget]);
  const year = makeFolder("2026", "year-folder-id", [month, otherMonth]);
  const customers = makeFolder("Khách hàng", "customers-folder-id", [year]);
  const root = makeFolder("GM Manager", "root-folder-id", [customers]);
  const values = new Map([["gmcrm-drive-root-folder-id", "root-folder-id"]]);
  const cache = new Map();
  const context = loadContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => values.get(key) || "", setProperty: (key, value) => values.set(key, String(value)), deleteProperty: (key) => values.delete(key) }) },
    CacheService: { getScriptCache: () => ({ get: (key) => cache.get(key) || "", put: (key, value) => cache.set(key, value), remove: (key) => cache.delete(key) }) },
    DriveApp: { getFolderById: (id) => { const value = folders.get(id); if (!value) throw new Error("folder missing"); return value; } },
    Utilities: {
      base64EncodeWebSafe: (value) => Buffer.from(value).toString("base64url"),
      base64DecodeWebSafe: (value) => [...Buffer.from(value, "base64url")],
      newBlob: (value) => ({ getDataAsString: () => Buffer.from(value).toString("utf8") }),
      getUuid: randomUUID,
      Charset: { UTF_8: "utf8" },
      computeHmacSha256Signature: (value, secret) => [...createHmac("sha256", secret).update(value).digest()],
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  });
  const adminSessionToken = context.verifyEmployeeLogin_({ name: "admin", loginCode: "1" }).adminSessionToken;
  return { context, target, keep, otherMonthTarget, month, year, customers, root, makeFolder, values, adminSessionToken, createdCount: () => createdCount };
}

test("only the built-in admin login receives authorization to create or delete customers", () => {
  const f = customerMutationFixture();
  f.context.loadPersonnel_ = () => ({ personnel: { office: [
    { id: "employee", name: "Nhân viên", email: "employee@example.com", loginCode: "123", role: "Nhân viên kỹ thuật" },
    { id: "manager", name: "Quản lý", email: "manager@example.com", loginCode: "456", role: "Quản lý chung" },
    { id: "reserved", name: "Admin", email: "other-admin@example.com", loginCode: "other-code", role: "Quản lý chung" },
  ] } });
  assert.equal(f.context.verifyEmployeeLogin_({ name: "admin", loginCode: "wrong" }).valid, false);
  assert.equal(f.context.verifyEmployeeLogin_({ name: "Admin", loginCode: "other-code" }).valid, false, "a roster row cannot impersonate the reserved admin account");
  for (const credentials of [{ name: "Nhân viên", loginCode: "123" }, { name: "Quản lý", loginCode: "456" }]) {
    const result = f.context.verifyEmployeeLogin_(credentials);
    assert.equal(result.valid, true);
    assert.equal(Object.hasOwn(result, "adminSessionToken"), false);
  }
  const result = f.context.verifyEmployeeLogin_({ name: " ADMIN ", loginCode: "1" });
  assert.equal(result.valid, true);
  assert.equal(result.account, "admin");
  assert.equal(f.context.requireCustomerAdminSession_({ adminSessionToken: result.adminSessionToken }).account, "admin");
});

test("customer create/delete reject missing, forged, expired and non-admin sessions without changing Drive or cache", () => {
  const f = customerMutationFixture();
  const [body, signature] = f.adminSessionToken.split(".");
  const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  const signed = (patch) => {
    const nextBody = Buffer.from(JSON.stringify({ ...claims, ...patch })).toString("base64url");
    const secret = f.values.get("gmcrm-customer-admin-session-secret-v1");
    return `${nextBody}.${createHmac("sha256", secret).update(nextBody).digest("base64url")}`;
  };
  const denied = [undefined, "invalid", `${body}.${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`, signed({ expiresAt: Date.now() - 1 }), signed({ account: "employee@example.com" }), signed({ account: "manager@example.com", role: "Quản lý chung" })];
  const before = [...f.values];
  for (const adminSessionToken of denied) {
    const payload = { year: 2026, month: 9, projectId: "GM-TARGET", houseId: "HP-587", folderId: f.target.getId(), actorEmail: "admin", account: "admin", adminSessionToken };
    assert.throws(() => f.context.createCustomerFolder_(payload), /Chỉ admin mới có quyền/);
    assert.throws(() => f.context.deleteCustomerFolder_(payload), /Chỉ admin mới có quyền/);
  }
  assert.deepEqual([...f.values], before);
  assert.equal(f.createdCount(), 0);
  assert.equal(f.target.trashCalls, 0);
  assert.equal(f.keep.trashed, false);
});

test("an authenticated admin can create a customer and authorization is required again for delete retries", () => {
  const f = customerMutationFixture();
  const newCustomer = f.makeFolder("HP-NEW", "new-admin-customer-folder-id");
  let foldersInitialized = 0;
  f.context.getOrCreateFolder_ = (parent, name) => {
    if (parent === f.root && name === "Khách hàng") return f.customers;
    if (parent === f.customers && name === "2026") return f.year;
    if (parent === f.year && name === "T9") return f.month;
    if (parent === f.month && name === "HP-NEW") { f.month.children.push(newCustomer); return newCustomer; }
    throw new Error("unexpected folder creation");
  };
  f.context.ensureProjectFolders_ = (folder) => { assert.equal(folder, newCustomer); foldersInitialized += 1; };
  const request = { year: 2026, month: 9, projectId: "GM-NEW", houseId: "HP-NEW", folderId: newCustomer.getId(), adminSessionToken: f.adminSessionToken };
  const created = f.context.createCustomerFolder_(request);
  assert.equal(created.ok, true);
  assert.equal(created.folderId, newCustomer.getId());
  assert.equal(foldersInitialized, 1);
  const deletion = { ...request, mutationId: "admin-delete-retry" };
  assert.equal(f.context.deleteCustomerFolder_(deletion).trashed, true);
  assert.throws(() => f.context.deleteCustomerFolder_({ ...deletion, adminSessionToken: undefined }), /Chỉ admin mới có quyền/);
  assert.equal(f.context.deleteCustomerFolder_(deletion).repeated, true);
  assert.equal(newCustomer.trashCalls, 1);
  assert.equal(f.target.trashCalls, 0);
});

test("exports, uploads and document/archive helpers cannot implicitly create another customer", () => {
  const f = customerMutationFixture();
  const absent = { year: 2026, month: 9, projectId: "GM-MISSING", houseId: "HP-MISSING", workflow: "Thiết kế", file: { fileName: "test.pdf", data: "AA==" } };
  const originalProperties = [...f.values];
  for (const operation of [
    () => f.context.getCustomerFolder_(2027, 1, "HP-MISSING", true),
    () => f.context.customerFolderForRecord_(absent, 2026, 9, true),
    () => f.context.exportCustomerWorkbook_(absent, 2026, 9),
    () => f.context.exportDesignProgressWorkbook_(absent, 2026, 9, "architecture"),
    () => f.context.exportWarrantyWorkbook_(absent, 2026, 9),
    () => f.context.uploadWorkflowFile_(absent),
    () => f.context.createWorkflowDateFolder_(absent),
    () => f.context.documentsFolderForPayload_(absent, true),
    () => f.context.workNotesFolder_(2026, 9, "GM-MISSING", true, "HP-MISSING"),
  ]) assert.throws(operation, /Chỉ admin mới có quyền tạo khách hàng/);
  assert.equal(f.context.getCustomerFolder_(2027, 1, "HP-MISSING", false), null);
  assert.equal(f.createdCount(), 0);
  assert.deepEqual([...f.values], originalProperties);
  let initialized = 0;
  f.context.ensureProjectFolders_ = (folder) => { assert.equal(folder, f.target); initialized += 1; };
  assert.equal(f.context.getCustomerFolder_(2026, 9, "HP-587", true), f.target);
  assert.equal(initialized, 1, "employees may still initialize subfolders for an existing customer");
});

test("customer Delete trashes only the resolved Drive folder and prunes only that period's cache", () => {
  const f = customerMutationFixture();
  const years = [{ year: 2026, months: [{ label: "T9", records: [
    { projectId: "GM-TARGET", houseId: "HP-587", driveFolderId: f.target.getId(), details: { HVT: "Target" } },
    { projectId: "GM-KEEP", houseId: "NT5-38", driveFolderId: f.keep.getId() },
  ] }, { label: "T8", records: [{ projectId: "GM-TARGET", houseId: "HP-587", driveFolderId: f.otherMonthTarget.getId() }] }] }];
  f.context.saveWorkspaceCache_({ updatedAt: 1, years });
  f.context.writePropertyJson_("gmcrm-active-work-notes-state", [{ id: "note-target", year: 2026, month: 9, projectId: "GM-TARGET" }, { id: "note-keep", year: 2026, month: 9, projectId: "GM-KEEP" }]);
  const oldCacheKey = f.context.driveScopedCacheKey_("gmcrm-index-2026-9");
  const result = f.context.deleteCustomerFolder_({ adminSessionToken: f.adminSessionToken, year: 2026, month: 9, projectId: "GM-TARGET", houseId: "HP-587", folderId: f.target.getId(), mutationId: "delete-target-001" });
  assert.equal(result.ok, true);
  assert.equal(result.trashed, true);
  assert.equal(result.folderId, f.target.getId());
  assert.equal(f.target.trashed, true);
  assert.equal(f.keep.trashed, false);
  assert.equal(f.otherMonthTarget.trashed, false);
  assert.equal(f.createdCount(), 0);
  assert.notEqual(f.context.driveScopedCacheKey_("gmcrm-index-2026-9"), oldCacheKey);
  const current = f.context.loadWorkspaceCache_().years[0].months;
  assert.deepEqual(Array.from(current[8].records, (record) => record.projectId), ["GM-KEEP"]);
  assert.equal(current[7].records.length, 1);
  assert.deepEqual(Array.from(f.context.readPropertyJson_("gmcrm-active-work-notes-state"), (note) => note.id), ["note-keep"]);
  f.context.saveWorkspaceCache_({ updatedAt: Date.now() + 1000, years });
  assert.equal(f.context.loadWorkspaceCache_().years[0].months[8].records.length, 1, "a newer stale-device save cannot resurrect a deleted folder");
  assert.equal(f.context.loadWorkNotes_({ year: 2026, month: 9, projectId: "GM-TARGET" }).notes.length, 0);
});

test("customer mutations do not create missing paths or delete ambiguous folder names", () => {
  const f = customerMutationFixture();
  assert.throws(() => f.context.deleteCustomerFolder_({ adminSessionToken: f.adminSessionToken, year: 2027, month: 9, projectId: "GM-TARGET", houseId: "HP-587" }), /thư mục tháng/);
  assert.throws(() => f.context.deleteCustomerFolder_({ adminSessionToken: f.adminSessionToken, year: 2026, month: 9, projectId: "GM-MISSING", houseId: "missing" }), /Không tìm thấy đúng/);
  const duplicate = f.makeFolder("hp-587", "duplicate-folder-id");
  f.month.children.push(duplicate);
  assert.throws(() => f.context.deleteCustomerFolder_({ adminSessionToken: f.adminSessionToken, year: 2026, month: 9, projectId: "GM-TARGET", houseId: "HP-587" }), /nhiều thư mục/);
  assert.equal(f.target.trashed, false);
  assert.equal(duplicate.trashed, false);
  assert.equal(f.createdCount(), 0);
  f.context.deleteCustomerFolder_({ adminSessionToken: f.adminSessionToken, year: 2026, month: 9, projectId: "GM-TARGET", houseId: "HP-587", folderId: f.target.getId() });
  assert.equal(f.target.trashed, true);
  assert.equal(duplicate.trashed, false, "the exact selected folder ID disambiguates duplicates");
});

test("a delete retry returns the original result without touching a replacement folder", () => {
  const f = customerMutationFixture();
  const request = { adminSessionToken: f.adminSessionToken, year: 2026, month: 9, projectId: "GM-TARGET", houseId: "HP-587", folderId: f.target.getId(), mutationId: "delete-retry-001" };
  const first = f.context.deleteCustomerFolder_(request);
  const replacement = f.makeFolder("HP-587", "replacement-folder-id");
  f.month.children.push(replacement);
  f.context.clearCustomerDriveDeletion_({ year: 2026, month: 9, projectId: "GM-NEW", houseId: "HP-587" });
  const repeated = f.context.deleteCustomerFolder_(request);
  assert.equal(repeated.folderId, first.folderId);
  assert.equal(repeated.repeated, true);
  assert.equal(f.target.trashCalls, 1);
  assert.equal(replacement.trashed, false);
  assert.equal(f.context.isCustomerDriveRecordDeleted_({ year: 2026, month: 9, projectId: "GM-NEW", houseId: "HP-587", driveFolderId: replacement.getId() }), false);
  assert.throws(() => f.context.deleteCustomerFolder_({ ...request, houseId: "NT5-38", folderId: f.keep.getId() }), /Mã yêu cầu đã được dùng/);
});

test("Rename preserves the project key, updates shared cache and rejects collisions before changing Drive", () => {
  const f = customerMutationFixture();
  f.context.saveWorkspaceCache_({ years: [{ year: 2026, months: [{ label: "T9", records: [{ projectId: "GM-TARGET", houseId: "HP-587", driveFolderId: f.target.getId(), name: "Chị An", details: { SDT: "0912345678" } }, { projectId: "GM-KEEP", houseId: "NT5-38", name: "Anh Bình" }] }] }] });
  const request = { year: 2026, month: 9, projectId: "GM-TARGET", oldHouseId: "HP-587", houseId: "HP-888", name: "Chị An mới", folderId: f.target.getId(), mutationId: "rename-target-001" };
  assert.throws(() => f.context.renameCustomerFolder_({ ...request, houseId: "NT5-38" }), /Mã nhà đã tồn tại/);
  assert.equal(f.target.getName(), "HP-587");
  const result = f.context.renameCustomerFolder_(request);
  assert.equal(result.projectId, "GM-TARGET");
  assert.equal(f.target.getName(), "HP-888");
  const records = f.context.loadWorkspaceCache_().years[0].months[8].records;
  assert.equal(records[0].projectId, "GM-TARGET");
  assert.equal(records[0].name, "Chị An mới");
  assert.equal(records[0].houseId, "HP-888");
  assert.equal(records[0].details.SDT, "0912345678");
  assert.equal(records[1].name, "Anh Bình");
  assert.equal(f.context.renameCustomerFolder_(request).repeated, true);
  assert.throws(() => f.context.renameCustomerFolder_({ ...request, houseId: "HP-999" }), /Mã yêu cầu đã được dùng/);
  const withoutId = { ...request, mutationId: undefined };
  assert.equal(f.context.renameCustomerFolder_(withoutId).folderId, f.target.getId(), "legacy transport retry only reuses a confirmed prior renamed folder");
});

test("exact folder identities prevent stale rename aliases from changing an unrelated newly created house", () => {
  const f = customerMutationFixture();
  f.context.renameCustomerFolder_({ year: 2026, month: 9, projectId: "GM-TARGET", oldHouseId: "HP-587", houseId: "HP-888" });
  f.context.clearCustomerDriveDeletion_({ year: 2026, month: 9, projectId: "GM-NEW", houseId: "HP-587" });
  const years = [{ year: 2026, months: [{ label: "T9", records: [{ projectId: "GM-NEW", houseId: "HP-587", driveFolderId: "new-folder-id" }, { projectId: "GM-TARGET", houseId: "HP-587", driveFolderId: f.target.getId() }] }] }];
  const records = f.context.applyCustomerDriveMutations_(years)[0].months[0].records;
  assert.equal(records[0].projectId, "GM-NEW");
  assert.equal(records[0].houseId, "HP-587");
  assert.equal(records[1].houseId, "HP-888");
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
  const { context, adminSessionToken } = customerMutationFixture();
  context.DriveApp = { getFolderById: () => { throw new Error("ordinary cache edits must not read Drive"); } };
  const years = [{ year: 2026, months: [{ label: "T9", records: [{ projectId: "GM03092026TEST", details: { HVT: "Khách thử" }, designProgress: [] }] }] }];
  assert.equal(context.saveWorkspaceCache_({ updatedAt: 100, years, adminSessionToken }).ok, true);
  years[0].months[0].records[0].details.HVT = "Khách đã sửa";
  assert.equal(context.saveWorkspaceCache_({ updatedAt: 101, years }).ok, true);
  const expected = [{ year: 2026, months: Array.from({ length: 12 }, (_, index) => index === 8 ? years[0].months[0] : { label: `T${index + 1}`, records: [] }) }];
  assert.deepEqual(JSON.parse(JSON.stringify(context.loadWorkspaceCache_({}).years)), expected);
  assert.equal(context.saveWorkspaceCache_({ updatedAt: 90, years: [] }).ignored, true);
  assert.deepEqual(JSON.parse(JSON.stringify(context.loadWorkspaceCache_({}).years)), expected);
});

test("employees cannot create invented customers through shared-cache writes, even while editing a known customer", () => {
  const f = customerMutationFixture();
  const existing = { projectId: "GM-TARGET", houseId: "HP-587", driveFolderId: f.target.getId(), details: { HVT: "Original" } };
  const period = (records) => [{ year: 2026, months: [{ label: "T9", records }] }];
  f.context.saveWorkspaceCache_({ updatedAt: 10, years: period([existing]), adminSessionToken: f.adminSessionToken });
  const before = [...f.values];
  for (const forgedIdentity of [{}, { actorEmail: "admin", account: "admin", role: "Quản lý chung" }]) {
    assert.throws(() => f.context.saveWorkspaceCache_({ updatedAt: 11, ...forgedIdentity, years: period([{ ...existing, details: { HVT: "Should not save" } }, { projectId: "GM-INVENTED", houseId: "HP-NONEXISTENT" }]) }), /Chỉ admin mới có quyền tạo khách hàng/);
    assert.deepEqual([...f.values], before, "a denied addition does not partially save accompanying edits");
  }
  assert.equal(f.createdCount(), 0);
  assert.equal(f.target.trashCalls, 0);
});

test("employees may hydrate customers already on Drive using one scoped folder scan per month", () => {
  const f = customerMutationFixture();
  const originalFolders = f.month.getFolders;
  let monthScans = 0;
  f.month.getFolders = function() { monthScans += 1; return originalFolders.call(this); };
  const years = [{ year: 2026, months: [{ label: "T9", records: [{ projectId: "GM-TARGET", houseId: "HP-587" }, { projectId: "GM-KEEP", houseId: "NT5-38" }] }] }];
  assert.equal(f.context.saveWorkspaceCache_({ updatedAt: 10, years }).ok, true);
  const saved = f.context.loadWorkspaceCache_().years[0].months[8].records;
  assert.deepEqual(Array.from(saved, (record) => record.driveFolderId), [f.target.getId(), f.keep.getId()]);
  assert.equal(monthScans, 1);
  assert.equal(f.createdCount(), 0);
  const before = [...f.values];
  const alias = { projectId: "GM-ALIAS", houseId: "HP-587", driveFolderId: f.target.getId() };
  assert.throws(() => f.context.saveWorkspaceCache_({ updatedAt: 11, years: [{ year: 2026, months: [{ label: "T9", records: [...saved, alias] }] }] }), /Không thể tạo bản trùng/);
  assert.deepEqual([...f.values], before);
});

test("legacy customers without a folder ID cannot be duplicated and may hydrate only their existing Drive identity", () => {
  const f = customerMutationFixture();
  const legacy = { projectId: "GM-LEGACY", houseId: "HP-587" };
  const period = (records) => [{ year: 2026, months: [{ label: "T9", records }] }];
  f.context.saveWorkspaceCache_({ updatedAt: 10, years: period([legacy]), adminSessionToken: f.adminSessionToken });
  const before = [...f.values];
  assert.throws(() => f.context.saveWorkspaceCache_({ updatedAt: 11, years: period([legacy, { projectId: "GM-ALIAS", houseId: "HP-587" }]) }), /Không thể tạo bản trùng/);
  assert.deepEqual([...f.values], before);
  assert.equal(f.context.saveWorkspaceCache_({ updatedAt: 11, years: period([{ ...legacy, driveFolderId: f.target.getId() }]) }).ok, true);
  assert.equal(f.context.loadWorkspaceCache_().years[0].months[8].records[0].driveFolderId, f.target.getId());
});

test("employees cannot erase a customer by falsifying its Drive identity before omitting it", () => {
  const f = customerMutationFixture();
  const existing = { projectId: "GM-TARGET", houseId: "HP-587", driveFolderId: f.target.getId() };
  const period = (records) => [{ year: 2026, months: [{ label: "T9", records }] }];
  f.context.saveWorkspaceCache_({ updatedAt: 10, years: period([existing]), adminSessionToken: f.adminSessionToken });
  const before = [...f.values];
  for (const patch of [{ driveFolderId: "nonexistent-id" }, { houseId: "HP-MISSING" }, { houseId: "NT5-38", driveFolderId: f.keep.getId() }]) {
    assert.throws(() => f.context.saveWorkspaceCache_({ updatedAt: 11, years: period([{ ...existing, ...patch }]) }), /Không thể thay đổi định danh/);
    assert.deepEqual([...f.values], before);
  }
  f.context.saveWorkspaceCache_({ updatedAt: 11, years: [] });
  assert.equal(f.context.loadWorkspaceCache_().years[0].months[8].records.length, 1);
  assert.throws(() => f.context.saveWorkspaceCache_({ updatedAt: 12, years: period([{ projectId: "GM-WRONG-PERIOD", houseId: "HP-587", driveFolderId: f.otherMonthTarget.getId() }]) }), /Chỉ admin mới có quyền tạo khách hàng/);
  assert.equal(f.createdCount(), 0);
});

test("omitting customers from an employee cache save cannot delete them, while confirmed external Drive deletion can be reconciled", () => {
  const f = customerMutationFixture();
  const target = { projectId: "GM-TARGET", houseId: "HP-587", driveFolderId: f.target.getId() };
  const keep = { projectId: "GM-KEEP", houseId: "NT5-38", driveFolderId: f.keep.getId(), details: { HVT: "Original" } };
  const period = (records) => [{ year: 2026, months: [{ label: "T9", records }] }];
  f.context.saveWorkspaceCache_({ updatedAt: 10, years: period([target, keep]), adminSessionToken: f.adminSessionToken });
  f.context.saveWorkspaceCache_({ updatedAt: 11, years: period([{ ...keep, details: { HVT: "Edited" } }]) });
  let saved = f.context.loadWorkspaceCache_().years[0].months[8].records;
  assert.equal(saved.length, 2);
  assert.equal(saved.find((record) => record.projectId === keep.projectId).details.HVT, "Edited");
  f.target.setName("HP-587-renamed-on-drive");
  f.context.saveWorkspaceCache_({ updatedAt: 12, years: period([keep]) });
  assert.equal(f.context.loadWorkspaceCache_().years[0].months[8].records.length, 2, "a folder rename is not a deletion");
  f.target.setTrashed(true);
  f.context.saveWorkspaceCache_({ updatedAt: 13, years: period([keep]) });
  saved = f.context.loadWorkspaceCache_().years[0].months[8].records;
  assert.deepEqual(Array.from(saved, (record) => record.projectId), [keep.projectId]);
});

test("admin optimistic cache creates survive parallel omissions and failed Drive reads never prove deletion", () => {
  const f = customerMutationFixture();
  const pending = { projectId: "GM-PENDING", houseId: "HP-PENDING", pendingDriveSync: true };
  const existing = { projectId: "GM-TARGET", houseId: "HP-587", driveFolderId: f.target.getId() };
  const period = (records) => [{ year: 2026, months: [{ label: "T9", records }] }];
  f.context.DriveApp = { getFolderById: () => { throw new Error("Drive temporarily unavailable"); } };
  f.context.saveWorkspaceCache_({ updatedAt: 10, years: period([pending, existing]), adminSessionToken: f.adminSessionToken });
  f.context.saveWorkspaceCache_({ updatedAt: 11, years: [] });
  const retainedYear = f.context.loadWorkspaceCache_().years[0];
  assert.equal(retainedYear.months.length, 12);
  assert.deepEqual(Array.from(retainedYear.months, (month) => month.label), Array.from({ length: 12 }, (_, index) => `T${index + 1}`));
  assert.deepEqual(Array.from(retainedYear.months[8].records, (record) => record.projectId), [pending.projectId, existing.projectId]);
  const before = [...f.values];
  assert.throws(() => f.context.saveWorkspaceCache_({ updatedAt: 12, years: period([pending, existing]), adminSessionToken: "forged" }), /Chỉ admin mới có quyền/);
  assert.deepEqual([...f.values], before);
});

test("cache reconciliation keeps canonical month indexes for sparse, shuffled and wholly omitted years", () => {
  const f = customerMutationFixture();
  const years = [{ year: 2026, customYear: "preserve", months: [
    { label: "T9", customMonth: "September", records: [{ projectId: "GM-PENDING-SEP", pendingDriveSync: true }] },
    { label: "T2", customMonth: "February", records: [{ projectId: "GM-PENDING-FEB", pendingDriveSync: true }] },
  ] }];
  f.context.saveWorkspaceCache_({ updatedAt: 10, years, adminSessionToken: f.adminSessionToken });
  f.context.saveWorkspaceCache_({ updatedAt: 11, years: [] });
  const retained = f.context.loadWorkspaceCache_().years[0];
  assert.equal(retained.customYear, "preserve");
  assert.equal(retained.months.length, 12);
  assert.deepEqual(Array.from(retained.months, (month) => month.label), Array.from({ length: 12 }, (_, index) => `T${index + 1}`));
  assert.equal(retained.months[1].customMonth, "February");
  assert.equal(retained.months[1].records[0].projectId, "GM-PENDING-FEB");
  assert.equal(retained.months[8].customMonth, "September");
  assert.equal(retained.months[8].records[0].projectId, "GM-PENDING-SEP");
});

test("personnel cache is shared without touching Drive", () => {
  const values = new Map();
  const properties = {
    getProperty: (key) => values.get(key) || null,
    setProperty: (key, value) => values.set(key, String(value)),
    deleteProperty: (key) => values.delete(key),
  };
  const personnel = {
    management: [{ id: "person-1", status: "Có", name: "Nguyễn An", email: "", permissions: [] }],
    office: [{ id: "person-2", status: "Có", name: "Trần Bình", email: "binh@example.com", permissions: ["Ghi chú"] }],
  };
  const context = loadContext({
    PropertiesService: { getScriptProperties: () => properties },
    DriveApp: { getFolderById: () => { throw new Error("Drive must not be read when personnel cache exists."); } },
  });
  assert.equal(context.savePersonnelCache_(personnel).ok, true);
  const loaded = context.loadPersonnel_({});
  assert.equal(loaded.source, "script-properties");
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.personnel)), personnel);
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

test("configured Zalo group names bypass the GM group-name rule", () => {
  const context = loadContext();
  const targets = {
    "hp587": { houseId: "HP-587", customerName: "Nguyễn Tùng", zaloGroupName: "Nhà HP-587 - Zalo" },
  };
  assert.equal(context.pancakeTargetForGroupName_(targets, "Nhà HP-587 - Zalo").houseId, "HP-587");
  assert.equal(context.pancakeTargetForGroupName_(targets, "Nha HP-587 - Zalo").houseId, "HP-587");
  assert.equal(context.pancakeTargetForGroupName_(targets, "Nhà khác"), null);
});

test("only conversations containing Bùi Đức Thành are allowed as a Pancake test exception", () => {
  const context = loadContext();
  assert.equal(context.pancakeIsSpecialTestConversation_("Bùi Đức Thành"), true);
  assert.equal(context.pancakeIsSpecialTestConversation_("Bùi Đức Thành - GM"), true);
  assert.equal(context.pancakeIsSpecialTestConversation_("Nhóm Bùi Đức Thành"), true);
  assert.equal(context.pancakeIsSpecialTestConversation_("bc thi công dv 75 - GM"), false);
  const target = context.pancakeSpecialTestTarget_({});
  assert.deepEqual(JSON.parse(JSON.stringify(target)), {
    houseId: "Bùi Đức Thành",
    projectId: "",
    customerName: "Bùi Đức Thành",
    year: target.year,
    month: target.month,
  });
});

test("customer message statuses expose only Chưa xem, Đang xử lý and Đã hoàn thành", () => {
  const context = loadContext();
  assert.equal(context.normalizePancakeMessageStatus_("deferred"), "new");
  assert.equal(context.normalizePancakeMessageStatus_("Chưa xem"), "new");
  assert.equal(context.normalizePancakeMessageStatus_("Đang xử lý"), "processing");
  assert.equal(context.normalizePancakeMessageStatus_("Đã hoàn thành"), "resolved");
});

test("message export rows keep one date and one content column per customer message", () => {
  const context = loadContext({ Utilities: { formatDate: () => "07/09/2026 09:00:00" } });
  const rows = context.pancakeMessageExportRows_({ messages: [
    { senderName: "Bùi Đức Thành", content: "Xin chào", sentAt: "2026-09-07T02:00:00.000Z" },
    { senderName: "", content: "", sentAt: "2026-09-07T02:01:00.000Z" },
  ] });
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [["07/09/2026 09:00:00", "Bùi Đức Thành: Xin chào"]]);
});

test("completed normal groups export once while Bùi Đức Thành stays a test-only exception", () => {
  const context = loadContext();
  let states = [];
  let exports = 0;
  context.readPancakeMessageStates_ = () => states;
  context.savePancakeMessageStates_ = (next) => { states = next; };
  context.appendPancakeMessageWorkbook_ = () => { exports += 1; };
  const normal = { id: "normal-group", groupName: "HP-587-GM-Tư vấn", houseId: "HP-587", customerName: "Nguyễn Tùng", year: 2026, month: 9, messages: [] };
  const testOnly = { id: "test-group", groupName: "Bùi Đức Thành", houseId: "Bùi Đức Thành", customerName: "Bùi Đức Thành", year: 2026, month: 9, messages: [] };
  assert.equal(context.updateCustomerMessageStatus_({ message: normal, status: "resolved" }).exported, true);
  assert.equal(exports, 1);
  assert.equal(context.updateCustomerMessageStatus_({ message: normal, status: "resolved" }).exported, false);
  assert.equal(exports, 1);
  assert.equal(context.updateCustomerMessageStatus_({ message: testOnly, status: "resolved" }).exported, false);
  assert.equal(exports, 1);
});

test("Pancake customer messages use fixed two-hour windows from the first message rather than extending after every message", () => {
  const context = loadContext();
  const groups = context.groupPancakeMessages_(
    { id: "conversation-1", from: { name: "HP-587-GM-Tư vấn" }, page_customer: { name: "Nguyễn Tùng" } },
    [
      { id: "m-2", text: "Tin thứ hai", inserted_at: "2026-09-03T10:20:00.000Z", from: { name: "Nguyễn Tùng" } },
      { id: "m-1", text: "Tin thứ nhất", inserted_at: "2026-09-03T09:00:00.000Z", from: { name: "Nguyễn Tùng" } },
      { id: "m-3", text: "Tin sau cửa sổ đầu tiên", inserted_at: "2026-09-03T12:20:00.000Z", from: { name: "Nguyễn Tùng" } },
      { id: "m-4", text: "Tin mới", inserted_at: "2026-09-03T14:20:01.000Z", from: { name: "Nguyễn Tùng" } },
    ],
    { houseId: "HP-587", projectId: "GM09092026NT", customerName: "Nguyễn Tùng", year: 2026, month: 9 },
  );
  assert.equal(groups.length, 3);
  assert.equal(groups[0].messageCount, 2);
  assert.equal(groups[0].messages[0].content, "Tin thứ nhất");
  assert.equal(groups[1].messages[0].content, "Tin sau cửa sổ đầu tiên");
  assert.equal(groups[2].messages[0].content, "Tin mới");
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

test("employee name and roster login code authenticate without account registration", () => {
  const context = loadContext();
  context.loadPersonnel_ = () => ({ personnel: { office: [{ id: "person-1", name: "Nguyễn Minh Anh", email: "anh@company.com", loginCode: "001234", status: "Có", permissions: ["Ghi chú"], role: "Nhân viên thiết kế" }] } });
  const result = context.verifyEmployeeLogin_({ name: "  NGUYỄN  MINH ANH  ".normalize("NFD"), loginCode: "001234" });
  assert.equal(result.valid, true);
  assert.equal(result.account, "anh@company.com");
  assert.equal(result.member.id, "person-1");
  assert.equal(Object.hasOwn(result.member, "loginCode"), false);
  assert.equal(context.verifyEmployeeLogin_({ name: "Nguyen Minh Anh", loginCode: "001234" }).valid, false);
  assert.equal(context.verifyEmployeeLogin_({ name: "Nguyễn Minh", loginCode: "001234" }).valid, false);
  assert.equal(context.verifyEmployeeLogin_({ name: "Nguyễn Minh Anh", loginCode: "1234" }).valid, false);
});

test("inactive and ambiguous name/code pairs cannot log in", () => {
  const context = loadContext();
  const active = { id: "active", name: "Trần Bình", loginCode: "code-1", status: "Có", email: "binh@company.com" };
  const paused = { id: "paused", name: "Lê An", loginCode: "code-2", status: "Ngưng" };
  let members = [active, paused];
  context.loadPersonnel_ = () => ({ personnel: { office: members } });
  assert.equal(context.verifyEmployeeLogin_({ name: "Lê An", loginCode: "code-2" }).valid, false);
  assert.equal(context.verifyEmployeeLogin_({ name: "Trần Bình", loginCode: "" }).valid, false);
  members = [active, { ...active, id: "duplicate", email: "other@company.com" }];
  assert.equal(context.verifyEmployeeLogin_({ name: "Trần Bình", loginCode: "code-1" }).valid, false);
});

test("roster login preserves assignment identity for employees without email", () => {
  const context = loadContext();
  const member = { id: "staff-no-email", name: "Lê An", loginCode: "0", status: "Có", email: "" };
  context.loadPersonnel_ = () => ({ personnel: { site: [member] } });
  const result = context.verifyEmployeeLogin_({ name: "Lê An", loginCode: "0" });
  assert.equal(result.valid, true);
  assert.equal(result.account, "member:staff-no-email");
  assert.equal(context.employeeRosterMember_(result.account).id, member.id);
  assert.equal(context.assignmentMatchesEmployee_("member:staff-no-email", result.account, member), true);
});

test("personnel cache preserves login-code leading zeros without reading Drive", () => {
  const values = new Map();
  const context = loadContext({ PropertiesService: { getScriptProperties: () => ({ getProperty: key => values.get(key), setProperty: (key, value) => values.set(key, value), deleteProperty: key => values.delete(key) }) } });
  context.savePersonnelCache_({ office: [{ id: "staff-1", name: "Nguyễn An", loginCode: " 00123 " }] });
  assert.equal(context.loadPersonnel_().personnel.office[0].loginCode, "00123");
});

test("personnel Excel export and import round-trip the login-code column as text", () => {
  let exportedRows;
  const numberFormats = [];
  const hidden = [];
  const range = { setValues(value) { exportedRows = value; return this; }, setFontFamily() { return this; }, setWrap() { return this; }, setVerticalAlignment() { return this; }, setFontWeight() { return this; }, setBackground() { return this; }, setNumberFormat() { return this; } };
  const sheet = { setName() {}, getRange(row, column, rows, columns) { if (row === 2) numberFormats.push(column); return range; }, setFrozenRows() {}, setColumnWidth() {}, hideColumns(column) { hidden.push(column); }, autoResizeRows() {}, getLastRow: () => exportedRows.length };
  const context = loadContext({ SpreadsheetApp: { create: () => ({ getSheets: () => [sheet], getId: () => "temporary" }) }, DriveApp: { getFileById: () => ({ setTrashed() {} }) } });
  context.personnelFolder_ = () => ({ getFilesByName: () => iterator([]), createFile: () => ({ getId: () => "exported", getUrl: () => "file-url" }) });
  context.trashFilesByName_ = () => {};
  context.exportXlsx_ = () => ({ setName() { return this; } });
  context.syncPersonnelWorkbook_({ office: [{ id: "p1", name: "Nguyễn An", email: "an@example.com", loginCode: "00123", permissions: [], phone: "0912345678" }] });
  assert.equal(exportedRows[0][5], "Mã đăng nhập");
  assert.equal(exportedRows[1][5], "00123");
  assert.ok(numberFormats.includes(6));
  assert.ok(numberFormats.includes(8));
  assert.ok(hidden.includes(12));
  context.readXlsxSheets_ = () => ({ "Nhân lực": exportedRows });
  assert.equal(context.personnelFromWorkbook_({}).office[0].loginCode, "00123");
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
