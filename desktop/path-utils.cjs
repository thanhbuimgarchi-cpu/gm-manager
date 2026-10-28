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
  const selected = String(value || "").trim().replace(/^"(.*)"$/, "$1");
  if (!selected || !path.isAbsolute(selected)) return "";
  // Only inspect known GM Manager branches. Selecting an entire drive must
  // never trigger a recursive scan of every local or shared-drive folder.
  const candidates = [
    selected,
    path.join(selected, "GM Manager"),
    path.join(selected, "GM Manager", "GM Manager"),
    path.join(selected, "Shared drives", "GM Manager"),
    path.join(selected, "Shared drives", "GM Manager", "GM Manager"),
    path.join(selected, "My Drive", "GM Manager"),
    path.join(selected, "My Drive", "GM Manager", "GM Manager"),
  ];
  for (const candidate of candidates) {
    if (!sameDriveEntryName(path.basename(candidate), "GM Manager")) continue;
    try {
      const realCandidate = await fs.realpath(candidate);
      const [customers, personnel] = await Promise.all([
        directoryChild(realCandidate, "Khách hàng", realCandidate),
        directoryChild(realCandidate, "Nhân lực", realCandidate),
      ]);
      if (customers && personnel) return realCandidate;
    } catch { /* Try the next explicit GM Manager branch. */ }
  }
  return "";
}

async function findProjectDocumentsAtRoot(root, payload = {}) {
  const year = String(payload.year || "");
  const month = Number(payload.month);
  if (!/^\d{4}$/.test(year) || !Number.isInteger(month) || month < 1 || month > 12) return "";
  const identifiers = [payload.houseId, payload.projectId].map(safeDriveEntryName).filter((name, index, values) => name && values.indexOf(name) === index);
  if (!identifiers.length) return "";
  let current = await directoryChild(root, "Khách hàng", root);
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
