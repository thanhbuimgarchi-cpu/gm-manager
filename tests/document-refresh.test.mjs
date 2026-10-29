import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../apps-script/Code.js", import.meta.url), "utf8");
const FOLDER = "application/vnd.google-apps.folder";
const payload = { year: 2026, month: 10, projectId: "QA-DOC", houseId: "QA-DOC" };
const plain = (value) => JSON.parse(JSON.stringify(value));
const iterator = (items) => { let index = 0; return { hasNext: () => index < items.length, next: () => items[index++] }; };

function fixture() {
  const calls = [];
  const manifest = { files: {}, snapshots: { latest: { locked: true } } };
  const children = new Map([
    ["documents", [
      { id: "older", name: "21-10-2026-QA-DOC", mimeType: FOLDER },
      { id: "latest", name: "29-10-2026-QA-DOC", mimeType: FOLDER },
      { id: "manifest", name: "_gmcrm_tai_lieu.json", mimeType: "application/json" },
      { id: "unrelated", name: "3D", mimeType: FOLDER },
    ]],
    ["latest", [{ id: "pdf", name: "Ban ve.pdf", mimeType: "application/pdf", modifiedTime: "2026-10-29T01:00:00Z" }]],
    ["older", [{ id: "old-pdf", name: "Ban ve cu.pdf", mimeType: "application/pdf", modifiedTime: "2026-10-21T01:00:00Z" }]],
  ]);
  const context = vm.createContext({
    console,
    Utilities: { formatDate: (date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date).replace(",", "") },
    DriveApp: {
      getFolderById() { throw new Error("REST listings must not create DriveApp folder handles"); },
      getFileById(id) {
        assert.equal(id, "manifest", "only the small internal classification manifest may be read");
        return { getBlob: () => { calls.push("manifest-json"); return { getDataAsString: () => JSON.stringify(manifest) }; } };
      },
    },
  });
  vm.runInContext(source, context);
  const folder = { getId: () => "documents", getFolders() { throw new Error("no historical folder enumeration"); }, getFiles() { throw new Error("no document content reads"); } };
  context.documentsFolderForPayload_ = () => folder;
  context.listDriveChildrenMetadata_ = (id) => { calls.push(id); if (!children.has(id)) throw new Error(`unexpected folder ${id}`); return children.get(id); };
  return { context, calls, children, manifest, list: (extra = {}) => plain(context.listDocuments_({ ...payload, ...extra })) };
}

test("document polling sees new uploads and deletions even when the parent folder did not change", () => {
  const f = fixture();
  assert.deepEqual(f.list({ latest: true }).files.map((file) => file.id), ["pdf"]);
  f.children.get("latest").push({ id: "word", name: "Hop dong.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", modifiedTime: "2026-10-29T02:00:00Z" });
  assert.deepEqual(f.list({ latest: true }).files.map((file) => file.id), ["word", "pdf"]);
  f.children.set("latest", []);
  assert.deepEqual(f.list({ latest: true }).files, []);
  assert.equal(f.calls.filter((id) => id === "latest").length, 3);
  assert.equal(f.calls.includes("older"), false, "polling must not load historical file lists");
});

test("index-only document polling discovers new days without loading any day's files", () => {
  const f = fixture();
  f.children.get("documents").push({ id: "tomorrow", name: "30-10-2026-QA-DOC", mimeType: FOLDER });
  const result = f.list({ metadataOnly: true, snapshotId: "older" });
  assert.equal(result.metadataOnly, true);
  assert.equal(result.latestSnapshotId, "tomorrow");
  assert.equal(result.activeSnapshotId, "older");
  assert.deepEqual(result.files, []);
  assert.deepEqual(result.snapshots.map((snapshot) => snapshot.id), ["tomorrow", "latest", "older"]);
  assert.deepEqual(f.calls, ["documents", "manifest-json"]);
  assert.equal(result.snapshots.find((snapshot) => snapshot.id === "latest").locked, true);
});

test("latest:true overrides an old selected day and explicit historical loads remain isolated", () => {
  const f = fixture();
  const latest = f.list({ latest: true, snapshotId: "older" });
  assert.equal(latest.activeSnapshotId, "latest");
  assert.deepEqual(latest.files.map((file) => file.id), ["pdf"]);
  f.calls.length = 0;
  const older = f.list({ snapshotId: "older" });
  assert.equal(older.activeSnapshotId, "older");
  assert.equal(older.latestSnapshotId, "latest");
  assert.deepEqual(older.files.map((file) => file.id), ["old-pdf"]);
  assert.deepEqual(f.calls, ["documents", "manifest-json", "older"]);
});

test("document refresh reads current work assignments and filters spreadsheets and temporary files", () => {
  const f = fixture();
  f.children.get("latest").push(
    { id: "sheet", name: "Tong hop.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    { id: "tmp", name: "~$Hop dong.docx", mimeType: "application/octet-stream" },
    { id: "folder", name: "Other", mimeType: FOLDER },
  );
  f.manifest.files.pdf = { assigned: true, work: "Thiết kế" };
  assert.equal(f.list().files[0].work, "Thiết kế");
  f.manifest.files.pdf.work = "Thi công";
  const result = f.list();
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].work, "Thi công", "manifest changes must not be hidden by a long-lived metadata cache");
  assert.equal(f.calls.filter((id) => id === "manifest-json").length, 2);
});

test("missing document folders and empty indexes remain empty and read-only", () => {
  const f = fixture();
  f.context.documentsFolderForPayload_ = () => null;
  assert.deepEqual(f.list({ metadataOnly: true }), { ok: true, snapshots: [], activeSnapshotId: "", latestSnapshotId: "", files: [], metadataOnly: true });
  assert.deepEqual(f.calls, []);
  const empty = fixture();
  empty.children.set("documents", []);
  assert.deepEqual(empty.list().snapshots, []);
  assert.deepEqual(empty.calls, ["documents"], "no manifest/content lookup when no such file exists");
});

test("DriveApp fallback retains live listings when REST metadata is unavailable", () => {
  const f = fixture();
  let files = [{ getId: () => "fallback-pdf", getName: () => "Ho so.pdf", getMimeType: () => "application/pdf", getLastUpdated: () => new Date("2026-10-29T01:00:00Z") }];
  f.context.listDriveChildrenMetadata_ = () => { throw new Error("REST unavailable"); };
  f.context.listDocumentSnapshots_ = () => [{ id: "legacy", name: "29-10-2026-QA-DOC", date: "29/10/2026", folder: { getFiles: () => iterator(files) } }];
  f.context.readDocumentManifest_ = () => ({ files: {}, snapshots: {} });
  assert.deepEqual(f.list().files.map((file) => file.id), ["fallback-pdf"]);
  files = [];
  assert.deepEqual(f.list().files, []);
  assert.equal(f.list({ metadataOnly: true }).metadataOnly, true);
});

test("3D refresh sees uploads and deletions without creating folders", () => {
  const f = fixture();
  const structure = { root: { getUrl: () => "https://drive.google.com/3d" }, folders: [{ key: "architecture", name: "Kiến trúc", folder: { getId: () => "3d-architecture", getUrl: () => "https://drive.google.com/3d-architecture" } }, { key: "interior", name: "Nội thất", folder: null }] };
  f.context.threeDFoldersForPayload_ = (_payload, createMissing) => { assert.equal(createMissing, false); return structure; };
  f.children.set("3d-architecture", [{ id: "3d-pdf", name: "Phoi canh.pdf", mimeType: "application/pdf", modifiedTime: "2026-10-29T02:00:00Z" }]);
  assert.equal(f.context.list3DFiles_(payload).folders[0].files.length, 1);
  f.children.set("3d-architecture", []);
  assert.equal(f.context.list3DFiles_(payload).folders[0].files.length, 0);
  f.context.threeDFoldersForPayload_ = (_payload, createMissing) => { assert.equal(createMissing, false); return null; };
  assert.deepEqual(plain(f.context.list3DFiles_(payload)).folders.map((folder) => folder.files), [[], []]);
});

test("document and 3D read requests bypass the global write/export lock", () => {
  const f = fixture();
  let lockReads = 0;
  f.context.LockService = { getScriptLock: () => { lockReads += 1; throw new Error("write lock must not block a metadata read"); } };
  f.context.json_ = (result) => result;
  f.context.threeDFoldersForPayload_ = () => null;
  for (const action of ["list-documents", "list-3d-files"]) {
    const result = f.context.doPost({ postData: { contents: JSON.stringify({ ...payload, action, metadataOnly: true }) } });
    assert.equal(result.ok, true);
  }
  assert.equal(lockReads, 0);
});
