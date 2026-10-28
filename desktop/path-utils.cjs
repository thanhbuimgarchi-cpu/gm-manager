const path = require("node:path");
const fs = require("node:fs/promises");

function safeDriveEntryName(value) {
  const name = String(value || "").trim();
  if (!name || name === "." || name === ".." || name.length > 255) return "";
  return /[\\/:*?"<>|\u0000-\u001f]/.test(name) ? "" : name;
}

function sameDriveEntryName(left, right) {
  return String(left || "").normalize("NFC").toLocaleLowerCase() === String(right || "").normalize("NFC").toLocaleLowerCase();
}

function isWithinRoot(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function directoryChild(parent, name, root = parent) {
  const safeName = safeDriveEntryName(name);
  if (!safeName) return "";
  let entries;
  try { entries = await fs.readdir(parent, { withFileTypes: true }); } catch { return ""; }
  const entry = entries.find((item) => item.isDirectory() && sameDriveEntryName(item.name, safeName));
  if (!entry) return "";
  const target = path.join(parent, entry.name);
  try {
    const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
    if (!isWithinRoot(realRoot, realTarget)) return "";
    return target;
  } catch { return ""; }
}

async function normalizeWorkspaceRoot(value) {
  let selected = String(value || "").trim().replace(/^["'](.*)["']$/, "$1").trim();
  if (/^[a-z]:$/i.test(selected)) selected += path.sep;
  if (!selected || !path.isAbsolute(selected)) return "";
  try {
    selected = await fs.realpath(selected);
    if (!(await fs.stat(selected)).isDirectory()) return "";
  } catch { return ""; }
  const workspaceAt = async (candidate) => {
    const [customers, personnel] = await Promise.all([
      directoryChild(candidate, "Khách hàng", candidate),
      directoryChild(candidate, "Nhân lực", candidate),
    ]);
    return customers && personnel ? candidate : "";
  };
  // A pasted path may point at Customers, a month, or a document day. Resolve
  // an existing workspace ancestor before searching below the selected drive.
  let ancestor = selected;
  while (true) {
    const workspace = await workspaceAt(ancestor);
    if (workspace) return workspace;
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  if (sameDriveEntryName(path.basename(selected), "Khách hàng")) return selected;
  // Try the common Drive layouts first, then inspect directories only. Both
  // search limits keep an entire-drive selection responsive on large disks.
  const candidates = [
    path.join(selected, "GM Manager"),
    path.join(selected, "GM Manager", "GM Manager"),
    path.join(selected, "Shared drives", "GM Manager"),
    path.join(selected, "Shared drives", "GM Manager", "GM Manager"),
    path.join(selected, "My Drive", "GM Manager"),
    path.join(selected, "My Drive", "GM Manager", "GM Manager"),
  ];
  for (const candidate of candidates) {
    try {
      const realCandidate = await fs.realpath(candidate);
      if (!isWithinRoot(selected, realCandidate)) continue;
      const workspace = await workspaceAt(realCandidate);
      if (workspace) return workspace;
    } catch { /* Try the next explicit GM Manager branch. */ }
  }
  const queue = [{ folder: selected, depth: 0 }];
  const visited = new Set();
  const skipped = new Set(["$recycle.bin", "system volume information", "windows", "node_modules", ".git", ".dropbox.cache"]);
  for (let index = 0; index < queue.length && visited.size < 2048; index++) {
    const { folder, depth } = queue[index];
    if (visited.has(folder)) continue;
    visited.add(folder);
    const workspace = await workspaceAt(folder);
    if (workspace) return workspace;
    if (depth >= 8) continue;
    let entries;
    try { entries = await fs.readdir(folder, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || skipped.has(entry.name.toLowerCase())) continue;
      if (queue.length >= 4096) break;
      const child = path.join(folder, entry.name);
      if (isWithinRoot(selected, child)) queue.push({ folder: child, depth: depth + 1 });
    }
  }
  return "";
}

async function findProjectDocumentsAtRoot(root, payload = {}) {
  const year = String(payload.year || "");
  const month = Number(payload.month);
  if (!/^\d{4}$/.test(year) || !Number.isInteger(month) || month < 1 || month > 12) return "";
  const identifiers = [payload.houseId, payload.projectId].map(safeDriveEntryName).filter((name, index, values) => name && values.indexOf(name) === index);
  if (!identifiers.length) return "";
  let current = sameDriveEntryName(path.basename(root), "Khách hàng") ? root : await directoryChild(root, "Khách hàng", root);
  if (!current) return "";
  current = await directoryChild(current, year, root);
  if (!current) return "";
  current = await directoryChild(current, `T${month}`, root);
  if (!current) return "";
  for (const identifier of identifiers) {
    const customer = await directoryChild(current, identifier, root);
    if (!customer) continue;
    const documents = await directoryChild(customer, "Tài liệu", root);
    if (documents) return documents;
  }
  return "";
}

async function findDocumentSnapshotFolder(root, payload = {}) {
  const documents = await findProjectDocumentsAtRoot(root, payload);
  if (!documents) return "";
  if (!payload.snapshotName) return documents;
  return directoryChild(documents, payload.snapshotName, root);
}

module.exports = { safeDriveEntryName, sameDriveEntryName, isWithinRoot, directoryChild, normalizeWorkspaceRoot, findProjectDocumentsAtRoot, findDocumentSnapshotFolder };
