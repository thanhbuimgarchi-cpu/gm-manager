import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { transform } from "esbuild";

const source = await readFile(new URL("../app/SidebarCustomerGroup.tsx", import.meta.url), "utf8");
const { code } = await transform(source, { loader: "tsx", format: "cjs" });
const exports = {};
const context = vm.createContext({ module: { exports }, exports, require: () => ({}), Map });
vm.runInContext(code, context);
const { groupSidebarItems } = context.module.exports;

test("customer groups collect tasks without changing incoming priority order", () => {
  const rows = [
    { customer: "DV-75", task: "urgent" },
    { customer: "NT5-38", task: "normal-other-customer" },
    { customer: "DV-75", task: "normal" },
  ];
  const groups = groupSidebarItems(rows, (row) => row.customer);
  assert.deepEqual(Array.from(groups, (group) => group.key), ["DV-75", "NT5-38"]);
  assert.deepEqual(Array.from(groups[0].items, (row) => row.task), ["urgent", "normal"]);
  assert.equal(rows.length, 3, "grouping does not mutate the source collection");
});

test("same customer names in different projects stay in separate folders", () => {
  const rows = [{ name: "Chị Quỳnh", project: "2026-10-GM1" }, { name: "Chị Quỳnh", project: "2026-11-GM2" }];
  const groups = groupSidebarItems(rows, (row) => row.project);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].items.length, 1);
});

test("special test conversation collects separate two-hour batches together", () => {
  const rows = [{ conversationId: "test-bui-duc-thanh", batch: "morning" }, { conversationId: "test-bui-duc-thanh", batch: "afternoon" }];
  const groups = groupSidebarItems(rows, (row) => `conversation:${row.conversationId}`);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 2);
  assert.equal(groupSidebarItems([], () => "empty").length, 0);
});
