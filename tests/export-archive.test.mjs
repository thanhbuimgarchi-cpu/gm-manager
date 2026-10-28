import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../apps-script/Code.js", import.meta.url), "utf8");
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function context(extra = {}) {
  const result = vm.createContext({ console, ...extra });
  vm.runInContext(source, result);
  return result;
}

function iterator(values) {
  let index = 0;
  return { hasNext: () => index < values.length, next: () => values[index++] };
}

function exportFixture({ status = 200, mime = XLSX_MIME, bytes = [80, 75, 3, 4, 0, 0], body = "" } = {}) {
  const actions = [];
  const blob = {
    getContentType: () => mime,
    getBytes: () => bytes,
    getDataAsString: () => body,
    setContentType(value) { this.type = value; return this; },
    setName(value) { this.name = value; return this; },
  };
  const result = context({
    SpreadsheetApp: { flush: () => actions.push("flush") },
    ScriptApp: { getOAuthToken: () => "qa-private-oauth-token" },
    UrlFetchApp: {
      fetch(url, options) {
        actions.push({ url, options });
        return {
          getResponseCode: () => status,
          getBlob: () => blob,
          getContentText: () => body,
          getHeaders: () => ({ "Content-Type": mime }),
          getAllHeaders: () => ({ "Content-Type": mime }),
        };
      },
    },
  });
  return { context: result, actions, blob };
}

test("Excel export flushes the Sheet and retrieves actual XLSX bytes through Drive export", () => {
  const fixture = exportFixture();
  const result = fixture.context.exportXlsx_("spreadsheet-qa-id");
  assert.equal(result, fixture.blob);
  assert.equal(fixture.actions[0], "flush", "pending Sheet values must be applied before exporting");
  const request = fixture.actions.find((action) => typeof action === "object");
  const url = new URL(request.url);
  assert.equal(url.origin, "https://www.googleapis.com");
  assert.equal(url.pathname, "/drive/v3/files/spreadsheet-qa-id/export");
  assert.equal(url.searchParams.get("mimeType"), XLSX_MIME);
  assert.equal((request.options.method || "get").toLowerCase(), "get");
  assert.equal(request.options.headers.Authorization, "Bearer qa-private-oauth-token");
  assert.equal(request.options.muteHttpExceptions, true);
});

test("Google's generic ZIP/octet-stream MIME is accepted only for real ZIP workbook bytes", () => {
  for (const mime of ["application/zip", "application/octet-stream"]) {
    const fixture = exportFixture({ mime });
    assert.equal(fixture.context.exportXlsx_("spreadsheet-qa-id"), fixture.blob);
  }
});

test("export failures and PDF/HTML payloads cannot masquerade as successful Excel archives", () => {
  for (const options of [
    { status: 403, mime: "application/json", bytes: [123, 125], body: '{"error":{"message":"permission denied"}}' },
    { status: 500, mime: "text/html", bytes: [60, 104], body: "service error" },
    { status: 200, mime: "application/pdf", bytes: [37, 80, 68, 70], body: "%PDF" },
    { status: 200, mime: "text/html", bytes: [60, 104], body: "<html>Sign in</html>" },
    { status: 200, mime: XLSX_MIME, bytes: [37, 80, 68, 70], body: "%PDF" },
    { status: 200, mime: XLSX_MIME, bytes: [] },
  ]) {
    const fixture = exportFixture(options);
    assert.throws(() => fixture.context.exportXlsx_("spreadsheet-qa-id"), (error) => {
      assert.ok(error.message.length, "failure includes a useful error");
      assert.ok(!error.message.includes("qa-private-oauth-token"), "authorization must not enter error output");
      return true;
    });
  }
});

function replacementFixture({ failCreate = false, failMetadata = false } = {}) {
  const actions = [];
  const file = (id, name = "Tin nhắn khách.xlsx") => ({
    id, name, trashed: false,
    getId() { return this.id; },
    getName() { return this.name; },
    setDescription(value) {
      actions.push(`describe:${this.id}`);
      if (failMetadata && this.id === "new-xlsx") throw new Error("Drive rejected archive metadata");
      this.description = value; return this;
    },
    setTrashed(value) { this.trashed = value; actions.push(`trash:${this.id}`); return this; },
  });
  const first = file("old-1");
  const duplicate = file("old-2");
  const unrelated = file("unrelated", "Bản vẽ.pdf");
  const created = file("new-xlsx");
  const files = [first, duplicate, unrelated];
  const blob = { setName(value) { this.name = value; return this; } };
  const folder = {
    getFilesByName(name) { return iterator(files.filter((item) => item.name === name)); },
    getFiles() { return iterator([...files]); },
    createFile(value) {
      assert.equal(value, blob);
      actions.push("create");
      if (failCreate) throw new Error("Drive rejected the new workbook");
      files.push(created);
      return created;
    },
  };
  return { context: context(), actions, folder, blob, first, duplicate, unrelated, created };
}

test("a failed workbook replacement retains every existing archive", () => {
  const fixture = replacementFixture({ failCreate: true });
  assert.throws(() => fixture.context.replaceWorkbookFile_(fixture.folder, "Tin nhắn khách.xlsx", fixture.blob), /Drive rejected/);
  assert.deepEqual(fixture.actions, ["create"]);
  assert.equal(fixture.first.trashed, false);
  assert.equal(fixture.duplicate.trashed, false);
  assert.equal(fixture.unrelated.trashed, false);
});

test("successful workbook replacement retires only prior exact-name files after creation", () => {
  const fixture = replacementFixture();
  const created = fixture.context.replaceWorkbookFile_(fixture.folder, "Tin nhắn khách.xlsx", fixture.blob);
  assert.equal(created, fixture.created);
  assert.deepEqual(fixture.actions, ["create", "trash:old-1", "trash:old-2"]);
  assert.equal(fixture.created.trashed, false);
  assert.equal(fixture.unrelated.trashed, false);
});

test("archive metadata is durable before replacement retires old files", () => {
  const fixture = replacementFixture();
  fixture.context.replaceWorkbookFile_(fixture.folder, "Tin nhắn khách.xlsx", fixture.blob, { description: "archive-line-identities" });
  assert.equal(fixture.created.description, "archive-line-identities");
  assert.deepEqual(fixture.actions, ["create", "describe:new-xlsx", "trash:old-1", "trash:old-2"]);
});

test("failed archive metadata preparation leaves previous workbook copies intact", () => {
  const fixture = replacementFixture({ failMetadata: true });
  assert.throws(() => fixture.context.replaceWorkbookFile_(fixture.folder, "Tin nhắn khách.xlsx", fixture.blob, { description: "archive-line-identities" }), /Tệp cũ|Drive rejected archive metadata/);
  assert.equal(fixture.first.trashed, false);
  assert.equal(fixture.duplicate.trashed, false);
  assert.equal(fixture.created.trashed, true, "the incomplete newly created file is cleaned up");
});

test("unreadable customer-message history is retained instead of being replaced with an empty archive", () => {
  let temporaryCreates = 0;
  let destinationCreates = 0;
  let oldTrashed = false;
  const old = { getId: () => "old-message-archive", getDescription: () => "", setTrashed: () => { oldTrashed = true; } };
  const folder = {
    getFilesByName: () => iterator([old]),
    createFile: () => { destinationCreates += 1; throw new Error("must not replace unreadable archive"); },
  };
  const result = context({ SpreadsheetApp: { create: () => { temporaryCreates += 1; throw new Error("must not discard history"); } } });
  result.customerFolderForRecord_ = () => ({});
  result.documentsFolderForCustomerFolder_ = () => folder;
  result.readXlsxSheets_ = () => { throw new Error("corrupted or unreadable old workbook"); };
  assert.throws(() => result.appendPancakeMessageWorkbook_({
    id: "group-qa", groupName: "HP-587-GM-Tư vấn", houseId: "HP-587", projectId: "GM-QA",
    year: 2026, month: 10, messages: [{ id: "message-qa", senderName: "Khách", content: "Nội dung mới", sentAt: "2026-10-28T02:00:00Z" }],
  }));
  assert.equal(temporaryCreates, 0);
  assert.equal(destinationCreates, 0);
  assert.equal(oldTrashed, false);
});

test("message archive merges history and duplicate messages before writing a real XLSX", () => {
  let savedRows;
  let exported = 0;
  let replacements = 0;
  let temporaryTrashed = false;
  const range = {
    setValues(values) { savedRows = JSON.parse(JSON.stringify(values)); return this; },
    setVerticalAlignment() { return this; }, setWrap() { return this; },
    setFontFamily() { return this; }, setFontWeight() { return this; },
    setBackground() { return this; }, setNumberFormat() { return this; },
  };
  const sheet = {
    setName() {}, getRange: () => range, setFrozenRows() {},
    setColumnWidth() {}, autoResizeRows() {}, getLastRow: () => 3,
  };
  const old = { getId: () => "old-archive", getDescription: () => "" };
  const destination = { getFilesByName: () => iterator([old]), getUrl: () => "https://drive.google.com/folder/qa" };
  const xlsxBlob = { setName(value) { this.name = value; return this; } };
  const result = context({
    SpreadsheetApp: { create: () => ({ getId: () => "temporary-sheet", getSheets: () => [sheet] }), flush() {} },
    DriveApp: { getFileById(id) {
      assert.equal(id, "temporary-sheet", "only the temporary spreadsheet is cleaned up");
      return { setTrashed(value) { temporaryTrashed = value; } };
    } },
    Utilities: { formatDate: () => "28/10/2026 09:00:00" },
  });
  result.customerFolderForRecord_ = () => ({});
  result.documentsFolderForCustomerFolder_ = () => destination;
  result.readXlsxSheets_ = () => ({ "Tin nhắn khách": [
    ["Ngày", "Nội dung tin nhắn"], ["28/10/2026 09:00:00", "Nguyễn Tùng: Nội dung cũ"],
  ] });
  result.exportXlsx_ = (id) => { assert.equal(id, "temporary-sheet"); exported += 1; return xlsxBlob; };
  result.replaceWorkbookFile_ = (folder, name, blob) => {
    assert.equal(folder, destination);
    assert.equal(name, "Tin nhắn khách.xlsx");
    assert.equal(blob, xlsxBlob);
    replacements += 1;
    return { getId: () => "new-archive", getUrl: () => "https://drive.google.com/file/qa" };
  };
  const saved = result.appendPancakeMessageWorkbook_({
    id: "group-qa", groupName: "HP-587-GM-Tư vấn", houseId: "HP-587", projectId: "GM-QA", year: 2026, month: 10,
    messages: [
      { id: "old-message", senderName: "Nguyễn Tùng", content: "Nội dung cũ", sentAt: "2026-10-28T02:00:00Z" },
      { id: "new-message", senderName: "Nguyễn Tùng", content: "Nội dung mới", sentAt: "2026-10-28T02:00:00Z" },
    ],
  });
  assert.equal(saved.fileId, "new-archive");
  assert.equal(exported, 1, "message archive uses the shared Sheet-to-XLSX exporter");
  assert.equal(replacements, 1);
  assert.deepEqual(savedRows, [
    ["Ngày", "Nội dung tin nhắn"],
    ["28/10/2026 09:00:00", "Nguyễn Tùng: Nội dung cũ"],
    ["28/10/2026 09:00:00", "Nguyễn Tùng: Nội dung mới"],
  ]);
  assert.equal(temporaryTrashed, true);
});

test("duplicate historical archive copies merge without losing groups or multiplying genuine repeated lines", () => {
  let rows;
  const range = {
    setValues(value) { rows = JSON.parse(JSON.stringify(value)); return this; },
    setVerticalAlignment() { return this; }, setWrap() { return this; }, setFontFamily() { return this; },
    setFontWeight() { return this; }, setBackground() { return this; }, setNumberFormat() { return this; },
  };
  const sheet = { setName() {}, getRange: () => range, setFrozenRows() {}, setColumnWidth() {}, autoResizeRows() {}, getLastRow: () => 5 };
  const first = { getId: () => "first-copy", getDescription: () => "" };
  const second = { getId: () => "second-copy", getDescription: () => "" };
  const folder = { getFilesByName: () => iterator([first, second]), getUrl: () => "qa-folder" };
  const blob = { setName() { return this; } };
  const result = context({
    SpreadsheetApp: { create: () => ({ getId: () => "qa-temp", getSheets: () => [sheet] }), flush() {} },
    DriveApp: { getFileById: () => ({ setTrashed() {} }) },
    Utilities: { formatDate: () => "28/10/2026 10:00:00" },
  });
  result.customerFolderForRecord_ = () => ({});
  result.documentsFolderForCustomerFolder_ = () => folder;
  result.readXlsxSheets_ = (file) => ({ "Tin nhắn khách": file === first ? [
    ["Ngày", "Nội dung tin nhắn"],
    ["27/10/2026 09:00:00", "Khách: Nội dung trùng thật"],
    ["27/10/2026 09:00:00", "Khách: Nội dung trùng thật"],
  ] : [
    ["Ngày", "Nội dung tin nhắn"],
    ["27/10/2026 09:00:00", "Khách: Nội dung trùng thật"],
    ["28/10/2026 09:00:00", "Khách: Dữ liệu chỉ có ở bản mới"],
  ] });
  result.exportXlsx_ = () => blob;
  result.replaceWorkbookFile_ = () => ({ getId: () => "merged", getUrl: () => "merged-url" });
  result.appendPancakeMessageWorkbook_({
    id: "merge-group", groupName: "HP-587-GM-Tư vấn", houseId: "HP-587", projectId: "GM-QA", year: 2026, month: 10,
    messages: [{ id: "new-line", senderName: "Khách", content: "Dữ liệu mới nhất", sentAt: "2026-10-28T03:00:00Z" }],
  });
  assert.equal(rows.length, 5);
  assert.equal(rows.filter(row => row[1] === "Khách: Nội dung trùng thật").length, 2);
  assert.equal(rows.filter(row => row[1] === "Khách: Dữ liệu chỉ có ở bản mới").length, 1);
  assert.equal(rows.filter(row => row[1] === "Khách: Dữ liệu mới nhất").length, 1);
});
