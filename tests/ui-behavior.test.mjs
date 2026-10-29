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

test("browser folder validation requires both workspace folders and accepts the outer Drive root", async () => {
  const directory = (name, children = {}) => ({name, async getDirectoryHandle(child){if(!children[child])throw new Error("not found");return children[child];}});
  const valid = directory("GM Manager", {"Khách hàng":directory("Khách hàng"),"Nhân lực":directory("Nhân lực")});
  const outer = directory("I", {"Shared drives":directory("Shared drives", {"GM Manager":directory("GM Manager", {"GM Manager":valid})})});
  assert.equal(await helpers.verifyBrowserWorkspace(outer),valid);
  await assert.rejects(helpers.verifyBrowserWorkspace(directory("GM Manager", {"Khách hàng":directory("Khách hàng")})),/Khách hàng và Nhân lực/);
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
