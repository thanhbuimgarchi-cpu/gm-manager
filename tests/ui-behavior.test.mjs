import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transform } from "esbuild";

// Execute the real frontend helpers without mounting React or contacting the
// production backend. This protects data behavior during interface changes.
const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const workflowSource = await readFile(new URL("../app/workflow-client.ts", import.meta.url), "utf8");
const workflowCode = await transform(workflowSource, { loader: "ts", format: "cjs" });
const workflowExports = {};
const workflowContext = vm.createContext({ module: { exports: workflowExports }, exports: workflowExports, console, Date, Intl, URL, Set, Map });
vm.runInContext(workflowCode.code, workflowContext);
const { code } = await transform(`${source}\nexport { uniqueCustomerProjectId, compareOutstandingWorkNotes, mergeWorkNotesForSync, reconcileWorkNoteEdit, parseDesignDate, saveWorkspace, employeeByLoginCode, verifyBrowserWorkspace, browserWorkspaceAtPath, mobileFileOpenUrl, customerRecordsAfterDriveMutation, customerDriveMutationError, normalizeDesignProgress, mergeSharedWorkspaceYears, mergeWorkflowDesignRows, normalizePersonnelRole, isPersonnelManager, normalizePersonnelMap };`, {
  loader: "tsx",
  format: "cjs",
  define: { "import.meta.env": JSON.stringify({ VITE_APP_VERSION: "test", BASE_URL: "/" }) },
});
const exports = {};
const context = vm.createContext({ module: { exports }, exports, require: (name) => name === "./workflow-client" ? workflowContext.module.exports : {}, console, Date, Intl, URL, Set, Map });
vm.runInContext(code, context);
const helpers = context.module.exports;

const note = (id, overrides = {}) => ({
  id, priority: "Bình thường", dueDate: "30/10/2026", assigneeEmail: "first@example.com",
  acceptedAt: "", acceptedBy: "", actualDate: "", completedAt: "", ...overrides,
});

test("same-day customers with the same initials receive distinct project keys", () => {
  const base = "GM28102026NVA";
  assert.equal(helpers.uniqueCustomerProjectId(base, []), base);
  assert.equal(helpers.uniqueCustomerProjectId(base, [{ projectId: base }, { projectId: `${base}-2` }]), `${base}-3`);
});

test("outstanding work prioritizes immediate, urgent, then normal before due dates", () => {
  const notes = [note("normal", { dueDate: "29/10/2026" }), note("urgent", { priority: "Gấp", dueDate: "30/10/2026" }), note("immediate", { priority: "Cần lập tức", dueDate: "05/11/2026" })];
  assert.deepEqual(notes.sort(helpers.compareOutstandingWorkNotes).map((item) => item.id), ["immediate", "urgent", "normal"]);
  assert.ok(helpers.compareOutstandingWorkNotes(note("early"), note("later", { dueDate: "31/10/2026" })) < 0);
});

test("accepting an employee assignment preserves notes assigned to colleagues", () => {
  const mine = note("mine");
  const colleague = note("colleague", { assigneeEmail: "second@example.com" });
  const accepted = { ...mine, acceptedAt: "2026-10-28T02:00:00Z" };
  const merged = helpers.mergeWorkNotesForSync([mine, colleague], [accepted], new Set());
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.id === "mine").acceptedAt, accepted.acceptedAt);
  assert.equal(merged.find((item) => item.id === "colleague").assigneeEmail, colleague.assigneeEmail);
});

test("stale server reads cannot resurrect a locally deleted work note", () => {
  const merged = helpers.mergeWorkNotesForSync([note("deleted"), note("kept")], [], new Set(["deleted"]));
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "kept");
});

test("reassigning a note requires the new assignee to accept and complete it", () => {
  const original = note("task", { acceptedAt: "2026-10-28T02:00:00Z", acceptedBy: "first@example.com", actualDate: "28/10/2026", completedAt: "2026-10-28T03:00:00Z" });
  const updated = helpers.reconcileWorkNoteEdit(original, { ...original, assigneeEmail: "second@example.com" });
  assert.equal(updated.status, "Đen");
  assert.equal(updated.acceptedAt, "");
  assert.equal(updated.actualDate, "");
  assert.equal(updated.completedAt, "");
  assert.equal(helpers.reconcileWorkNoteEdit(original, { ...original, content: "Updated detail" }).acceptedAt, original.acceptedAt);
});

test("date validation rejects impossible dates while accepting leap years", () => {
  assert.equal(helpers.parseDesignDate("31/02/2026"), null);
  assert.equal(helpers.parseDesignDate("29/02/2025"), null);
  assert.ok(helpers.parseDesignDate("29/02/2028"));
});

test("a full browser cache does not abort the active workspace operation", () => {
  context.window = { localStorage: { setItem() { throw new Error("quota exceeded"); } } };
  assert.doesNotThrow(() => helpers.saveWorkspace([]));
});

test("roster login matches the full accented name and an exact code, rejecting ambiguous/inactive rows", () => {
  const member = { id: "p1", name: "Nguyễn Minh Anh", loginCode: "00123", status: "Có" };
  assert.equal(helpers.employeeByLoginCode([member], "  NGUYỄN   MINH ANH ", "00123"), member);
  assert.equal(helpers.employeeByLoginCode([member], "Nguyen Minh Anh", "00123"), null);
  assert.equal(helpers.employeeByLoginCode([member], member.name, "123"), null);
  assert.equal(helpers.employeeByLoginCode([member, {...member,id:"p2"}], member.name, member.loginCode), null);
  assert.equal(helpers.employeeByLoginCode([{...member,status:"Ngưng"}], member.name, member.loginCode), null);
});

test("manager titles survive cached roster normalization without granting similarly named staff access", () => {
  for (const role of ["Quản lý chung", "Quản lý", "  QUẢN   LÝ  CHUNG ", "Quản lý".normalize("NFD")]) {
    const member = { id: "manager", name: "Quản lý kiểm thử", role, status: "Có", permissions: [] };
    assert.equal(helpers.normalizePersonnelRole(role), "Quản lý chung");
    assert.equal(helpers.isPersonnelManager(member), true);
    assert.equal(helpers.normalizePersonnelMap({ office: [member] }).office[0].role, "Quản lý chung");
  }
  for (const role of ["Giám sát", "Nhân viên văn phòng", "Nhân viên quản lý", "Quản lý kỹ thuật", "", null]) assert.equal(helpers.isPersonnelManager({ role }), false);
  assert.equal(helpers.isPersonnelManager(null), false);
});

test("browser folder validation prefers a complete workspace, then accepts a shared Customers folder", async () => {
  const directory = (name, children = {}) => ({name, async getDirectoryHandle(child){if(!children[child])throw new Error("not found");return children[child];}});
  const sharedCustomers = directory("Khách hàng");
  const partial = directory("GM Manager", { "Khách hàng": sharedCustomers });
  const valid = directory("GM Manager", {"Khách hàng":directory("Khách hàng"),"Nhân lực":directory("Nhân lực")});
  const outer = directory("I", {"Khách hàng":sharedCustomers,"Shared drives":directory("Shared drives", {"GM Manager":directory("GM Manager", {"GM Manager":valid})})});
  assert.equal(await helpers.verifyBrowserWorkspace(outer),valid);
  assert.equal(await helpers.verifyBrowserWorkspace(partial),sharedCustomers);
  await assert.rejects(helpers.verifyBrowserWorkspace(directory("Empty")), /GM Manager hoặc Khách hàng/);
});

test("browser drive selection discovers nested workspaces and accepts an authorized Customers handle", async () => {
  const directory = (name, children = {}) => ({ name, kind: "directory", async getDirectoryHandle(child) { if (!children[child]) throw new Error("not found"); return children[child]; }, async *values() { yield* Object.values(children); } });
  const customers = directory("Khách hàng", { "2026": directory("2026") });
  const workspace = directory("GM Manager", { "Khách hàng": customers, "Nhân lực": directory("Nhân lực") });
  const drive = directory("I", { "Company": directory("Company", { "Project data": directory("Project data", { "GM Manager": workspace }) }) });
  assert.equal(await helpers.verifyBrowserWorkspace(drive), workspace);
  assert.equal(await helpers.verifyBrowserWorkspace(customers), customers);
  assert.equal(await helpers.browserWorkspaceAtPath(drive, "I:\\Company\\Project data\\GM Manager\\Khách hàng"), customers);
  assert.equal(await helpers.browserWorkspaceAtPath(workspace, "I:\\Shared drives\\GM Manager\\GM Manager\\Khách hàng\\2026"), customers);
  assert.equal(await helpers.browserWorkspaceAtPath(drive, "I:"), workspace);
  await assert.rejects(helpers.browserWorkspaceAtPath(workspace, "I:\\Private\\other-workspace"), /vị trí đã cấp quyền/);
  await assert.rejects(helpers.browserWorkspaceAtPath(workspace, "..\\other-workspace"), /không hợp lệ/);
});

test("browser drive selection finds Customers below a shared container and avoids ambiguous matches", async () => {
  const directory = (name, children = {}) => ({ name, kind: "directory", async getDirectoryHandle(child) { if (!children[child]) throw new Error("not found"); return children[child]; }, async *values() { yield* Object.values(children); } });
  const customers = directory("Khách hàng", { "2026": directory("2026") });
  const container = directory("Dự án chia sẻ", { "Khách hàng": customers });
  const shared = directory("Shared drives", { "Dự án chia sẻ": container });
  const drive = directory("I", { "Shared drives": shared });
  assert.equal(await helpers.verifyBrowserWorkspace(drive), customers);
  assert.equal(await helpers.browserWorkspaceAtPath(drive, "I:\\Shared drives\\Dự án chia sẻ"), customers);
  assert.equal(await helpers.browserWorkspaceAtPath(drive, "I:\\Shared drives\\Dự án chia sẻ\\Khách hàng\\2026"), customers);
  const alternate = directory("Dự án khác", { "Khách hàng": directory("Khách hàng") });
  const ambiguous = directory("I", { "Dự án chia sẻ": container, "Dự án khác": alternate });
  await assert.rejects(helpers.verifyBrowserWorkspace(ambiguous), /nhiều thư mục Khách hàng/);
  assert.equal(await helpers.browserWorkspaceAtPath(ambiguous, "I:\\Dự án chia sẻ"), customers);
  const nearest = directory("I", { "Khách hàng": customers, "Dự án khác": alternate });
  assert.equal(await helpers.verifyBrowserWorkspace(nearest), customers);
});

test("mobile document opening uses the correct PDF/Office MIME with a browser fallback", () => {
  for(const [ext,type] of [["pdf","application/pdf"],["docx","application/vnd.openxmlformats-officedocument.wordprocessingml.document"],["xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]]) {
    const file={name:`document.${ext}`,downloadUrl:"https://drive.google.com/uc?id=test&export=download",mimeType:type};
    const android=helpers.mobileFileOpenUrl(file,"Android");
    assert.ok(android.startsWith("intent://"));
    assert.ok(android.includes(`type=${type};`));
    assert.ok(android.includes(`S.browser_fallback_url=${encodeURIComponent(file.downloadUrl)}`));
    assert.equal(helpers.mobileFileOpenUrl(file,"iPhone"),file.downloadUrl);
  }
  assert.equal(helpers.mobileFileOpenUrl({name:"bad.pdf",downloadUrl:"javascript:alert(1)",mimeType:"application/pdf"},"Android"),"");
});

test("confirmed customer mutations affect only the selected project and month", () => {
  const target={record:{id:"one",projectId:"project-one",houseId:"DV-75",name:"Quỳnh"},year:2026,month:8};
  const other={id:"two",projectId:"project-two",houseId:"TLA-871",name:"Tùng"};
  const years=[{year:2026,months:Array.from({length:12},(_,index)=>({label:`T${index+1}`,records:index===7?[target.record,other]:index===8?[target.record]:[]}))}];
  const renamed=helpers.customerRecordsAfterDriveMutation(years,target,{name:"Quỳnh",houseId:"DV-76",driveFolderId:"drive-folder"});
  assert.equal(renamed[0].months[7].records[0].houseId,"DV-76");
  assert.equal(renamed[0].months[7].records[0].projectId,"project-one");
  assert.equal(renamed[0].months[8].records[0].houseId,"DV-75");
  const removed=helpers.customerRecordsAfterDriveMutation(years,target);
  assert.equal(removed[0].months[7].records.length,1);
  assert.equal(removed[0].months[7].records[0].projectId,"project-two");
  assert.equal(removed[0].months[8].records.length,1);
  assert.equal(years[0].months[7].records.length,2);
});

test("legacy mutation-handler validation explains the deployment mismatch instead of blaming the customer", () => {
  const deletion = helpers.customerDriveMutationError(new Error("Thiếu dữ liệu hồ sơ."), "delete");
  assert.match(deletion, /phiên bản cũ, chưa hỗ trợ xóa thư mục Drive/);
  assert.match(deletion, /hoàn tất ủy quyền Google và triển khai phiên bản mới/);
  assert.match(deletion, /Hồ sơ trên web được giữ nguyên/);
  const rename = helpers.customerDriveMutationError("Error: Thiếu dữ liệu hồ sơ.", "rename");
  assert.match(rename, /chưa hỗ trợ đổi tên thư mục Drive/);
  assert.equal(helpers.customerDriveMutationError(new Error("Access denied: DriveApp."), "delete"), "Access denied: DriveApp.");
  assert.equal(helpers.customerDriveMutationError(new Error("Thiếu mã hồ sơ cần xóa."), "delete"), "Thiếu mã hồ sơ cần xóa.");
  assert.equal(helpers.customerDriveMutationError("Thiếu dữ liệu hồ sơ khi nhập công việc", "delete"), "Thiếu dữ liệu hồ sơ khi nhập công việc");
});

test("design normalization retains canonical revision, creator, archive and unsent-assignment metadata", () => {
  const row = { id: "design-metadata", isCustom: true, content: "Duyệt hồ sơ", plannedDate: "30/10/2026", actualDate: "28/10/2026", assignee: "Anh", assigneeEmail: "anh@example.com", publishedAt: "2026-10-28T01:00:00Z", revision: 9, creatorEmail: "manager@example.com", creatorName: "Quản lý", completedAt: "2026-10-28T04:00:00Z", archivedAt: "2026-10-28T04:01:00Z", archivePending: false, assignmentDirty: true };
  for (const [kind, field] of [["architecture", "designProgress"], ["interior", "interiorDesignProgress"], ["acceptance", "acceptanceDesignProgress"]]) {
    const normalized = helpers.normalizeDesignProgress({ [field]: [row] }, kind).find((item) => item.id === row.id);
    for (const key of ["revision", "creatorEmail", "creatorName", "completedAt", "archivedAt", "archivePending", "assignmentDirty"]) assert.equal(normalized[key], row[key], `${kind} preserves ${key}`);
    assert.equal(normalized.actualDate, row.actualDate);
  }
  assert.equal(row.revision, 9, "normalization must not mutate its input");
});

test("shared-cache record timestamps cannot roll back a newer design completion", () => {
  const progressFields = ["designProgress", "interiorDesignProgress", "acceptanceDesignProgress"];
  const oldRow = { id: "design-1", isCustom: true, content: "Bản vẽ", plannedDate: "30/10/2026", actualDate: "", assignee: "Anh", assigneeEmail: "anh@example.com", acceptedAt: "2026-10-27T03:00:00Z", publishedAt: "2026-10-26T03:00:00Z", revision: 4 };
  const completedRow = { ...oldRow, revision: 5, actualDate: "28/10/2026", completedAt: "2026-10-28T03:00:00Z" };
  const customer = (name, timestamp, row) => ({ id: "customer-1", projectId: "GM-DESIGN", houseId: "DV-75", name, createdAt: "28/10/2026", cacheUpdatedAt: timestamp, details: {}, isHydrated: true, ...Object.fromEntries(progressFields.map((field) => [field, [row]])) });
  const years = (record) => [{ year: 2026, months: Array.from({ length: 12 }, (_, index) => ({ label: `T${index + 1}`, records: index === 9 ? [record] : [] })) }];
  for (const [shared, local, expectedName] of [
    [customer("Shared form", 300, oldRow), customer("Local form", 200, completedRow), "Shared form"],
    [customer("Shared form", 200, completedRow), customer("Local form", 300, oldRow), "Local form"],
  ]) {
    const record = helpers.mergeSharedWorkspaceYears(years(shared), years(local))[0].months[9].records[0];
    assert.equal(record.name, expectedName, "ordinary customer fields still follow record timestamp preference");
    for (const field of progressFields) {
      assert.equal(record[field][0].revision, 5, `${field} keeps the newer task revision`);
      assert.equal(record[field][0].actualDate, "28/10/2026", `${field} preserves completion`);
    }
  }
});

test("unsent design reassignment survives equal revisions until a newer canonical task supersedes it", () => {
  const canonical = { id: "design-a", revision: 7, assigneeEmail: "before@example.com", content: "Bản vẽ", publishedAt: "2026-10-26T03:00:00Z" };
  const draft = { ...canonical, assigneeEmail: "after@example.com", note: "Yêu cầu sửa", assignmentDirty: true };
  for (const [preferred, other] of [[draft, canonical], [canonical, draft]]) {
    const merged = helpers.mergeWorkflowDesignRows([preferred], [other]);
    assert.equal(merged[0].assigneeEmail, "after@example.com");
    assert.equal(merged[0].note, "Yêu cầu sửa");
    assert.equal(merged[0].assignmentDirty, true);
  }
  const newer = { ...canonical, revision: 8, actualDate: "28/10/2026", completedAt: "2026-10-28T04:00:00Z" };
  const merged = helpers.mergeWorkflowDesignRows([draft, { id: "design-b", revision: 1 }], [newer, { id: "design-c", revision: 1 }]);
  assert.deepEqual(Array.from(merged, (row) => row.id), ["design-a", "design-b", "design-c"]);
  assert.equal(merged[0].revision, 8);
  assert.equal(merged[0].actualDate, "28/10/2026");
  assert.equal(Boolean(merged[0].assignmentDirty), false);
});

const customerSyncStart = source.indexOf("  const syncCustomerFolder = ");
const customerSyncEnd = source.indexOf("\n  useEffect(", customerSyncStart);
assert.ok(customerSyncStart > 0 && customerSyncEnd > customerSyncStart);
const customerSyncCode = (await transform(
  source.slice(customerSyncStart, customerSyncEnd) + "\nglobalThis.sync = syncCustomerFolder; globalThis.retry = retryPendingCustomerFolders;",
  { loader: "ts", target: "es2022" },
)).code;

function customerSyncFixture() {
  const record = { id: "local-customer", projectId: "GM09112026H1", houseId: "HG-112", pendingDriveSync: true, details: { HVT: "Khách hàng" } };
  const yearsRef = { current: [{ year: 2026, months: Array.from({ length: 12 }, (_, index) => ({ label: `T${index + 1}`, records: index === 10 ? [record] : [] })) }] };
  const identity = { scope: "admin-session-a", rootScope: "script-and-root-a", scriptUrl: "https://script.google.com/test/exec", token: "valid-admin", ready: true };
  const state = { current: identity };
  const calls = [];
  const notices = [];
  const invalidated = [];
  let now = 1000;
  let respond = async () => ({ response: { ok: true }, result: { ok: true, folderId: "confirmed-drive-folder" } });
  const mutation = { current: false };
  const revision = { current: 0 };
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    navigator: { onLine: true },
    customerDriveSyncContext: state,
    customerCreateRequestsInFlight: { current: new Set() },
    customerFolderRetries: { current: new Map() },
    customerMutationInFlight: mutation,
    customerMutationRevision: revision,
    yearsRef,
    normalizeHouseCode: (value) => String(value || "").trim().toLowerCase(),
    isCurrentAdminSession: (session) => session.token === "valid-admin",
    persist: (years) => { yearsRef.current = years; },
    postToAppsScript: async (config, payload) => { calls.push({ ...payload }); return respond(config, payload); },
    clearCustomerDirectoryCache: (year, month) => invalidated.push([year, month]),
    setNotice: (value) => notices.push(value),
  });
  vm.runInContext(customerSyncCode, context);
  return {
    context, state, yearsRef, calls, notices, invalidated, mutation, revision,
    record: () => yearsRef.current[0].months[10].records[0],
    location: () => ({ year: 2026, month: 11, record: yearsRef.current[0].months[10].records[0] }),
    respond: (next) => { respond = next; },
    advance: (milliseconds) => { now += milliseconds; },
  };
}

test("pending customer folders retry with backoff and preserve the original identity and latest form edits", async () => {
  const f = customerSyncFixture();
  f.respond(async () => ({ response: { ok: true }, result: { ok: false, error: "Drive temporarily unavailable" } }));
  assert.equal(await f.context.sync(f.location()), false);
  assert.equal(f.record().pendingDriveSync, true);
  assert.equal(f.record().pendingDriveSyncScope, "script-and-root-a");
  await f.context.retry();
  assert.equal(f.calls.length, 1, "focus and polling cannot immediately repeat a failed write");
  f.record().details.HVT = "Đã sửa sau khi tạo";
  f.respond(async () => ({ response: { ok: true }, result: { ok: true, folderId: "confirmed-drive-folder" } }));
  f.advance(60_000);
  await f.context.retry();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls[1], f.calls[0], "recovery reuses the customer id, house code and period");
  assert.equal(f.record().pendingDriveSync, false);
  assert.equal(f.record().driveFolderId, "confirmed-drive-folder");
  assert.equal(f.record().details.HVT, "Đã sửa sau khi tạo");
  await f.context.retry();
  assert.equal(f.calls.length, 2);
});

test("an ok response without a folder id stays pending until an explicit retry confirms Drive creation", async () => {
  const f = customerSyncFixture();
  f.respond(async () => ({ response: { ok: true }, result: { ok: true } }));
  assert.equal(await f.context.sync(f.location(), true), false);
  assert.equal(f.record().pendingDriveSync, true);
  assert.equal(f.invalidated.length, 0);
  assert.match(f.notices[0], /đang chờ đồng bộ/);
  f.respond(async () => ({ response: { ok: true }, result: { ok: true, folderId: "confirmed-drive-folder" } }));
  await f.context.retry(true);
  assert.equal(f.calls.length, 2, "a deliberate retry bypasses the transient-error backoff");
  assert.equal(f.record().pendingDriveSync, false);
});

test("overlapping folder retries send one request and a late result cannot recreate a deleted customer", async () => {
  const f = customerSyncFixture();
  let finish;
  f.respond(() => new Promise((resolve) => { finish = resolve; }));
  const pending = f.context.sync(f.location());
  await f.context.sync(f.location());
  await f.context.retry(true);
  assert.equal(f.calls.length, 1);
  f.yearsRef.current[0].months[10].records = [];
  f.revision.current += 1;
  finish({ response: { ok: true }, result: { ok: true, folderId: "deleted-drive-folder" } });
  assert.equal(await pending, false);
  assert.equal(f.yearsRef.current[0].months[10].records.length, 0);
  assert.equal(f.invalidated.length, 0);
});

test("logout, account/root changes, and rename discard stale folder responses", async () => {
  for (const change of [
    (f) => { f.state.current = { ...f.state.current, scope: "logged-out", token: "", ready: false }; },
    (f) => { f.state.current = { ...f.state.current, scope: "another-account", token: "", ready: false }; },
    (f) => { f.state.current = { ...f.state.current, scope: "other-root-session", rootScope: "script-and-root-b" }; },
    (f) => { f.record().houseId = "HG-NEW"; f.revision.current += 1; },
  ]) {
    const f = customerSyncFixture();
    let finish;
    f.respond(() => new Promise((resolve) => { finish = resolve; }));
    const pending = f.context.sync(f.location(), true);
    change(f);
    finish({ response: { ok: true }, result: { ok: true, folderId: "stale-folder" } });
    assert.equal(await pending, false);
    assert.equal(f.record().pendingDriveSync, true);
    assert.equal(f.record().driveFolderId, undefined);
    assert.equal(f.notices.length, 0);
    if (f.record().houseId === "HG-112") {
      await f.context.retry();
      assert.equal(f.calls.length, 1, "a pending record bound to its former root cannot create a folder in another root");
    }
  }
});

test("folder recovery requires a valid admin session and skips backed-off records so later customers can recover", async () => {
  const f = customerSyncFixture();
  f.state.current.ready = false;
  await f.context.retry(true);
  assert.equal(f.calls.length, 0);
  f.state.current.ready = true;
  f.state.current.token = "expired-session";
  await f.context.retry(true);
  assert.equal(f.calls.length, 0);
  f.state.current.token = "valid-admin";
  const records = f.yearsRef.current[0].months[10].records;
  for (let index = 1; index <= 4; index++) records.push({ ...records[0], id: `record-${index}`, projectId: `project-${index}`, houseId: `TEST-${index}` });
  f.respond(async () => ({ response: { ok: true }, result: { ok: false, error: "Unavailable" } }));
  await f.context.retry();
  assert.equal(f.calls.length, 3);
  await f.context.retry();
  assert.equal(f.calls.length, 5, "a failed batch does not starve the remaining pending customers");
});
