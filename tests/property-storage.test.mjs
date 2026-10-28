import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../apps-script/Code.js", import.meta.url), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));

function fixture({ totalLimit = Infinity } = {}) {
  const values = new Map();
  const hooks = { get: null, set: null, delete: null };
  const writes = [];
  const properties = {
    getProperty(key) { hooks.get?.(key); return values.has(key) ? values.get(key) : null; },
    setProperty(key, value) {
      hooks.set?.(key, value);
      const text = String(value);
      if (Buffer.byteLength(text, "utf8") > 9000) throw new Error("Property exceeds 9 KB");
      const total = [...values.entries()].reduce((size, [existing, content]) => existing === key ? size : size + Buffer.byteLength(existing + content, "utf8"), 0) + Buffer.byteLength(key + text, "utf8");
      if (total > totalLimit) throw new Error("Property storage quota exceeded");
      values.set(key, text); writes.push({ key, value: text }); return this;
    },
    deleteProperty(key) { hooks.delete?.(key); values.delete(key); return this; },
  };
  const result = vm.createContext({ console, PropertiesService: { getScriptProperties: () => properties } });
  vm.runInContext(source, result);
  return { context: result, values, hooks, writes };
}

test("a midway chunk write failure retains the last complete canonical snapshot", () => {
  const f = fixture();
  const before = { revision: 1, notes: [{ id: "note-old", content: "Dữ liệu đã xác nhận" }] };
  f.context.writePropertyJson_("qa-cache", before);
  const head = f.values.get("qa-cache:manifest");
  const originalKeys = [...f.values.keys()].sort();
  f.hooks.set = key => { if (key.startsWith("qa-cache:g:") && key.endsWith(":1")) throw new Error("Injected quota interruption"); };
  assert.throws(() => f.context.writePropertyJson_("qa-cache", { revision: 2, content: "x".repeat(30_000) }));
  assert.equal(f.values.get("qa-cache:manifest"), head);
  assert.deepEqual(plain(f.context.readPropertyJson_("qa-cache")), before);
  assert.deepEqual([...f.values.keys()].sort(), originalKeys, "uncommitted chunks are removed");
});

test("manifest commit failure never publishes partially written replacement chunks", () => {
  const f = fixture();
  const before = { revision: 1, data: "original" };
  f.context.writePropertyJson_("qa-cache", before);
  const head = f.values.get("qa-cache:manifest");
  f.hooks.set = key => { if (key === "qa-cache:manifest") throw new Error("Injected pointer failure"); };
  assert.throws(() => f.context.writePropertyJson_("qa-cache", { revision: 2, data: "replacement".repeat(2000) }));
  assert.equal(f.values.get("qa-cache:manifest"), head);
  assert.deepEqual(plain(f.context.readPropertyJson_("qa-cache")), before);
});

test("Vietnamese and emoji data round-trip under the real per-property byte limit", () => {
  const f = fixture();
  const value = { revision: 7, content: "Người phụ trách đã hoàn thành 🏡✅ ".repeat(1500) };
  f.context.writePropertyJson_("qa-vietnamese", value);
  assert.deepEqual(plain(f.context.readPropertyJson_("qa-vietnamese")), value);
  const chunks = [...f.values.entries()].filter(([key]) => key.startsWith("qa-vietnamese:g:"));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(([, text]) => Buffer.byteLength(text, "utf8") <= 8000));
  assert.ok(chunks.every(([, text]) => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(text)), "chunk boundaries never split a Unicode surrogate pair");
});

test("total storage exhaustion fails safely and permits a later smaller write", () => {
  const f = fixture({ totalLimit: 500_000 });
  const old = { revision: 1, content: "a".repeat(260_000) };
  f.context.writePropertyJson_("qa-large", old);
  assert.throws(() => f.context.writePropertyJson_("qa-large", { revision: 2, content: "b".repeat(260_000) }));
  assert.deepEqual(plain(f.context.readPropertyJson_("qa-large")), old);
  const smaller = { revision: 2, content: "b".repeat(5000) };
  f.context.writePropertyJson_("qa-large", smaller);
  assert.deepEqual(plain(f.context.readPropertyJson_("qa-large")), smaller);
});

test("legacy snapshots migrate atomically and cleanup failure cannot invalidate the new generation", () => {
  const f = fixture();
  const old = { revision: 1, content: "legacy" };
  const text = JSON.stringify(old);
  f.values.set("qa-legacy:count", "2");
  f.values.set("qa-legacy:0", text.slice(0, 10));
  f.values.set("qa-legacy:1", text.slice(10));
  assert.deepEqual(plain(f.context.readPropertyJson_("qa-legacy")), old);
  f.hooks.delete = key => { if (key === "qa-legacy:0") throw new Error("Cleanup unavailable"); };
  const next = { revision: 2, content: "migrated" };
  f.context.writePropertyJson_("qa-legacy", next);
  assert.equal(JSON.parse(f.values.get("qa-legacy:manifest")).version, 2);
  assert.deepEqual(plain(f.context.readPropertyJson_("qa-legacy")), next);
  assert.ok(f.values.has("qa-legacy:0"), "failed legacy cleanup is harmless");
});

test("a reader racing old-generation cleanup retries the new committed generation", () => {
  const f = fixture();
  f.context.writePropertyJson_("qa-race", { revision: 1, content: "old".repeat(6000) });
  const oldHead = JSON.parse(f.values.get("qa-race:manifest"));
  const firstOldChunk = `qa-race:g:${oldHead.generation}:0`;
  let changed = false;
  const next = { revision: 2, content: "new".repeat(6000) };
  f.hooks.get = key => {
    if (changed || key !== firstOldChunk) return;
    changed = true;
    f.context.writePropertyJson_("qa-race", next);
  };
  assert.deepEqual(plain(f.context.readPropertyJson_("qa-race")), next);
  assert.equal(changed, true);
});

test("a reader racing legacy migration never returns concatenated or partial JSON", () => {
  const f = fixture();
  f.values.set("qa-migration:count", "1");
  f.values.set("qa-migration:0", JSON.stringify({ revision: 1, content: "legacy" }));
  let changed = false;
  const next = { revision: 2, content: "new canonical" };
  f.hooks.get = key => {
    if (changed || key !== "qa-migration:0") return;
    changed = true;
    f.context.writePropertyJson_("qa-migration", next);
  };
  assert.deepEqual(plain(f.context.readPropertyJson_("qa-migration")), next);
});

test("clear commits a tombstone before cleanup so leftover legacy or generation chunks cannot resurrect", () => {
  const f = fixture();
  f.context.writePropertyJson_("qa-deleted", { revision: 4, content: "deleted note" });
  f.values.set("qa-deleted:count", "1");
  f.values.set("qa-deleted:0", JSON.stringify({ revision: 1, content: "stale legacy" }));
  f.hooks.delete = () => { throw new Error("Injected cleanup failure"); };
  f.context.clearPropertyJson_("qa-deleted");
  assert.equal(JSON.parse(f.values.get("qa-deleted:manifest")).deleted, true);
  assert.equal(f.context.readPropertyJson_("qa-deleted"), null);
  assert.ok(f.values.has("qa-deleted:0"));
});

test("clear pointer failure leaves the previous snapshot readable", () => {
  const f = fixture();
  const before = { revision: 4, content: "keep if clear fails" };
  f.context.writePropertyJson_("qa-clear-failure", before);
  f.hooks.set = key => { if (key === "qa-clear-failure:manifest") throw new Error("Injected clear commit failure"); };
  assert.throws(() => f.context.clearPropertyJson_("qa-clear-failure"));
  assert.deepEqual(plain(f.context.readPropertyJson_("qa-clear-failure")), before);
});
