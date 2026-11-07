import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../apps-script/Code.js", import.meta.url), "utf8");
const scope = { year: 2026, month: 10, projectId: "GM-QA-WORKFLOW", houseId: "QA-101", customerName: "Khách kiểm thử" };

function fixture(shared) {
  const values = shared || new Map();
  const cache = new Map();
  const propertyReads = [];
  const propertyWrites = [];
  const cacheWrites = [];
  const clock = { now: Date.parse("2026-10-28T16:30:00Z") };
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  let driveCalls = 0;
  const personnel = [
    { id: "creator", name: "Người tạo", email: "creator@example.com", status: "Có", loginCode: "001", role: "Nhân viên văn phòng", permissions: ["Ghi chú", "Thiết kế"] },
    { id: "alice", name: "Nguyễn Ánh", email: "alice@example.com", status: "Có", loginCode: "002", role: "Nhân viên thiết kế", permissions: ["Ghi chú", "Thiết kế"] },
    { id: "bob", name: "Trần Bình", email: "bob@example.com", status: "Có", loginCode: "003", role: "Nhân viên kỹ thuật", permissions: ["Ghi chú", "Thiết kế"] },
    { id: "manager", name: "Quản lý", email: "manager@example.com", status: "Có", loginCode: "004", role: "Quản lý chung", permissions: [] },
    { id: "viewer", name: "Người xem", email: "viewer@example.com", status: "Có", loginCode: "005", role: "Marketing", permissions: [] },
    { id: "otherManager", name: "Quản lý thứ hai", email: "other-manager@example.com", status: "Có", loginCode: "006", role: "Quản lý chung", permissions: [] },
  ];
  const properties = { getProperty: key => { propertyReads.push(key); return values.get(key) ?? null; }, setProperty: (key, value) => { propertyWrites.push(key); values.set(key, String(value)); }, deleteProperty: key => values.delete(key) };
  const context = vm.createContext({
    console, Date: ClockDate,
    PropertiesService: { getScriptProperties: () => properties },
    CacheService: { getScriptCache: () => ({ get: key => cache.get(key) ?? null, put: (key, value, seconds) => { cacheWrites.push({ key, seconds }); cache.set(key, value); }, remove: key => cache.delete(key) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    DriveApp: { getFolderById() { driveCalls += 1; throw new Error("Drive unavailable in workflow test"); } },
    Utilities: {
      getUuid: randomUUID,
      Charset: { UTF_8: "utf8" },
      base64EncodeWebSafe: value => Buffer.from(value).toString("base64url"),
      base64DecodeWebSafe: value => [...Buffer.from(value, "base64url")],
      newBlob: value => ({ getDataAsString: () => Buffer.from(value).toString("utf8") }),
      computeHmacSha256Signature: (value, secret) => [...createHmac("sha256", secret).update(value).digest()],
      formatDate(date, timeZone, pattern) {
        const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date).map(part => [part.type, part.value]));
        return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, token => parts[{ yyyy: "year", MM: "month", dd: "day", HH: "hour", mm: "minute", ss: "second" }[token]]);
      },
    },
  });
  vm.runInContext(source, context);
  context.loadPersonnel_ = () => ({ personnel: { office: personnel } });
  context.json_ = value => value;
  if (!shared) {
    context.writePropertyJson_(context.workNotesPropertyKey_(scope), []);
    context.writePropertyJson_("gmcrm-active-work-notes-state", []);
    context.writePropertyJson_("gmcrm-active-design-tasks-v2", []);
    context.writePropertyJson_("gmcrm-workflow-message-states-v2", []);
    context.writePropertyJson_("gmcrm-workspace-cache-v1", { updatedAt: 1, years: [{ year: 2026, months: Array.from({ length: 12 }, (_, index) => ({ label: `T${index + 1}`, records: index === 9 ? [{ ...scope, id: "qa-record", details: {}, designProgress: [] }] : [] })) }] });
  }
  const tokens = Object.fromEntries(personnel.map(member => [member.id, context.verifyEmployeeLogin_({ name: member.name, loginCode: member.loginCode }).workflowSessionToken]));
  const admin = context.verifyEmployeeLogin_({ name: "admin", loginCode: "1" });
  tokens.admin = admin.workflowSessionToken;
  let request = 0;
  const command = (actor, operation, payload = {}) => context.workflowCommand_({ ...scope, operation, requestId: `qa-request-${++request}`, workflowSessionToken: tokens[actor], ...payload });
  const note = (id, extra = {}) => ({ id, priority: "Bình thường", workType: "Tư vấn", content: `Công việc ${id}`, dueDate: "30/10/2026", assigneeEmail: "alice@example.com", ...extra });
  const message = (id = "pancake-qa-2026-10-28", extra = {}) => ({ id, conversationId: "qa-conversation", groupName: "QA-101-GM-Tư vấn", ...scope, messages: [{ id: "line-one", senderName: "Khách", content: "Xin sửa phương án", sentAt: "2026-10-28T02:00:00Z" }], firstMessageAt: "2026-10-28T02:00:00Z", lastMessageAt: "2026-10-28T02:00:00Z", messageCount: 1, ...extra });
  const loadNotes = (actor = "manager") => context.loadWorkNotes_({ ...scope, workflowSessionToken: tokens[actor] });
  return { context, values, cache, propertyReads, propertyWrites, cacheWrites, clock, personnel, tokens, admin, command, note, message, loadNotes, driveCalls: () => driveCalls };
}

const plain = value => JSON.parse(JSON.stringify(value));
const code = expected => error => error.code === expected;

test("workflow commands authenticate signed sessions and re-check active roster permissions", () => {
  const f = fixture();
  const before = [...f.values];
  assert.throws(() => f.context.workflowCommand_({ ...scope, operation: "note.publish", requestId: "qa-forged", actorEmail: "admin", note: f.note("forged") }), code("AUTH_REQUIRED"));
  assert.throws(() => f.command("viewer", "note.publish", { note: f.note("forbidden") }), code("FORBIDDEN"));
  assert.throws(() => f.command("creator", "note.publish", { note: f.note("staff-forged") }), code("FORBIDDEN"));
  const alice = f.personnel.find(member => member.id === "alice");
  alice.status = "Ngưng";
  assert.throws(() => f.command("alice", "note.publish", { note: f.note("inactive") }), code("AUTH_REQUIRED"));
  assert.deepEqual([...f.values], before, "denied commands do not mutate cache");
  alice.status = "Có";
  const result = f.context.workflowCommand_({ ...scope, operation: "note.publish", requestId: "qa-admin-fallback", adminSessionToken: f.admin.adminSessionToken, note: f.note("admin") });
  assert.equal(result.note.creatorEmail, "admin");
  const compatibility = f.context.workflowCommand_({ ...scope, operation: "note.publish", requestId: "qa-admin-same-token", workflowSessionToken: f.admin.adminSessionToken, adminSessionToken: f.admin.adminSessionToken, note: f.note("admin-fallback") });
  assert.equal(compatibility.note.creatorEmail, "admin");
});

test("publishing validates real dates, active assignee and content before changing state", () => {
  const f = fixture();
  const before = [...f.values];
  for (const patch of [{ dueDate: "31/02/2026" }, { dueDate: "27/10/2026" }, { dueDate: "" }, { assigneeEmail: "missing@example.com" }, { content: "   " }]) assert.throws(() => f.command("manager", "note.publish", { note: f.note("bad", patch) }), code("VALIDATION"));
  assert.deepEqual([...f.values], before);
  const published = f.command("manager", "note.publish", { note: f.note("valid", { acceptedAt: "forged", actualDate: "forged", creatorEmail: "admin" }) });
  assert.equal(published.note.creatorEmail, "manager@example.com");
  assert.equal(published.note.acceptedAt, "");
  assert.equal(published.note.actualDate, "");
  assert.equal(published.note.status, "Đen");
  assert.equal(f.driveCalls(), 0, "publishing and assignment delivery stay in shared cache");
});

test("request replay is idempotent and rejects the same id with different content", () => {
  const f = fixture();
  const payload = { note: f.note("one"), requestId: "stable-publish" };
  const first = f.command("manager", "note.publish", payload);
  const replay = f.command("manager", "note.publish", payload);
  assert.equal(replay.repeated, true);
  assert.equal(replay.notes.length, 1);
  assert.equal(replay.revision, first.revision);
  assert.throws(() => f.command("manager", "note.publish", { ...payload, note: { ...payload.note, content: "khác" } }), code("CONFLICT"));
});

test("assignee completion reaches manager review without closing, archiving or exposing colleagues' work", () => {
  const f = fixture();
  f.command("manager", "note.publish", { note: f.note("alice-task") });
  f.command("manager", "note.publish", { note: f.note("bob-task", { assigneeEmail: "bob@example.com" }) });
  assert.throws(() => f.command("bob", "note.accept", { noteId: "alice-task" }), code("FORBIDDEN"));
  assert.throws(() => f.command("alice", "note.complete", { noteId: "alice-task" }), code("VALIDATION"));
  f.command("alice", "note.accept", { noteId: "alice-task" });
  f.command("bob", "note.accept", { noteId: "bob-task" });
  let archives = 0;
  let visibleWhenArchiving;
  f.context.workflowArchiveItem_ = () => {
    archives += 1;
    visibleWhenArchiving = f.context.loadAssignedWorkNotes_({ workflowSessionToken: f.tokens.manager }).notes.map(note => note.id);
    throw new Error("Drive read-only");
  };
  const result = f.command("alice", "note.complete", { noteId: "alice-task", note: { actualDate: "01/01/1900" } });
  assert.equal(result.note.actualDate, "");
  assert.equal(result.note.completedAt, "");
  assert.equal(result.note.completionRequestedAt, "2026-10-28T16:30:00.000Z");
  assert.equal(result.note.completionRequestedBy, "alice@example.com");
  assert.equal(archives, 0, "submission never tries to archive before approval");
  assert.equal(result.notes.some(note => note.id === "bob-task"), false, "mutation response does not expose colleagues' assignments");
  assert.ok(f.loadNotes().notes.find(note => note.id === "bob-task").acceptedAt);
  const review = { noteId: result.note.id, expectedRevision: result.note.revision };
  assert.throws(() => f.command("alice", "note.approve", { ...review, manager: true }), code("FORBIDDEN"));
  assert.throws(() => f.command("manager", "note.delete", review), code("CONFLICT"));
  assert.equal(f.context.loadAssignedWorkNotes_({ workflowSessionToken: f.tokens.manager }).notes.find(note => note.id === "alice-task").completionRequestedAt, result.note.completionRequestedAt);
  assert.equal(f.context.loadAssignedWorkNotes_({ workflowSessionToken: f.tokens.alice }).notes.length, 1);
  f.clock.now += 86400000;
  const approved = f.command("manager", "note.approve", review);
  assert.equal(approved.note.actualDate, "28/10/2026", "review latency is not included in the employee's completion date");
  assert.equal(approved.note.completedAt, "2026-10-29T16:30:00.000Z");
  assert.equal(approved.note.reviewedBy, "manager@example.com");
  assert.equal(approved.note.archivePending, true, "approval closes the work even when Drive is unavailable");
  assert.equal(archives, 1);
  assert.deepEqual(plain(visibleWhenArchiving), ["bob-task"], "review leaves the active queue before Drive I/O begins");
  assert.equal(f.context.loadAssignedWorkNotes_({ email: "alice@example.com", workflowSessionToken: f.tokens.alice }).notes.length, 0);
  assert.equal(f.context.loadAssignedWorkNotes_({ email: "manager@example.com", workflowSessionToken: f.tokens.manager }).notes.length, 1);
});

test("unarchived completion survives retention and retries safely without changing completion date", () => {
  const f = fixture();
  f.command("manager", "note.publish", { note: f.note("archive") });
  f.command("alice", "note.accept", { noteId: "archive" });
  let archives = 0;
  f.context.workflowArchiveItem_ = () => { archives += 1; throw new Error("Drive unavailable"); };
  const submitted = f.command("alice", "note.complete", { noteId: "archive", requestId: "complete-stable" });
  const approval = { noteId: "archive", expectedRevision: submitted.note.revision, requestId: "approve-stable" };
  const completed = f.command("manager", "note.approve", approval);
  assert.equal(completed.archivePending, true);
  f.clock.now += 3 * 86400000;
  assert.equal(f.loadNotes().notes.length, 1, "two-day cleanup never drops unarchived work");
  f.context.workflowArchiveItem_ = () => { archives += 1; return {}; };
  const retried = f.command("manager", "note.approve", approval);
  assert.equal(retried.repeated, true);
  assert.equal(retried.note.actualDate, completed.note.actualDate);
  assert.equal(retried.note.archivePending, false);
  assert.ok(retried.note.archivedAt);
  assert.equal(retried.notes.length, 0, "archived work expires only after its two-day retention");
  f.command("manager", "note.approve", approval);
  assert.equal(archives, 2, "a delivered archive is not exported twice");
});

test("creator edits are revision-checked and reassignment requires a fresh acceptance", () => {
  const f = fixture();
  const original = f.command("manager", "note.publish", { note: f.note("edit") }).note;
  assert.throws(() => f.command("otherManager", "note.edit", { note: { ...original, content: "not creator" }, expectedRevision: original.revision }), code("FORBIDDEN"));
  f.command("alice", "note.accept", { noteId: "edit" });
  assert.throws(() => f.command("manager", "note.edit", { note: { ...original, content: "stale" }, expectedRevision: original.revision }), code("CONFLICT"));
  const current = f.loadNotes().notes[0];
  const changed = f.command("manager", "note.edit", { note: { ...current, assigneeEmail: "bob@example.com" }, expectedRevision: current.revision }).note;
  assert.equal(changed.acceptedAt, "");
  assert.equal(changed.actualDate, "");
  assert.equal(changed.status, "Đen");
  assert.throws(() => f.command("alice", "note.accept", { noteId: "edit" }), code("FORBIDDEN"));
  assert.ok(f.command("bob", "note.accept", { noteId: "edit" }).note.acceptedAt);
});

test("deletion tombstones persist across server instances and reject legacy resurrection", () => {
  const f = fixture();
  const note = f.command("manager", "note.publish", { note: f.note("deleted") }).note;
  f.command("manager", "note.delete", { noteId: note.id, expectedRevision: note.revision });
  const later = fixture(f.values);
  const loaded = later.loadNotes();
  assert.deepEqual(plain(loaded.notes), []);
  assert.deepEqual(plain(loaded.deletedIds), ["deleted"]);
  assert.throws(() => later.context.syncWorkNotes_({ ...scope, notes: [note] }), code("UPDATE_REQUIRED"));
  assert.throws(() => later.command("manager", "note.publish", { note }), code("CONFLICT"));
});

test("assigned staff submit design for review, managers approve and stale workspace saves cannot undo it", () => {
  const f = fixture();
  const rows = [
    { id: "design-a", content: "Mặt bằng", plannedDate: "30/10/2026", assigneeEmail: "alice@example.com", note: "" },
    { id: "design-b", content: "Mặt đứng", plannedDate: "31/10/2026", assigneeEmail: "bob@example.com", note: "" },
    { id: "template", content: "Chưa giao", plannedDate: "", assigneeEmail: "", note: "" },
  ];
  const publish = f.command("manager", "design.publish", { kind: "architecture", title: "Tiến độ kiến trúc", rows });
  assert.equal(publish.tasks.length, 2);
  const before = plain([...f.values]);
  for (const actor of ["creator", "alice", "bob", "viewer"]) {
    for (const operation of ["design.publish", "design.approve", "design.return"]) assert.throws(() => f.command(actor, operation, { kind: "architecture", rowId: "design-a", rows, role: "Quản lý chung", manager: true }), code("FORBIDDEN"));
  }
  for (const actor of ["creator", "bob", "viewer"]) {
    for (const operation of ["design.accept", "design.complete"]) assert.throws(() => f.command(actor, operation, { kind: "architecture", rowId: "design-a" }), code("FORBIDDEN"));
  }
  assert.deepEqual(plain([...f.values]), before, "rejected employee actions cannot modify canonical data");
  f.command("alice", "design.accept", { kind: "architecture", rowId: "design-a" });
  let archives = 0;
  f.context.workflowArchiveItem_ = () => { archives += 1; return {}; };
  const submitted = f.command("alice", "design.complete", { kind: "architecture", rowId: "design-a" }).rows[0];
  assert.equal(submitted.actualDate, "");
  assert.equal(submitted.completionRequestedBy, "alice@example.com");
  assert.equal(archives, 0);
  assert.equal(f.context.loadAssignedDesignTasks_({ workflowSessionToken: f.tokens.manager }).tasks[0].completionRequestedAt, submitted.completionRequestedAt);
  assert.throws(() => f.command("manager", "design.publish", { kind: "architecture", rows: [{ ...submitted, content: "Changed during review" }] }), code("CONFLICT"));
  f.clock.now += 1000;
  const republished = f.command("manager", "design.publish", { kind: "architecture", rows: [submitted, rows[1]] });
  assert.deepEqual(plain(republished.rows[0]), plain(submitted), "publishing another design row leaves the pending review unchanged");
  const complete = f.command("manager", "design.approve", { kind: "architecture", rowId: "design-a", expectedRevision: submitted.revision });
  const row = complete.rows.find(row => row.id === "design-a");
  assert.equal(row.actualDate, "28/10/2026");
  assert.ok(row.archivedAt);
  assert.equal(complete.tasks.length, 1);
  const old = [{ year: 2026, months: [{ label: "T10", records: [{ ...scope, designProgress: rows }] }] }];
  const protectedRows = f.context.workflowProtectWorkspace_(old)[0].months[0].records[0].designProgress;
  assert.equal(protectedRows.find(row => row.id === "design-a").actualDate, "28/10/2026");
  assert.throws(() => f.context.syncDesignTasks_({ ...scope, workflowSessionToken: f.tokens.manager, kind: "architecture", rows }), code("UPDATE_REQUIRED"));
  assert.equal(f.context.loadAssignedDesignTasks_({ email: "manager@example.com", workflowSessionToken: f.tokens.manager }).tasks.length, 1);
});

test("returning a submitted task requires valid feedback and a date, then starts a durable new assignment cycle", () => {
  for (const domain of ["note", "design"]) {
    const f = fixture();
    const id = `review-${domain}`;
    const scope = domain === "note" ? { noteId: id } : { kind: "architecture", rowId: id };
    const item = result => domain === "note" ? result.note : result.rows[0];
    const assigned = fixture => domain === "note"
      ? fixture.context.loadAssignedWorkNotes_({ workflowSessionToken: fixture.tokens.alice }).notes
      : fixture.context.loadAssignedDesignTasks_({ workflowSessionToken: fixture.tokens.alice }).tasks;
    if (domain === "note") f.command("manager", "note.publish", { note: f.note(id) });
    else f.command("manager", "design.publish", { kind: scope.kind, rows: [{ id, content: "Mặt bằng", assigneeEmail: "alice@example.com", plannedDate: "30/10/2026" }] });
    const accepted = item(f.command("alice", `${domain}.accept`, scope));
    const submission = { ...scope, expectedRevision: accepted.revision, requestId: `submit-${domain}` };
    const submitted = item(f.command("alice", `${domain}.complete`, submission));
    const change = { ...scope, expectedRevision: submitted.revision, dueDate: "01/11/2026", reviewComment: "  Cập nhật số đo cửa.  ", requestId: `return-${domain}` };
    for (const patch of [{ expectedRevision: undefined }, { dueDate: "31/11/2026" }, { dueDate: "27/10/2026" }, { reviewComment: " " }, { reviewComment: "a".repeat(4001) }]) {
      assert.throws(() => f.command("manager", `${domain}.return`, { ...change, ...patch }), code("VALIDATION"));
    }
    assert.throws(() => f.command("alice", `${domain}.return`, change), code("FORBIDDEN"));
    const returned = item(f.command("manager", `${domain}.return`, change));
    assert.equal(returned[domain === "note" ? "dueDate" : "plannedDate"], "01/11/2026");
    assert.equal(returned.reviewComment, "Cập nhật số đo cửa.");
    assert.equal(returned.completionRequestedAt, "");
    assert.equal(returned.acceptedAt, "");
    assert.equal(returned.acceptedBy, "");
    assert.equal(returned.assigneeEmail, submitted.assigneeEmail);
    assert.ok(returned.reassignedAt);
    assert.equal(f.command("manager", `${domain}.return`, change).repeated, true);
    assert.equal(f.command("alice", `${domain}.complete`, submission).repeated, true, "replaying a prior submission cannot reopen a review");
    assert.throws(() => f.command("admin", `${domain}.approve`, { ...scope, expectedRevision: returned.revision }), code("FORBIDDEN"));
    assert.throws(() => f.command("manager", `${domain}.approve`, { ...scope, expectedRevision: submitted.revision }), code("CONFLICT"));
    assert.throws(() => f.command("alice", `${domain}.accept`, scope), code("UPDATE_REQUIRED"));
    assert.throws(() => f.command("alice", `${domain}.complete`, { ...scope, expectedRevision: returned.revision }), code("VALIDATION"));
    const restarted = fixture(f.values);
    const reassigned = assigned(restarted)[0];
    assert.equal(reassigned.revision, returned.revision);
    assert.equal(reassigned.reviewComment, returned.reviewComment);
    const reaccepted = item(restarted.command("alice", `${domain}.accept`, { ...scope, expectedRevision: reassigned.revision, requestId: `reaccept-${domain}` }));
    assert.equal(reaccepted.reviewComment, returned.reviewComment);
    const second = item(restarted.command("alice", `${domain}.complete`, { ...scope, expectedRevision: reaccepted.revision, requestId: `resubmit-${domain}` }));
    assert.throws(() => restarted.command("manager", `${domain}.approve`, { ...scope, expectedRevision: submitted.revision, requestId: `approve-stale-${domain}` }), code("CONFLICT"));
    restarted.context.workflowArchiveItem_ = () => ({});
    const approved = item(restarted.command("manager", `${domain}.approve`, { ...scope, expectedRevision: second.revision, requestId: `approve-current-${domain}` }));
    assert.equal(approved.actualDate, "28/10/2026");
    assert.equal(assigned(restarted).length, 0);
  }
});

test("only a current manager may change message status or assign work, even with a forged role", () => {
  const f = fixture();
  const group = f.message();
  f.context.workflowIngestMessages_([group]);
  const before = plain([...f.values]);
  for (const actor of ["creator", "alice", "bob", "viewer"]) {
    for (const status of ["new", "processing", "resolved"]) {
      assert.throws(() => f.command(actor, "message.status", { messageId: group.id, status, role: "Quản lý chung", manager: true }), code("FORBIDDEN"));
    }
    assert.throws(() => f.command(actor, "message.assign", { messageId: group.id }), code("FORBIDDEN"));
  }
  assert.deepEqual(plain([...f.values]), before);
  const changed = f.command("manager", "message.status", { messageId: group.id, status: "processing", expectedRevision: f.context.readPancakeMessageStates_()[0].revision });
  assert.equal(changed.message.status, "processing");
  f.personnel.find(member => member.id === "manager").role = "Nhân viên văn phòng";
  assert.throws(() => f.command("manager", "message.status", { messageId: group.id, status: "resolved" }), code("FORBIDDEN"), "a saved session cannot preserve a revoked management role");
});

test("normalized roster manager titles have admin message actions while admin-only actions stay protected", () => {
  for (const role of ["Quản lý chung", "Quản lý", "  QUẢN   LÝ   CHUNG ", "Quản lý".normalize("NFD")]) {
    const f = fixture();
    const manager = f.personnel.find(member => member.id === "manager");
    manager.role = role;
    const login = f.context.verifyEmployeeLogin_({ name: manager.name, loginCode: manager.loginCode });
    assert.equal(login.valid, true);
    assert.equal(login.member.role, "Quản lý chung");
    assert.equal(f.context.workflowActor_({ workflowSessionToken: f.tokens.manager }).manager, true);
    assert.throws(() => f.context.requireCustomerAdminSession_({ adminSessionToken: f.tokens.manager }), /Chỉ admin/);
    const group = f.message();
    f.context.workflowIngestMessages_([group]);
    for (const status of ["processing", "new"]) {
      assert.equal(f.command("manager", "message.status", { messageId: group.id, status }).message.status, status);
    }
    const assigned = f.command("manager", "message.assign", { messageId: group.id, selectedLineIds: ["line-one"], assignment: f.note("manager-assignment") });
    assert.equal(assigned.note.creatorEmail, manager.email);
    f.context.appendPancakeMessageWorkbook_ = () => ({});
    assert.equal(f.command("manager", "message.status", { messageId: group.id, status: "resolved" }).message.status, "resolved");
    manager.role = "Nhân viên quản lý";
    assert.throws(() => f.command("manager", "message.status", { messageId: group.id, status: "new" }), code("FORBIDDEN"));
  }
});

test("consulting and draft design fields are protected from employee cache writes while warranty updates remain available", () => {
  const f = fixture();
  const years = f.context.loadWorkspaceCache_({ workflowSessionToken: f.tokens.manager }).years;
  const record = years[0].months[9].records[0];
  const managerVersion = { ...record, name: "Thông tin do quản lý lưu", details: { HVT: "Tên đã duyệt", ZALO_GROUP_NAME: "QA-101-GM" }, functionalFloors: [{ id: "floor", floor: "Tầng 1", rooms: [] }], designProgress: [{ id: "draft", content: "Bản nháp thiết kế", plannedDate: "30/10/2026", assigneeEmail: "alice@example.com" }] };
  years[0].months[9].records = [managerVersion];
  f.context.saveWorkspaceCache_({ years, updatedAt: 100, workflowSessionToken: f.tokens.manager });
  const employeeYears = plain(years);
  Object.assign(employeeYears[0].months[9].records[0], { name: "Sửa trái quyền", details: { HVT: "Sửa trái quyền" }, functionalFloors: [], designProgress: [], customerShareToken: "forged-share", warrantyProgress: [{ id: "warranty", note: "Cập nhật ngoài phạm vi chỉ xem" }] });
  f.context.saveWorkspaceCache_({ years: employeeYears, updatedAt: 101, workflowSessionToken: f.tokens.alice });
  const saved = f.context.loadWorkspaceCache_({ workflowSessionToken: f.tokens.manager }).years[0].months[9].records[0];
  for (const field of ["name", "details", "functionalFloors"]) assert.deepEqual(plain(saved[field]), plain(managerVersion[field]));
  assert.deepEqual(plain(saved.designProgress), [{ ...managerVersion.designProgress[0], creatorEmail: "manager@example.com", creatorName: "Quản lý" }]);
  const staffRecord = f.context.loadWorkspaceCache_({ workflowSessionToken: f.tokens.alice }).years[0].months[9].records[0];
  assert.deepEqual(plain(staffRecord.designProgress), [], "staff can only see published design assignments");
  const otherManagerYears = f.context.loadWorkspaceCache_({ workflowSessionToken: f.tokens.otherManager }).years;
  assert.deepEqual(plain(otherManagerYears[0].months[9].records[0].designProgress), [], "the second manager cannot read the first manager's draft");
  otherManagerYears[0].months[9].records[0].designProgress = [{ id: "other-draft", content: "Nháp riêng" }];
  f.context.saveWorkspaceCache_({ years: otherManagerYears, updatedAt: 102, workflowSessionToken: f.tokens.otherManager });
  const retainedDrafts = f.context.loadWorkspaceCache_({ workflowSessionToken: f.tokens.manager }).years[0].months[9].records[0].designProgress;
  assert.deepEqual(plain(retainedDrafts), plain(saved.designProgress), "the second manager's filtered cache write cannot erase a hidden draft");
  assert.equal(saved.customerShareToken, undefined);
  assert.equal(saved.warrantyProgress[0].id, "warranty");
  assert.equal(f.driveCalls(), 0);
  assert.throws(() => f.context.renameCustomerFolder_({ ...scope, houseId: "OTHER", workflowSessionToken: f.tokens.alice }), code("FORBIDDEN"));
  assert.throws(() => f.context.syncDesignTasks_({ ...scope, kind: "architecture", rows: [], workflowSessionToken: f.tokens.alice }), code("FORBIDDEN"));
});

test("message assignments use canonical selected lines and manager authorization, including the virtual test customer", () => {
  const f = fixture();
  const group = f.message();
  f.context.workflowIngestMessages_([group]);
  const assignment = f.note("message-note");
  const payload = { messageId: group.id, message: { ...group, messages: [{ id: "line-one", content: "forged content" }] }, selectedLineIds: ["line-one"], assignment, requestId: "message-assignment-stable" };
  assert.throws(() => f.command("alice", "message.assign", payload), code("FORBIDDEN"));
  const result = f.command("manager", "message.assign", payload);
  assert.equal(result.note.sourceMessageId, group.id);
  assert.ok(result.note.messageContext.includes("Xin sửa phương án"));
  assert.ok(!result.note.messageContext.includes("forged"));
  assert.equal(f.command("manager", "message.assign", payload).notes.length, 1);
  const special = f.message("bui-test", { groupName: "Bùi Đức Thành", customerName: "Bùi Đức Thành", houseId: "", projectId: "" });
  f.context.workflowIngestMessages_([special]);
  f.context.writePropertyJson_(f.context.workNotesPropertyKey_({ ...scope, projectId: "GMCRM-VIRTUAL-BUI-DUC-THANH" }), []);
  const virtual = f.command("manager", "message.assign", { messageId: special.id, selectedLineIds: ["line-one"], assignment: f.note("virtual-task") });
  assert.equal(virtual.note.creatorEmail, "manager@example.com");
  assert.ok(f.context.loadAssignedWorkNotes_({ email: "alice@example.com", workflowSessionToken: f.tokens.alice }).notes.some(note => note.projectId === "GMCRM-VIRTUAL-BUI-DUC-THANH"));
});

test("resolved messages remain visible until archive succeeds and reopen for fresh canonical lines", () => {
  const f = fixture();
  const group = f.message();
  f.context.workflowIngestMessages_([group]);
  const first = f.context.readPancakeMessageStates_()[0];
  let exports = 0;
  f.context.appendPancakeMessageWorkbook_ = () => { exports += 1; throw new Error("Excel unavailable"); };
  const pending = f.command("manager", "message.status", { messageId: group.id, status: "resolved", expectedRevision: first.revision, requestId: "resolve-stable" });
  assert.equal(pending.message.archivePending, true);
  assert.equal(f.context.workflowMessagesView_([group], f.context.readPancakeMessageStates_()).length, 1);
  f.context.appendPancakeMessageWorkbook_ = () => { exports += 1; return {}; };
  const delivered = f.command("manager", "message.status", { messageId: group.id, status: "resolved", expectedRevision: first.revision, requestId: "resolve-stable" });
  assert.equal(delivered.archivePending, false);
  assert.equal(f.context.workflowMessagesView_([group], f.context.readPancakeMessageStates_()).length, 0);
  f.command("manager", "message.status", { messageId: group.id, status: "resolved", expectedRevision: first.revision, requestId: "resolve-stable" });
  assert.equal(exports, 2);
  const newLine = { id: "line-two", senderName: "Khách", content: "Có thêm yêu cầu", sentAt: "2026-10-28T02:30:00Z" };
  const changedGroup = { ...group, messages: [...group.messages, newLine], lastMessageAt: newLine.sentAt, messageCount: 2 };
  f.context.workflowIngestMessages_([changedGroup]);
  const reopened = f.context.workflowMessagesView_([changedGroup], f.context.readPancakeMessageStates_())[0];
  assert.equal(reopened.status, "new");
  assert.throws(() => f.command("manager", "message.status", { messageId: group.id, status: "resolved", expectedRevision: first.revision }), code("CONFLICT"));
  let delta;
  f.context.appendPancakeMessageWorkbook_ = value => { delta = value; return {}; };
  f.command("manager", "message.status", { messageId: group.id, status: "resolved", expectedRevision: reopened.revision });
  assert.deepEqual(plain(delta.messages.map(line => line.id)), ["line-two"]);
});

test("completion dates follow Vietnam calendar across UTC midnight", () => {
  const f = fixture();
  f.command("manager", "note.publish", { note: f.note("timezone", { dueDate: "29/10/2026" }) });
  f.command("alice", "note.accept", { noteId: "timezone" });
  f.clock.now = Date.parse("2026-10-28T18:00:00Z");
  f.context.workflowArchiveItem_ = () => ({});
  const submitted = f.command("alice", "note.complete", { noteId: "timezone" }).note;
  assert.equal(f.command("manager", "note.approve", { noteId: submitted.id, expectedRevision: submitted.revision }).note.actualDate, "29/10/2026");
});

test("Pancake window ids and earlier lines survive the sliding latest-message API page", () => {
  const f = fixture();
  const conversation = { id: "stable-conversation", from: { name: "QA-101-GM-Tư vấn" } };
  const initial = f.context.groupPancakeMessages_(conversation, [
    { id: "first", content: "Lúc đầu", inserted_at: "2026-10-28T02:05:00Z" },
    { id: "second", content: "Tiếp theo", inserted_at: "2026-10-28T02:30:00Z" },
  ], scope);
  const later = f.context.groupPancakeMessages_(conversation, [
    { id: "second", content: "Tiếp theo", inserted_at: "2026-10-28T02:30:00Z" },
    { id: "third", content: "Mới", inserted_at: "2026-10-28T03:30:00Z" },
    { id: "next-window", content: "Sau hai giờ", inserted_at: "2026-10-28T04:05:00Z" },
  ], scope, initial);
  assert.equal(later.length, 2);
  assert.equal(later[0].id, initial[0].id);
  assert.deepEqual(plain(later[0].messages.map(line => line.id)), ["first", "second", "third"]);
  assert.equal(later[1].messages[0].id, "next-window");
});

test("doPost returns actionable workflow errors without accepting spoofed actor fields", () => {
  const f = fixture();
  const result = f.context.doPost({ postData: { contents: JSON.stringify({ ...scope, action: "workflow-command", operation: "note.publish", requestId: "denied-post", actorEmail: "admin", note: f.note("denied") }) } });
  assert.equal(result.ok, false);
  assert.equal(result.code, "AUTH_REQUIRED");
  const legacy = f.context.doPost({ postData: { contents: JSON.stringify({ ...scope, action: "complete-work-note", actorEmail: "alice@example.com", note: f.note("legacy", { actualDate: "28/10/2026" }) }) } });
  assert.equal(legacy.ok, false);
  assert.equal(legacy.code, "UPDATE_REQUIRED");
  assert.equal(f.driveCalls(), 0);
});

test("canonical reads ignore claimed admin email and expose only the signed employee's permitted notes", () => {
  const f = fixture();
  f.command("manager", "note.publish", { note: f.note("alice-private") });
  f.command("manager", "note.publish", { note: f.note("bob-private", { assigneeEmail: "bob@example.com" }) });
  assert.throws(() => f.context.loadWorkNotes_({ ...scope, email: "admin" }), code("AUTH_REQUIRED"));
  const project = f.context.loadWorkNotes_({ ...scope, email: "admin", workflowSessionToken: f.tokens.alice });
  assert.deepEqual(plain(project.notes.map(note => note.id)), ["alice-private"]);
  const overview = f.context.loadAssignedWorkNotes_({ email: "admin", workflowSessionToken: f.tokens.bob });
  assert.deepEqual(plain(overview.notes.map(note => note.id)), ["bob-private"]);
  assert.throws(() => f.context.loadAssignedWorkNotes_({ email: "admin" }), code("AUTH_REQUIRED"));
  assert.equal(f.loadNotes("manager").notes.length, 2, "the assignment owner retains access");
  assert.equal(f.loadNotes("creator").notes.length, 0, "another permitted employee has no assignment");
  f.personnel.find(member => member.id === "alice").permissions = [];
  assert.throws(() => f.loadNotes("alice"), code("FORBIDDEN"));
});

test("assignment ownership isolates two managers, admin and staff in project snapshots, queues and commands", () => {
  const f = fixture();
  const assignments = [
    ["manager", "manager-work", "alice@example.com"],
    ["otherManager", "other-manager-work", "bob@example.com"],
    ["admin", "admin-work", "alice@example.com"],
  ];
  const designRow = (id, assigneeEmail) => ({ id, content: `Thiết kế ${id}`, plannedDate: "30/10/2026", assigneeEmail });
  const ids = items => plain(items.map(item => item.id)).sort();
  for (const [owner, id, assignee] of assignments) {
    const published = f.command(owner, "note.publish", { note: f.note(id, { assigneeEmail: assignee, creatorEmail: "forged@example.com" }) });
    assert.deepEqual(ids(published.notes), [id], "note publication returns only the assigning account's notes");
    const designed = f.command(owner, "design.publish", { kind: "architecture", rows: [designRow(id, assignee)] });
    assert.deepEqual(ids(designed.rows.filter(row => row.publishedAt)), [id], "design publication returns only the assigning account's rows");
  }
  const historical = f.context.workflowReadProject_(scope);
  historical.notes.push(f.note("legacy-cross-manager", { assigneeEmail: "other-manager@example.com", creatorEmail: "manager@example.com", revision: 1 }));
  historical.design.architecture.push({ ...designRow("legacy-cross-manager", "other-manager@example.com"), creatorEmail: "manager@example.com", publishedAt: "2026-10-28T02:00:00.000Z", revision: 1 });
  f.context.workflowWriteProject_(historical);
  const expected = {
    manager: ["legacy-cross-manager", "manager-work"],
    otherManager: ["other-manager-work"],
    admin: ["admin-work"],
    alice: ["admin-work", "manager-work"],
    bob: ["other-manager-work"],
  };
  for (const [account, visible] of Object.entries(expected)) {
    const session = { workflowSessionToken: f.tokens[account], email: "admin" };
    assert.deepEqual(ids(f.loadNotes(account).notes), visible, `${account} project notes`);
    const noteFeed = f.context.loadAssignedWorkNotes_({ ...session, project: scope });
    assert.deepEqual(ids(noteFeed.notes), visible, `${account} note queue`);
    assert.deepEqual(ids(noteFeed.projectSnapshot.notes), visible, `${account} project poll snapshot`);
    assert.deepEqual(ids(f.context.loadAssignedDesignTasks_(session).tasks), visible, `${account} design queue`);
    const workspace = f.context.loadWorkspaceCache_(session);
    const record = workspace.years[0].months[9].records[0];
    assert.deepEqual(ids(record.designProgress.filter(row => row.publishedAt)), visible, `${account} workspace design cache`);
  }
  assert.throws(() => f.context.loadAssignedDesignTasks_({ email: "admin" }), code("AUTH_REQUIRED"));
  assert.deepEqual(ids(f.context.loadWorkspaceCache_().years[0].months[9].records[0].designProgress), [], "the unsigned workspace view cannot expose published assignments");

  const note = f.loadNotes("manager").notes.find(item => item.id === "manager-work");
  assert.throws(() => f.command("otherManager", "note.delete", { noteId: note.id, expectedRevision: note.revision }), code("FORBIDDEN"));
  assert.throws(() => f.command("otherManager", "design.publish", { kind: "architecture", rows: [designRow(note.id, "bob@example.com")] }), code("FORBIDDEN"));
  assert.throws(() => f.command("otherManager", "note.accept", { noteId: "legacy-cross-manager" }), code("FORBIDDEN"));
  assert.throws(() => f.command("otherManager", "design.accept", { kind: "architecture", rowId: "legacy-cross-manager" }), code("FORBIDDEN"));
  assert.throws(() => f.command("manager", "note.publish", { note: f.note("hidden-for-assignee", { assigneeEmail: "other-manager@example.com" }) }), code("VALIDATION"));
  assert.throws(() => f.command("manager", "design.publish", { kind: "architecture", rows: [designRow("hidden-for-assignee", "other-manager@example.com")] }), code("VALIDATION"));
  for (const [domain, target] of [["note", { noteId: note.id }], ["design", { kind: "architecture", rowId: note.id }]]) {
    const item = result => domain === "note" ? result.note : result.rows.find(row => row.id === note.id);
    f.command("alice", `${domain}.accept`, target);
    const requested = item(f.command("alice", `${domain}.complete`, target));
    const decision = { ...target, expectedRevision: requested.revision };
    for (const wrongOwner of ["otherManager", "admin"]) {
      assert.throws(() => f.command(wrongOwner, `${domain}.approve`, decision), code("FORBIDDEN"));
      assert.throws(() => f.command(wrongOwner, `${domain}.return`, { ...decision, reviewComment: "Không được duyệt", dueDate: "31/10/2026" }), code("FORBIDDEN"));
      assert.throws(() => f.command(wrongOwner, "archive.retry", target), code("FORBIDDEN"));
    }
    f.context.workflowArchiveItem_ = () => ({});
    assert.equal(item(f.command("manager", `${domain}.approve`, decision)).actualDate, "28/10/2026");
  }
  assert.equal(f.command("manager", "note.publish", { note: f.note("own-assignment", { assigneeEmail: "manager@example.com" }) }).note.assigneeEmail, "manager@example.com");
  assert.equal(f.command("manager", "design.publish", { kind: "architecture", rows: [designRow("own-assignment", "manager@example.com")] }).rows.find(row => row.id === "own-assignment").assigneeEmail, "manager@example.com");
});

test("read-only workflow polling reuses six-second snapshots and commits invalidate project/index caches", () => {
  const f = fixture();
  f.command("manager", "note.publish", { note: f.note("cache-one") });
  const projectKey = f.context.workflowProjectKey_(scope);
  const cacheKey = f.context.workflowReadCacheKey_(projectKey);
  const indexCacheKey = f.context.workflowReadCacheKey_("gmcrm-workflow-project-index-v2");
  f.loadNotes();
  assert.ok(f.cache.has(cacheKey));
  assert.equal(f.cacheWrites.find(write => write.key === cacheKey).seconds, 6);
  f.propertyReads.length = 0;
  f.loadNotes();
  assert.equal(f.propertyReads.filter(key => key.startsWith(`${projectKey}:`)).length, 0, "cache hit avoids project manifest/chunk reads");
  f.context.loadAssignedWorkNotes_({ workflowSessionToken: f.tokens.manager });
  assert.ok(f.cache.has(indexCacheKey));
  f.command("alice", "note.accept", { noteId: "cache-one" });
  assert.equal(f.cache.has(cacheKey), false, "a committed acknowledgement invalidates the read snapshot");
  assert.ok(f.loadNotes().notes[0].acceptedAt);
  const nextScope = { ...scope, projectId: "GM-QA-ANOTHER", houseId: "QA-102" };
  f.context.writePropertyJson_(f.context.workNotesPropertyKey_(nextScope), []);
  f.command("manager", "note.publish", { ...nextScope, note: f.note("cache-two") });
  assert.equal(f.cache.has(indexCacheKey), false, "a newly indexed project invalidates the registry snapshot");
  assert.equal(f.context.loadAssignedWorkNotes_({ workflowSessionToken: f.tokens.manager }).notes.length, 2);
});

test("mutations ignore an old poll snapshot reinserted after cache invalidation", () => {
  const f = fixture();
  f.command("manager", "note.publish", { note: f.note("stale-cache") });
  f.loadNotes();
  const cacheKey = f.context.workflowReadCacheKey_(f.context.workflowProjectKey_(scope));
  const oldSnapshot = f.cache.get(cacheKey);
  f.command("alice", "note.accept", { noteId: "stale-cache" });
  // Model a poll that started before acknowledgement and puts its old result
  // after the command invalidated the cache. The six-second TTL bounds this
  // read race; commands must not use that snapshot as mutation input.
  f.cache.set(cacheKey, oldSnapshot);
  f.context.workflowArchiveItem_ = () => ({});
  const submitted = f.command("alice", "note.complete", { noteId: "stale-cache" });
  assert.ok(submitted.note.completionRequestedAt);
  assert.ok(submitted.note.acceptedAt);
  assert.equal(f.cache.has(cacheKey), false);
  assert.equal(f.loadNotes().notes[0].completionRequestedAt, submitted.note.completionRequestedAt);
});

test("large or unavailable read caches do not block authoritative workflow reads", () => {
  const f = fixture();
  const state = { version: 2, details: scope, revision: 1, notes: [f.note("large", { content: "ấ".repeat(31000), creatorEmail: "manager@example.com", acceptedAt: "" })], design: {}, deletedIds: [], requests: [] };
  f.context.workflowWriteProject_(state);
  const cacheKey = f.context.workflowReadCacheKey_(f.context.workflowProjectKey_(scope));
  assert.equal(f.loadNotes().notes[0].content.length, 31000);
  assert.equal(f.cache.has(cacheKey), false, "UTF-8 snapshots over 90KB are not cached");
  f.context.CacheService = { getScriptCache() { throw new Error("Cache unavailable"); } };
  assert.equal(f.loadNotes().notes[0].content.length, 31000);
});

test("corrupted canonical state fails closed instead of migrating an older legacy projection", () => {
  const f = fixture();
  f.command("manager", "note.publish", { note: f.note("do-not-reset") });
  f.loadNotes();
  const key = f.context.workflowProjectKey_(scope);
  f.values.set(`${key}:manifest`, "{corrupted-manifest");
  const before = [...f.values];
  assert.throws(() => f.command("alice", "note.accept", { noteId: "do-not-reset" }), code("STORAGE_CORRUPT"));
  assert.deepEqual([...f.values], before, "failed read cannot overwrite canonical data using a legacy projection");
  f.cache.clear();
  assert.throws(() => f.loadNotes(), code("STORAGE_CORRUPT"));
});

test("missing/corrupt committed chunks and malformed legacy storage do not read as an empty collection", () => {
  const f = fixture();
  f.context.writePropertyJson_("corrupt-chunk", { notes: ["kept"] });
  const manifest = JSON.parse(f.values.get("corrupt-chunk:manifest"));
  const chunkKey = `corrupt-chunk:g:${manifest.generation}:0`;
  f.values.delete(chunkKey);
  assert.throws(() => f.context.readPropertyJson_("corrupt-chunk"), code("STORAGE_CORRUPT"));
  f.values.set(chunkKey, "invalid-json".padEnd(manifest.length, " ").slice(0, manifest.length));
  assert.throws(() => f.context.readPropertyJson_("corrupt-chunk"), code("STORAGE_CORRUPT"));
  f.values.set("legacy-bad:count", "2");
  f.values.set("legacy-bad:0", "[");
  assert.throws(() => f.context.readPropertyJson_("legacy-bad"), code("STORAGE_CORRUPT"));
  f.values.set("legacy-bad:1", "not-json");
  assert.throws(() => f.context.readPropertyJson_("legacy-bad"), code("STORAGE_CORRUPT"));
  assert.equal(f.context.readPropertyJson_("entirely-absent"), null);
  f.context.clearPropertyJson_("corrupt-chunk");
  assert.equal(f.context.readPropertyJson_("corrupt-chunk"), null);
});

test("publishing a reverted dirty design draft advances its acknowledgement revision without resetting acceptance", () => {
  const f = fixture();
  f.command("manager", "design.publish", { kind: "architecture", rows: [{ id: "reverted", content: "Mặt bằng", plannedDate: "30/10/2026", assigneeEmail: "alice@example.com", note: "" }] });
  const accepted = f.command("manager", "design.accept", { kind: "architecture", rowId: "reverted" }).rows[0];
  const dirty = { ...accepted, assignmentDirty: true };
  assert.throws(() => f.command("bob", "design.publish", { kind: "architecture", rows: [dirty] }), code("FORBIDDEN"));
  const published = f.command("manager", "design.publish", { kind: "architecture", rows: [dirty] }).rows[0];
  assert.equal(published.revision, accepted.revision + 1);
  assert.equal(published.acceptedAt, accepted.acceptedAt);
  assert.equal(published.acceptedBy, accepted.acceptedBy);
  assert.equal(published.actualDate, accepted.actualDate);
  assert.equal(Object.hasOwn(published, "assignmentDirty"), false, "canonical rows do not retain the client-only dirty flag");
  assert.throws(() => f.command("manager", "design.publish", { kind: "architecture", rows: [dirty] }), code("CONFLICT"));
  const unchanged = f.command("manager", "design.publish", { kind: "architecture", rows: [published] }).rows[0];
  assert.equal(unchanged.revision, published.revision, "untouched companion rows retain their revision");
});

test("first-time notes and design assignments remain usable when legacy Drive import is denied", () => {
  const f = fixture();
  f.context.clearPropertyJson_(f.context.workNotesPropertyKey_(scope));
  const published = f.command("manager", "note.publish", { note: f.note("first-cache-note") });
  assert.equal(published.note.id, "first-cache-note");
  assert.equal(published.legacyImportPending, true);
  assert.equal(f.driveCalls(), 1, "first publish only attempts the read-only legacy import");
  f.command("alice", "note.accept", { noteId: "first-cache-note" });
  const submitted = f.command("alice", "note.complete", { noteId: "first-cache-note" });
  const completed = f.command("manager", "note.approve", { noteId: "first-cache-note", expectedRevision: submitted.note.revision });
  assert.equal(completed.note.actualDate, "28/10/2026");
  assert.equal(completed.note.archivePending, true);
  assert.equal(completed.legacyImportPending, true);
  assert.equal(f.context.readPropertyJson_(f.context.workNotesPropertyKey_(scope)), null, "canonical writes leave the legacy source untouched");
  assert.deepEqual(plain(f.context.readPropertyJson_("gmcrm-active-work-notes-state")), [], "canonical data is not duplicated into the old active registry");
  const design = fixture();
  design.context.clearPropertyJson_(design.context.workNotesPropertyKey_(scope));
  const issued = design.command("manager", "design.publish", { kind: "architecture", rows: [{ id: "first-cache-design", content: "Thiết kế mặt bằng", assigneeEmail: "alice@example.com", plannedDate: "30/10/2026", note: "" }] });
  assert.equal(issued.rows[0].id, "first-cache-design");
  assert.equal(issued.legacyImportPending, true);
  design.command("manager", "design.accept", { kind: "architecture", rowId: "first-cache-design" });
  const requested = design.command("manager", "design.complete", { kind: "architecture", rowId: "first-cache-design" });
  const finished = design.command("manager", "design.approve", { kind: "architecture", rowId: "first-cache-design", expectedRevision: requested.rows[0].revision });
  assert.equal(finished.rows[0].actualDate, "28/10/2026");
  assert.equal(finished.rows[0].archivePending, true);
  assert.deepEqual(plain(design.context.readPropertyJson_("gmcrm-active-design-tasks-v2")), [], "canonical design tasks do not consume duplicate registry storage");
});

test("deferred legacy import merges unknown notes without overwriting new versions or resurrecting tombstones", () => {
  const f = fixture();
  f.context.clearPropertyJson_(f.context.workNotesPropertyKey_(scope));
  const draft = f.note("same-id", { content: "Bản mới đã xác nhận" });
  f.command("manager", "note.publish", { note: draft, requestId: "first-publish-stable" });
  f.command("alice", "note.accept", { noteId: "same-id" });
  const removed = f.command("manager", "note.publish", { note: f.note("removed-before-import") }).note;
  f.command("manager", "note.delete", { noteId: removed.id, expectedRevision: removed.revision });
  let legacyWrites = 0;
  const legacyNotes = [
    { ...f.note("same-id", { content: "Bản Drive cũ" }), creatorEmail: "admin", acceptedAt: "", actualDate: "" },
    { ...f.note("removed-before-import"), creatorEmail: "creator@example.com", acceptedAt: "", actualDate: "" },
    { ...f.note("legacy-only", { content: "Công việc cũ cần giữ", assigneeEmail: "bob@example.com" }), creatorEmail: "", acceptedAt: "", actualDate: "" },
  ];
  const file = { getBlob: () => ({ getDataAsString: () => JSON.stringify(legacyNotes) }), setContent() { legacyWrites += 1; }, setTrashed() { legacyWrites += 1; } };
  f.context.workNotesFolder_ = (_year, _month, _project, createMissing) => {
    assert.equal(createMissing, false);
    return { getFilesByName: () => { let emitted = false; return { hasNext: () => !emitted, next: () => { emitted = true; return file; } }; } };
  };
  const replay = f.command("manager", "note.publish", { note: draft, requestId: "first-publish-stable" });
  assert.equal(replay.repeated, true);
  assert.equal(replay.legacyImportPending, true, "normal request replays stay off the legacy Drive import path");
  f.command("manager", "archive.retry");
  const stored = f.loadNotes();
  assert.equal(stored.legacyImportPending, false);
  assert.equal(stored.notes.find(note => note.id === "same-id").content, "Bản mới đã xác nhận");
  assert.ok(stored.notes.find(note => note.id === "same-id").acceptedAt);
  assert.ok(f.loadNotes("bob").notes.some(note => note.id === "legacy-only"), "the legacy note survives for its ordinary assignee");
  assert.equal(stored.notes.some(note => note.id === "legacy-only"), false, "no assigning manager is inferred for an ownerless task");
  assert.equal(stored.notes.some(note => note.id === "removed-before-import"), false);
  assert.equal(legacyWrites, 0, "legacy Drive files are never rewritten during import");
  const keys = stored.notes.map(note => note.id);
  f.command("manager", "archive.retry");
  assert.deepEqual(plain(f.loadNotes().notes.map(note => note.id)), plain(keys), "later commands do not import historical notes twice");
});

test("corrupt legacy Properties still block first publication rather than being treated as a Drive import failure", () => {
  const f = fixture();
  const key = f.context.workNotesPropertyKey_(scope);
  f.values.set(`${key}:manifest`, "not-json");
  const before = [...f.values];
  assert.throws(() => f.command("manager", "note.publish", { note: f.note("must-not-ack") }), code("STORAGE_CORRUPT"));
  assert.deepEqual([...f.values], before);
  assert.equal(f.driveCalls(), 0);
});

test("an ambiguous manifest RPC acknowledgement never deletes potentially published chunks", () => {
  for (const loseCommitRead of [false, true]) {
    const values = new Map();
    let fail = false;
    let readUnavailable = false;
    const properties = {
      getProperty(key) { if (readUnavailable && key.endsWith(":manifest")) throw new Error("Read acknowledgement unavailable"); return values.get(key) ?? null; },
      setProperty(key, value) {
        values.set(key, String(value));
        if (fail && key.endsWith(":manifest")) { readUnavailable = loseCommitRead; throw new Error("Commit succeeded but RPC timed out"); }
      },
      deleteProperty(key) { values.delete(key); },
    };
    const context = vm.createContext({ console, PropertiesService: { getScriptProperties: () => properties } });
    vm.runInContext(source, context);
    context.writePropertyJson_("ambiguous-cache", { revision: 1, content: "Cũ" });
    const next = { revision: 2, content: "Dữ liệu mới".repeat(3000) };
    fail = true;
    if (loseCommitRead) assert.throws(() => context.writePropertyJson_("ambiguous-cache", next), code("RETRYABLE"));
    else assert.doesNotThrow(() => context.writePropertyJson_("ambiguous-cache", next));
    readUnavailable = false;
    assert.deepEqual(plain(context.readPropertyJson_("ambiguous-cache")), next, "a committed head always retains its complete generation");
  }
});

test("customer deletion/recreation masks old canonical and legacy jobs without resetting a normal create retry", () => {
  for (const variant of ["same-project", "different-project", "cleanup-retry"]) {
    const f = fixture();
    f.command("manager", "note.publish", { note: f.note("old-customer-note") });
    const oldDesign = f.command("manager", "design.publish", { kind: "architecture", rows: [{ id: "old-customer-design", content: "Thiết kế cũ", assigneeEmail: "alice@example.com", plannedDate: "30/10/2026", note: "" }] }).rows[0];
    f.context.writePropertyJson_("gmcrm-active-design-tasks-v2", [{ ...oldDesign, ...scope, kind: "architecture" }]);
    const folders = new Map();
    const iterator = items => { let index = 0; return { hasNext: () => index < items.length, next: () => items[index++] }; };
    const folder = (name, id, children = []) => {
      const value = {
        name, id, children, trashed: false,
        getName() { return this.name; }, getId() { return this.id; }, getUrl() { return `https://drive.google.com/drive/folders/${this.id}`; },
        getDateCreated: () => new Date("2026-10-01T00:00:00Z"), getFolders() { return iterator(this.children.filter(child => !child.trashed)); },
        getFiles: () => iterator([]), getFilesByName: () => iterator([]), setTrashed(trashed) { this.trashed = trashed; }, isTrashed() { return this.trashed; },
        createFolder(nextName) { const created = folder(nextName, `qa-folder-${randomUUID()}`); this.children.push(created); return created; },
      };
      folders.set(id, value);
      return value;
    };
    const oldFolder = folder(scope.houseId, "qa-old-customer-folder");
    const month = folder("T10", "qa-month", [oldFolder]);
    const year = folder("2026", "qa-year", [month]);
    const customers = folder("Khách hàng", "qa-customers", [year]);
    const root = folder("GM Manager", "qa-root", [customers]);
    f.context.rootFolder_ = () => root;
    f.context.DriveApp = { getFolderById(id) { const found = folders.get(id); if (!found) throw new Error("Missing folder"); return found; } };
    f.context.ensureProjectFolders_ = () => {};
    const reset = f.context.workflowResetCustomerProject_;
    if (variant === "cleanup-retry") f.context.workflowResetCustomerProject_ = () => { throw new Error("Canonical cleanup quota unavailable"); };
    const deleted = f.context.deleteCustomerFolder_({ ...scope, folderId: oldFolder.id, adminSessionToken: f.admin.adminSessionToken, mutationId: `qa-customer-delete-${variant}` });
    assert.equal(deleted.trashed, true, "confirmed Drive deletion survives a best-effort canonical cleanup failure");
    assert.equal(f.context.loadAssignedWorkNotes_({ workflowSessionToken: f.tokens.manager }).notes.length, 0);
    const recreatedScope = { ...scope, projectId: variant === "different-project" ? "GM-QA-RECREATED" : scope.projectId };
    const createPayload = { ...recreatedScope, adminSessionToken: f.admin.adminSessionToken };
    if (variant === "cleanup-retry") {
      assert.throws(() => f.context.createCustomerFolder_(createPayload), /cleanup quota/);
      assert.equal(f.context.isCustomerDriveRecordDeleted_(scope), true, "failed strict recreation leaves the old Drive deletion mask in place");
    }
    f.context.workflowResetCustomerProject_ = reset;
    f.context.createCustomerFolder_(createPayload);
    assert.equal(f.context.workflowReadProject_(recreatedScope).customerDeleted, false);
    if (variant === "different-project") assert.equal(f.context.workflowReadProject_(scope).customerDeleted, true, "a reused house code cannot unmask a different old project");
    assert.equal(f.context.loadAssignedWorkNotes_({ workflowSessionToken: f.tokens.manager }).notes.length, 0);
    assert.equal(f.context.loadAssignedDesignTasks_({ workflowSessionToken: f.tokens.manager }).tasks.length, 0, "the blank canonical index masks untouched legacy registry rows");
    const protectedOldRows = f.context.workflowProtectWorkspace_([{ year: 2026, months: [{ label: "T10", records: [{ ...recreatedScope, designProgress: [oldDesign] }] }] }]);
    assert.deepEqual(plain(protectedOldRows[0].months[0].records[0].designProgress), [], "stale workspace data cannot reintroduce old published design rows");
    const newJob = f.command("manager", "note.publish", { ...recreatedScope, note: f.note("new-customer-note") });
    const beforeRetryRevision = newJob.revision;
    f.context.createCustomerFolder_(createPayload);
    const afterRetry = f.context.loadWorkNotes_({ ...recreatedScope, workflowSessionToken: f.tokens.manager });
    assert.deepEqual(plain(afterRetry.notes.map(note => note.id)), ["new-customer-note"]);
    assert.equal(afterRetry.revision, beforeRetryRevision, "a normal create retry never resets active new jobs");
  }
});

test("note and message-assignment hot paths do not read/write global workspace or unrelated project states", () => {
  const f = fixture();
  f.command("manager", "note.publish", { note: f.note("hotpath-edit") });
  f.command("manager", "note.publish", { note: f.note("hotpath-delete") });
  const unrelated = { ...scope, projectId: "GM-QA-UNRELATED", houseId: "QA-OTHER" };
  f.context.workflowResetCustomerProject_(unrelated, false);
  const workspace = f.context.readPropertyJson_("gmcrm-workspace-cache-v1");
  workspace.years[0].months[9].records.push({ ...unrelated, details: {}, designProgress: [] });
  f.context.writePropertyJson_("gmcrm-workspace-cache-v1", workspace);
  const group = f.message("hotpath-message");
  f.context.workflowIngestMessages_([group]);
  const unrelatedKey = f.context.workflowProjectKey_(unrelated);
  let archiveAttempts = 0;
  f.context.workflowArchiveItem_ = () => { archiveAttempts += 1; return {}; };
  const measure = action => {
    f.propertyReads.length = 0;
    f.propertyWrites.length = 0;
    const result = action();
    assert.equal(f.propertyReads.some(key => key.startsWith("gmcrm-workspace-cache-v1:")), false, "note commands do not parse the global workspace");
    assert.equal(f.propertyWrites.some(key => key.startsWith("gmcrm-workspace-cache-v1:")), false, "note commands do not rewrite the global workspace");
    assert.equal(f.propertyReads.some(key => key.startsWith(`${unrelatedKey}:`)), false, "note commands do not scan another project's design state");
    assert.equal(f.driveCalls(), 0, "known canonical note mutations do not depend on legacy Drive reads");
    return result;
  };
  const published = measure(() => f.command("manager", "note.publish", { note: f.note("hotpath-new") }));
  measure(() => f.command("manager", "note.edit", { note: { ...published.note, content: "Nội dung cập nhật" }, expectedRevision: published.note.revision }));
  measure(() => f.command("alice", "note.accept", { noteId: "hotpath-new" }));
  const submitted = measure(() => f.command("alice", "note.complete", { noteId: "hotpath-new" }));
  assert.equal(archiveAttempts, 0, "pending review does not archive");
  measure(() => f.command("manager", "note.approve", { noteId: "hotpath-new", expectedRevision: submitted.note.revision }));
  assert.equal(archiveAttempts, 1, "approval still runs its explicit archival step");
  measure(() => f.command("manager", "note.delete", { noteId: "hotpath-delete", expectedRevision: 1 }));
  const assigned = measure(() => f.command("manager", "message.assign", { messageId: group.id, selectedLineIds: ["line-one"], assignment: f.note("hotpath-assigned") }));
  assert.equal(assigned.note.sourceMessageId, group.id);
});

test("design projections update only their target record and survive optional cache failure", () => {
  const f = fixture();
  f.command("manager", "note.publish", { note: f.note("known-project") });
  const unrelated = { ...scope, projectId: "GM-QA-DESIGN-UNRELATED", houseId: "QA-OTHER" };
  f.context.workflowResetCustomerProject_(unrelated, false);
  const workspace = f.context.readPropertyJson_("gmcrm-workspace-cache-v1");
  const otherRecord = { ...unrelated, details: { preserved: "Giữ nguyên" }, designProgress: [{ id: "other-draft", content: "Hạng mục nhà khác", plannedDate: "", assigneeEmail: "", publishedAt: "" }] };
  workspace.years[0].months[9].records.push(otherRecord);
  f.context.writePropertyJson_("gmcrm-workspace-cache-v1", workspace);
  const unrelatedKey = f.context.workflowProjectKey_(unrelated);
  f.propertyReads.length = 0;
  f.propertyWrites.length = 0;
  f.context.CacheService = { getScriptCache() { throw new Error("Cache temporarily unavailable"); } };
  const published = f.command("manager", "design.publish", { kind: "architecture", rows: [{ id: "target-design", content: "Mặt bằng", plannedDate: "30/10/2026", assigneeEmail: "alice@example.com", note: "" }] });
  assert.equal(published.rows[0].id, "target-design");
  assert.equal(f.propertyReads.some(key => key.startsWith(`${unrelatedKey}:`)), false, "design projection does not load unrelated canonical states");
  assert.ok(f.propertyWrites.some(key => key.startsWith("gmcrm-workspace-cache-v1:")));
  const stored = f.context.readPropertyJson_("gmcrm-workspace-cache-v1");
  assert.equal(stored.years[0].months[9].records[0].designProgress[0].id, "target-design");
  assert.deepEqual(plain(stored.years[0].months[9].records[1]), otherRecord);
});

test("assigned feeds include removal revisions and the selected project snapshot without reading it twice", () => {
  const f = fixture();
  const published = f.command("manager", "note.publish", { note: f.note("remote-change") });
  const key = f.context.workflowProjectKey_(scope);
  f.propertyReads.length = 0;
  const first = f.context.loadAssignedWorkNotes_({ workflowSessionToken: f.tokens.alice, project: scope });
  assert.equal(f.propertyReads.filter(read => read === `${key}:manifest`).length, 1, "selected project snapshot reuses the queue's existing canonical read");
  assert.deepEqual(plain(Object.keys(first.projectRevisions[0]).sort()), ["month", "projectId", "revision", "year"]);
  assert.equal(first.projectSnapshot.notes[0].id, "remote-change");
  assert.equal(first.projectSnapshot.revision, first.projectRevisions[0].revision);
  const reassigned = f.command("manager", "note.edit", { note: { ...published.note, assigneeEmail: "bob@example.com" }, expectedRevision: published.note.revision });
  const removedFromAlice = f.context.loadAssignedWorkNotes_({ workflowSessionToken: f.tokens.alice, project: scope });
  assert.deepEqual(plain(removedFromAlice.notes), []);
  assert.deepEqual(plain(removedFromAlice.projectSnapshot.notes), []);
  assert.equal(removedFromAlice.projectRevisions[0].revision, reassigned.revision, "zero-active feed still invalidates a previous employee's cached assignment");
  const bob = f.context.loadAssignedWorkNotes_({ workflowSessionToken: f.tokens.bob, project: scope });
  assert.equal(bob.notes[0].id, "remote-change");
  assert.equal(bob.projectSnapshot.notes[0].assigneeEmail, "bob@example.com");
  const deleted = f.command("manager", "note.delete", { noteId: "remote-change", expectedRevision: reassigned.note.revision });
  const removedFromBob = f.context.loadAssignedWorkNotes_({ workflowSessionToken: f.tokens.bob, project: scope });
  assert.deepEqual(plain(removedFromBob.notes), []);
  assert.equal(removedFromBob.projectRevisions[0].revision, deleted.revision);
  assert.deepEqual(plain(removedFromBob.projectSnapshot.deletedIds), ["remote-change"]);
  assert.throws(() => f.context.loadAssignedWorkNotes_({ email: "admin", project: scope }), code("AUTH_REQUIRED"));
  const completed = fixture();
  completed.command("manager", "note.publish", { note: completed.note("completed-history") });
  completed.command("alice", "note.accept", { noteId: "completed-history" });
  completed.context.workflowArchiveItem_ = () => ({});
  const submitted = completed.command("alice", "note.complete", { noteId: "completed-history" });
  completed.command("manager", "note.approve", { noteId: "completed-history", expectedRevision: submitted.note.revision });
  const snapshot = completed.context.loadAssignedWorkNotes_({ workflowSessionToken: completed.tokens.alice, project: scope });
  assert.deepEqual(plain(snapshot.notes), []);
  assert.equal(snapshot.projectSnapshot.notes[0].actualDate, "28/10/2026", "the same feed preserves completed history in the open project for two days");
});

test("a newly created empty customer seeds canonical cache before its first note/design publish", () => {
  const f = fixture();
  const newScope = { ...scope, projectId: "GM-QA-BRAND-NEW", houseId: "QA-NEW" };
  const root = {}, customers = {}, year = {}, month = {};
  const created = { getId: () => "qa-brand-new-folder", getName: () => newScope.houseId, getUrl: () => "https://drive.google.com/drive/folders/qa-brand-new-folder" };
  f.context.rootFolder_ = () => root;
  f.context.findFolder_ = () => null;
  f.context.getOrCreateFolder_ = (parent, name) => {
    if (parent === root && name === "Khách hàng") return customers;
    if (parent === customers && name === "2026") return year;
    if (parent === year && name === "T10") return month;
    if (parent === month && name === newScope.houseId) return created;
    throw new Error("unexpected folder creation");
  };
  f.context.ensureProjectFolders_ = () => {};
  let legacyReads = 0;
  f.context.workNotesFolder_ = () => { legacyReads += 1; throw new Error("DriveApp access denied"); };
  f.context.createCustomerFolder_({ ...newScope, adminSessionToken: f.admin.adminSessionToken });
  const blank = f.context.workflowReadProject_(newScope);
  assert.ok(blank);
  assert.equal(blank.legacyImportPending, false);
  assert.deepEqual(plain(blank.notes), []);
  const design = f.command("manager", "design.publish", { ...newScope, kind: "architecture", rows: [{ id: "brand-new-design", content: "Mặt bằng mới", plannedDate: "30/10/2026", assigneeEmail: "alice@example.com", note: "" }] });
  assert.equal(design.rows[0].id, "brand-new-design");
  const note = f.command("manager", "note.publish", { ...newScope, note: f.note("brand-new-note") });
  assert.equal(note.note.id, "brand-new-note");
  assert.equal(note.legacyImportPending, false);
  assert.equal(legacyReads, 0, "the server's known-empty customer does not inspect Drive on first publication");
});
