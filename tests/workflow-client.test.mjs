import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

const source = await readFile(new URL("../app/workflow-client.ts", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "ts", format: "esm", target: "es2020" });
const { createWorkflowClient, WorkflowCommandError, parseWorkflowDate, vietnamDayNumber, workflowStatus, keepCompletedWorkflow, mergeWorkflowSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const identity = { account: "staff@example.com", scriptUrl: "https://script.google.com/example/exec", token: "private-token" };
const storage = () => { const values = new Map(); return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
const nativeStorage = () => { const port = storage(); return { ...port, get length() { return port.values.size; }, key: (index) => [...port.values.keys()][index] ?? null, removeItem: (key) => port.values.delete(key) }; };
const deferred = () => { let resolve; const promise = new Promise((done) => resolve = done); return { promise, resolve }; };
const fixture = (options = {}) => {
  let sequence = 0; const port = options.storage ?? storage(); const results = [];
  const client = createWorkflowClient({ storage: port, send: async () => ({ ok: true }), makeId: () => `request-${++sequence}`, onResult: (...args) => results.push(args), ...options });
  client.resumeForAccount(identity); return { client, port, results };
};
const command = { operation: "note.accept", noteId: "n1", year: 2026, month: 10, projectId: "DV-75" };

test("intent is durable before sending, deduplicated while pending and never stores credentials", async () => {
  const gate = deferred(); const sent = [];
  const f = fixture({ send: async (wire, actor) => { sent.push([wire, actor]); return gate.promise; } });
  try {
    const entry = f.client.enqueue("2026:10:DV-75", { ...command, workflowSessionToken: "should-not-persist" }, "accept-n1");
    assert.ok([...f.port.values.values()][0].includes(entry.requestId));
    assert.ok(![...f.port.values.values()][0].includes("private-token"));
    assert.ok(![...f.port.values.values()][0].includes("should-not-persist"));
    assert.equal(sent.length, 0);
    assert.equal(f.client.enqueue(entry.scope, command, "accept-n1").requestId, entry.requestId);
    assert.throws(() => f.client.enqueue(entry.scope, { ...command, noteId: "different" }, "accept-n1"), /nội dung khác/);
    const execution = f.client.execute(entry.requestId);
    assert.equal(sent.length, 1); assert.equal(f.results.length, 0);
    assert.equal(sent[0][0].workflowSessionToken, identity.token);
    gate.resolve({ ok: true, note: { id: "n1", acceptedAt: "server-date" } });
    assert.equal((await execution).note.acceptedAt, "server-date");
    assert.equal(f.results.length, 1); assert.deepEqual(f.client.pending(), []);
  } finally { f.client.dispose(); }
});

test("storage failures prevent network and preserve the user's unsent intent", async () => {
  let sent = 0; const f = fixture({ storage: { getItem: () => null, setItem: () => { throw new Error("quota"); } }, send: async () => { sent++; return { ok: true }; } });
  try { assert.throws(() => f.client.enqueue("house", command), /quota/); assert.equal(sent, 0); assert.equal(f.client.pending().length, 0); }
  finally { f.client.dispose(); }
});

test("same project commands serialize while an independent project can complete", async () => {
  const gate = deferred(); const sent = [];
  const f = fixture({ send: async (wire) => { sent.push(wire.noteId); if (wire.noteId === "first") return gate.promise; return { ok: true, id: wire.noteId }; } });
  try {
    const first = f.client.enqueue("house-a", { ...command, noteId: "first" });
    const second = f.client.enqueue("house-a", { ...command, noteId: "second" });
    const other = f.client.enqueue("house-b", { ...command, noteId: "other" });
    const running = f.client.execute(first.requestId);
    assert.equal((await f.client.execute(other.requestId)).id, "other");
    assert.deepEqual(sent, ["first", "other"]);
    gate.resolve({ ok: true, id: "first" }); await running;
    assert.deepEqual(sent, ["first", "other", "second"]);
    assert.equal((await f.client.execute(second.requestId)).id, "second");
  } finally { f.client.dispose(); }
});

test("storage failure after server success preserves the original ID for a safe manual retry", async () => {
  const port = storage(); const originalWrite = port.setItem; let fail = false; const sent = [];
  port.setItem = (key, value) => { if (fail) throw new Error("quota"); originalWrite(key, value); };
  const f = fixture({ storage: port, send: async (wire) => { sent.push(wire.requestId); fail = true; return { ok: true }; } });
  try {
    const entry = f.client.enqueue("house", command);
    await assert.rejects(f.client.execute(entry.requestId), (error) => error.entry.code === "LOCAL_STORAGE");
    assert.equal(f.client.pending()[0].state, "blocked"); assert.equal(f.results.length, 0);
    assert.ok([...port.values.values()][0].includes(entry.requestId));
    fail = false; assert.equal(f.client.retry(entry.requestId), true);
    // Simulate the idempotent server replay without causing another quota error.
    f.client.dispose();
    const resumed = fixture({ storage: port, send: async (wire) => { sent.push(wire.requestId); return { ok: true, repeated: true }; } });
    try { await resumed.client.flush(); assert.deepEqual(sent, [entry.requestId, entry.requestId]); }
    finally { resumed.client.dispose(); }
  } finally { f.client.dispose(); }
});

test("offline reload preserves the request ID and binds recovery to account plus backend", async () => {
  const port = storage(); const first = fixture({ storage: port, isOnline: () => false });
  const entry = first.client.enqueue("house", command); first.client.dispose();
  const sent = []; const recovered = fixture({ storage: port, isOnline: () => true, send: async (wire) => { sent.push(wire); return { ok: true }; } });
  try {
    recovered.client.resumeForAccount({ ...identity, account: "other@example.com" }); await recovered.client.flush(); assert.equal(sent.length, 0);
    recovered.client.resumeForAccount({ ...identity, scriptUrl: "https://script.google.com/different/exec" }); await recovered.client.flush(); assert.equal(sent.length, 0);
    recovered.client.resumeForAccount(identity); await recovered.client.flush();
    assert.equal(sent[0].requestId, entry.requestId); assert.equal(recovered.client.pending().length, 0);
  } finally { recovered.client.dispose(); }
});

test("separate tabs keep independent durable intents and observe acknowledgements without resurrection", async () => {
  const port = nativeStorage(); const first = fixture({ storage: port, makeId: () => "tab-a", isOnline: () => false });
  const second = fixture({ storage: port, makeId: () => "tab-b", isOnline: () => false });
  try {
    const a = first.client.enqueue("house-a", { ...command, noteId: "a" });
    const b = second.client.enqueue("house-b", { ...command, noteId: "b" });
    assert.equal(port.values.size, 2); assert.ok([...port.values.keys()].every((key) => key.startsWith("gm-manager-workflow-outbox-v1:command:")));
    first.client.refresh(); assert.equal(first.client.pending().length, 2);
    assert.equal(first.client.discard(a.requestId), true);
    second.client.refresh(); assert.deepEqual(second.client.pending().map((entry) => entry.requestId), [b.requestId]);
    assert.equal(second.client.discard(b.requestId), true); first.client.refresh();
    assert.equal(first.client.pending().length, 0); assert.equal(port.values.size, 0);
  } finally { first.client.dispose(); second.client.dispose(); }
});

test("an old tab never resends an acknowledged command even before receiving a storage event", async () => {
  let online = false;
  const port = nativeStorage(); const offline = fixture({ storage: port, makeId: () => "known-request", isOnline: () => online, send: async () => { throw new Error("old tab must never resend"); } });
  const entry = offline.client.enqueue("house", command);
  let sent = 0; const active = fixture({ storage: port, send: async () => { sent++; return { ok: true }; } });
  try {
    await active.client.flush(); assert.equal(sent, 1); assert.equal(port.values.size, 0);
    online = true;
    await assert.rejects(offline.client.execute(entry.requestId), (error) => error.entry.code === "ALREADY_SETTLED");
    offline.client.resumeForAccount(identity); offline.client.refresh();
    assert.equal(offline.client.pending().length, 0);
  } finally { offline.client.dispose(); active.client.dispose(); }
});

test("a peer acknowledgement during key enumeration is harmless while malformed stored records fail closed", () => {
  const port = nativeStorage();
  const original = fixture({ storage: port, isOnline: () => false });
  original.client.enqueue("house", command); original.client.dispose();
  const read = port.getItem; let removed = false;
  port.getItem = (key) => {
    if (!removed && key.startsWith("gm-manager-workflow-outbox-v1:command:")) { removed = true; port.removeItem(key); return null; }
    return read(key);
  };
  let recovered;
  assert.doesNotThrow(() => { recovered = fixture({ storage: port, isOnline: () => false }); });
  try { assert.equal(removed, true); assert.equal(recovered.client.pending().length, 0); }
  finally { recovered.client.dispose(); }
  const malformed = nativeStorage();
  const key = "gm-manager-workflow-outbox-v1:command:broken";
  malformed.setItem(key, '{"version":1,"entry":');
  assert.throws(() => fixture({ storage: malformed, isOnline: () => false }), SyntaxError);
  assert.equal(malformed.getItem(key), '{"version":1,"entry":', "corrupt intent remains available for recovery");
});

test("lost transport retries the same command ID; validation/conflict blocks the lane", async () => {
  let clock = 1000; let attempts = 0; const sent = [];
  const f = fixture({ now: () => clock, send: async (wire) => { sent.push(wire.requestId); if (++attempts === 1) throw new TypeError("network unavailable"); return { ok: true }; } });
  try {
    const entry = f.client.enqueue("house", command);
    await assert.rejects(f.client.execute(entry.requestId), (error) => error instanceof WorkflowCommandError && error.state === "retrying");
    assert.equal(f.client.pending()[0].nextAttemptAt, 2000);
    clock = 2000; await f.client.flush(); assert.deepEqual(sent, [entry.requestId, entry.requestId]);
  } finally { f.client.dispose(); }
  for (const code of ["AUTH_REQUIRED", "VALIDATION", "CONFLICT"]) {
    let calls = 0; const blocked = fixture({ send: async () => { calls++; return { ok: false, error: "Server explanation", code }; } });
    try {
      const first = blocked.client.enqueue("house", command);
      blocked.client.enqueue("house", { ...command, noteId: "later" });
      await assert.rejects(blocked.client.execute(first.requestId), /Server explanation/);
      await blocked.client.flush(); assert.equal(calls, 1);
      assert.equal(blocked.client.pending()[0].state, code === "CONFLICT" ? "conflict" : "blocked");
      assert.equal(blocked.client.discard(first.requestId), true);
    } finally { blocked.client.dispose(); }
  }
});

test("HTTP5xx retries but HTTP4xx and repeated transport failure stop automatically", async () => {
  for (const status of [403, 409, 429, 500, 503]) {
    const f = fixture({ send: async () => ({ ok: false, status, error: "HTTP error" }) });
    try {
      const entry = f.client.enqueue("house", command); await assert.rejects(f.client.execute(entry.requestId));
      assert.equal(f.client.pending()[0].state, status >= 500 ? "retrying" : "blocked");
    } finally { f.client.dispose(); }
  }
  let clock = 0; const f = fixture({ now: () => clock, send: async () => { throw new Error("offline"); } });
  try {
    f.client.enqueue("house", command);
    for (let attempt = 0; attempt < 8; attempt++) { await f.client.flush(); clock = f.client.pending()[0].nextAttemptAt; }
    assert.equal(f.client.pending()[0].state, "blocked"); assert.equal(f.client.pending()[0].code, "RETRY_LIMIT");
  } finally { f.client.dispose(); }
  for (const code of ["SERVER_ERROR", "RETRYABLE"]) {
    const bridgeFailure = fixture({ send: async () => ({ ok: false, code, error: "Apps Script temporary failure" }) });
    try {
      const entry = bridgeFailure.client.enqueue("house", command);
      await assert.rejects(bridgeFailure.client.execute(entry.requestId));
      assert.equal(bridgeFailure.client.pending()[0].state, "retrying");
    } finally { bridgeFailure.client.dispose(); }
  }
});

test("an in-flight response from another login cannot update the current user's UI", async () => {
  const gate = deferred(); const f = fixture({ send: async () => gate.promise });
  try {
    const entry = f.client.enqueue("house", command); const running = f.client.execute(entry.requestId);
    assert.equal(f.client.discard(entry.requestId), false);
    f.client.resumeForAccount({ ...identity, account: "other@example.com" }); gate.resolve({ ok: true }); await running;
    assert.equal(f.results.length, 0); assert.equal(f.client.pending().length, 0);
  } finally { f.client.dispose(); }
});

test("strict dates and deadline colors use Vietnam's calendar at the UTC boundary", () => {
  assert.equal(parseWorkflowDate("31/02/2026"), null); assert.equal(parseWorkflowDate("29/02/2025"), null); assert.ok(parseWorkflowDate("29/02/2028"));
  const instant = Date.parse("2026-10-28T17:01:00Z");
  assert.equal(vietnamDayNumber(instant), parseWorkflowDate("29/10/2026"));
  assert.equal(workflowStatus({ dueDate: "01/11/2026" }, instant), "Đen");
  for (const [date, color] of [["28/10/2026", "Tím"], ["29/10/2026", "Đỏ"], ["01/11/2026", "Đỏ"], ["02/11/2026", "Cam"], ["05/11/2026", "Cam"], ["06/11/2026", "Xanh"]]) assert.equal(workflowStatus({ acceptedAt: "accepted", dueDate: date }, instant), color);
});

test("retention never hides an unarchived completion; older snapshots cannot resurrect deleted work", () => {
  const completedAt = "2026-10-20T00:00:00Z"; const now = Date.parse("2026-10-28T00:00:00Z");
  assert.equal(keepCompletedWorkflow({ completedAt }, now), true);
  assert.equal(keepCompletedWorkflow({ completedAt, archivePending: true, archivedAt: completedAt }, now), true);
  assert.equal(keepCompletedWorkflow({ completedAt, archivedAt: completedAt }, now), false);
  const current = { revision: 5, items: [], deleted: [{ id: "deleted", revision: 5 }] };
  assert.equal(mergeWorkflowSnapshot(current, { revision: 4, items: [{ id: "deleted", revision: 4 }] }), current);
  assert.deepEqual(mergeWorkflowSnapshot(current, { revision: 6, items: [{ id: "deleted", revision: 3 }, { id: "kept", revision: 6 }] }).items.map((item) => item.id), ["kept"]);
});
