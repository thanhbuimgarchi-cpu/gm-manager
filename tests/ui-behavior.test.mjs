import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transform } from "esbuild";

// Execute the real frontend helpers without mounting React or contacting the
// production backend. This protects data behavior during interface changes.
const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const { code } = await transform(`${source}\nexport { uniqueCustomerProjectId, compareOutstandingWorkNotes, mergeWorkNotesForSync, reconcileWorkNoteEdit, parseDesignDate, saveWorkspace };`, {
  loader: "tsx",
  format: "cjs",
  define: { "import.meta.env": JSON.stringify({ VITE_APP_VERSION: "test", BASE_URL: "/" }) },
});
const exports = {};
const context = vm.createContext({ module: { exports }, exports, require: () => ({}), console, Date, Intl, URL, Set, Map });
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
