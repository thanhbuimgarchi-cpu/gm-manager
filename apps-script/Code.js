/**
 * GM-CRM -> Google Drive
 *
 * Production source is managed in Git and deployed automatically by the
 * "Deploy Google Apps Script" GitHub Actions workflow. The workflow updates
 * the existing Web App deployment, so its /exec URL stays unchanged.
 *
 * One-time setup: run the Web App as the Google account that owns GM Manager
 * and add GEMINI_API_KEY in Project Settings > Script properties.
 */

const ROOT_FOLDER_ID = "1jY12yTvgh4ZvpuX6r4coOrOBwdPEDAqu";
const DRIVE_ROOT_FOLDER_PROPERTY_KEY = "gmcrm-drive-root-folder-id";
const CUSTOMERS_FOLDER_NAME = "Kh\u00e1ch h\u00e0ng";
const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SCRIPT_PROJECT_ID = "1E2YbfpBHw2HpLySbRjoAPJ72__mekfu3NwoYwTcLnCj4qSPSNACV5KfA";
const PRODUCTION_DEPLOYMENT_ID = "AKfycby_JquY7zgNJGE3eDDnQ-l0BWqVdiBhaDYt0Fx4fw1PBqK6FyyZxQWigc3yCUTGdKN1";

/**
 * Browser bridge used by the public GitHub Pages app.
 *
 * Apps Script ContentService responses are redirected to googleusercontent.com.
 * Browsers can reject that cross-origin fetch even though the same deployment
 * works from a server. HtmlService + google.script.run keeps the request inside
 * Apps Script and returns the JSON result to the parent with postMessage.
 */
function doGet() {
  const html = [
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>GM Manager Drive Bridge</title></head><body>",
    "<script>(function(){",
    "function allowed(origin){return origin==='https://thanhbuimgarchi-cpu.github.io'||/^http:\\/\\/(?:localhost|127\\.0\\.0\\.1)(?::\\d+)?$/.test(origin);}",
    "window.addEventListener('message',function(event){",
    "var message=event.data||{};if(!allowed(event.origin)||message.channel!=='gm-manager-apps-script'||!message.id)return;",
    "var source=event.source;var origin=event.origin;",
    "google.script.run.withSuccessHandler(function(result){source.postMessage({channel:'gm-manager-apps-script-response',id:message.id,result:result},origin);})",
    ".withFailureHandler(function(error){source.postMessage({channel:'gm-manager-apps-script-response',id:message.id,error:(error&&error.message)||'Không thể chạy Apps Script.'},origin);})",
    ".bridgeDispatch(message.payload||{});",
    "});",
    "top.postMessage({channel:'gm-manager-apps-script-ready'},'*');",
    "})();<\/script></body></html>",
  ].join("");
  return HtmlService.createHtmlOutput(html)
    .setTitle("GM Manager Drive Bridge")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function bridgeDispatch(payload) {
  const output = doPost({ postData: { contents: JSON.stringify(payload || {}) } });
  return JSON.parse(output.getContent());
}

function redeployLatest(payload) {
  payload = payload || {};
  const deploymentLock = LockService.getScriptLock();
  deploymentLock.waitLock(30000);
  try {
    const description = String(payload.description || "GM Manager automatic deployment").replace(/[^\w .:-]/g, "").slice(0, 100);
    const apiRoot = "https://script.googleapis.com/v1/projects/" + encodeURIComponent(SCRIPT_PROJECT_ID);
    const requestOptions = {
      contentType: "application/json",
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    };
    const versionResponse = UrlFetchApp.fetch(apiRoot + "/versions", {
      ...requestOptions,
      method: "post",
      payload: JSON.stringify({ description: description }),
    });
    if (versionResponse.getResponseCode() < 200 || versionResponse.getResponseCode() >= 300) {
      throw new Error("Không thể tạo phiên bản Apps Script: " + versionResponse.getContentText().slice(0, 300));
    }
    const version = JSON.parse(versionResponse.getContentText());
    const updateResponse = UrlFetchApp.fetch(apiRoot + "/deployments/" + encodeURIComponent(PRODUCTION_DEPLOYMENT_ID), {
      ...requestOptions,
      method: "put",
      payload: JSON.stringify({ deploymentConfig: { versionNumber: version.versionNumber, manifestFileName: "appsscript", description: description } }),
    });
    if (updateResponse.getResponseCode() < 200 || updateResponse.getResponseCode() >= 300) {
      throw new Error("Không thể cập nhật Web App: " + updateResponse.getContentText().slice(0, 300));
    }
    return { ok: true, versionNumber: version.versionNumber, deploymentId: PRODUCTION_DEPLOYMENT_ID };
  } finally {
    deploymentLock.releaseLock();
  }
}

function normalizeDriveFolderId_(value) {
  const text = String(value || "").trim();
  const fromUrl = /\/folders\/([A-Za-z0-9_-]+)/.exec(text);
  const id = fromUrl ? fromUrl[1] : text;
  return /^[A-Za-z0-9_-]{10,}$/.test(id) ? id : "";
}

function configuredRootFolderId_() {
  const saved = normalizeDriveFolderId_(PropertiesService.getScriptProperties().getProperty(DRIVE_ROOT_FOLDER_PROPERTY_KEY));
  return saved || ROOT_FOLDER_ID;
}

function rootFolder_() {
  return DriveApp.getFolderById(configuredRootFolderId_());
}

function setDriveRootFolder_(payload) {
  const folderId = normalizeDriveFolderId_(payload.folderId || payload.driveUrl);
  if (!folderId) throw new Error("Link thư mục Drive không hợp lệ.");
  const folder = DriveApp.getFolderById(folderId);
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(DRIVE_ROOT_FOLDER_PROPERTY_KEY, folderId);
  return { ok: true, folderId: folderId, folderName: folder.getName() };
}

// The house code is the user-facing Drive key. projectId remains in the
// cached record for backwards compatibility, but new customer folders and
// exported files use houseId whenever it is available.
function customerFolderKey_(value) {
  const source = value && typeof value === "object" ? value : { projectId: value };
  return String(source.houseId || source.projectId || "").trim();
}

function validCustomerFolderKey_(value) {
  const text = String(value || "").trim();
  return text.length > 0 && text.length <= 160 && !/[\\/:*?"<>|\u0000-\u001f]/.test(text) && text !== "." && text !== "..";
}

function customerFolderForPayload_(payload, createMissing) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  const folderKey = customerFolderKey_(payload);
  if (!folderKey) return null;
  if (createMissing && isCustomerDriveRecordDeleted_(payload)) throw new Error("Hồ sơ đã được xóa trên Drive. Hãy tạo hồ sơ mới nếu cần dùng lại mã nhà.");
  let folder = getCustomerFolder_(year, month, folderKey, false);
  // Existing GM... folders remain readable after a house code is added to a
  // cached record. New writes can migrate that legacy folder by record.
  if (!folder && projectId && folderKey !== projectId) folder = getCustomerFolder_(year, month, projectId, false);
  if (!folder && createMissing) folder = getCustomerFolder_(year, month, folderKey, true);
  return folder;
}

function customerFolderForRecord_(record, year, month, createMissing) {
  const projectId = String(record && record.projectId || "").trim();
  const houseId = String(record && record.houseId || "").trim();
  const folderKey = customerFolderKey_(record);
  if (!folderKey) return null;
  if (createMissing && isCustomerDriveRecordDeleted_({ year: year, month: month, projectId: projectId, houseId: houseId })) throw new Error("Hồ sơ đã được xóa trên Drive. Hãy tạo hồ sơ mới nếu cần dùng lại mã nhà.");
  let folder = getCustomerFolder_(year, month, folderKey, false);
  if (!folder && houseId && projectId && houseId !== projectId) {
    const legacy = getCustomerFolder_(year, month, projectId, false);
    if (legacy) {
      try { legacy.setName(houseId); } catch (error) { /* Keep the legacy name if rename is unavailable. */ }
      folder = legacy;
    }
  }
  if (!folder && createMissing) folder = getCustomerFolder_(year, month, folderKey, true);
  return folder;
}

function createCustomerFolder_(payload) {
  requireCustomerAdminSession_(payload);
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  const houseId = String(payload.houseId || "").trim();
  const folderKey = houseId || projectId;
  if (!/^\d{4}$/.test(String(year)) || month < 1 || month > 12 || !validCustomerFolderKey_(folderKey)) {
    throw new Error("Thiếu thông tin hồ sơ hợp lệ để tạo thư mục Drive.");
  }
  const priorMutations = readPropertyJson_(customerDriveMutationsKey_()) || [];
  const deletedScopes = priorMutations.filter(function(mutation) { return mutation.deleted && Number(mutation.year) === year && Number(mutation.month) === month && (customerMutationMatches_({ projectId: projectId, houseId: houseId }, mutation) || normalizeDriveName_(mutation.houseId) === normalizeDriveName_(folderKey)); });
  // Creating a project only establishes the folder tree. A blank document day
  // must not appear until the user explicitly creates a day or uploads files.
  const root = rootFolder_();
  const customers = getOrCreateFolder_(root, CUSTOMERS_FOLDER_NAME);
  const yearFolder = getOrCreateFolder_(customers, String(year));
  const monthFolder = getOrCreateFolder_(yearFolder, "T" + month);
  let folder = findFolder_(monthFolder, houseId || projectId);
  const legacyFolder = projectId && houseId && projectId !== houseId ? findFolder_(monthFolder, projectId) : null;
  const creatingNewCustomer = !folder && !legacyFolder;

  // Before house codes became the Drive folder key, the same customer was
  // created as GM.... If that legacy folder exists, rename/reuse it instead
  // of creating a second folder named after the house code. If both versions
  // already exist, merge the legacy content into the house-code folder.
  if (!folder && legacyFolder) {
    legacyFolder.setName(houseId);
    folder = legacyFolder;
  } else if (folder && legacyFolder && folder.getId() !== legacyFolder.getId()) {
    mergeFolderInto_(folder, legacyFolder);
    legacyFolder.setTrashed(true);
  }
  folder = getOrCreateFolder_(monthFolder, houseId || projectId);
  if (!folder) throw new Error("Không thể tạo thư mục hồ sơ trên Drive.");
  ensureProjectFolders_(folder, false);
  if (deletedScopes.length) {
    // Reset every old project masked by the house-code tombstone before it
    // is cleared. A normal create retry must never reset a live project.
    deletedScopes.forEach(function(mutation) { workflowResetCustomerProject_(mutation, true); });
    workflowResetCustomerProject_({ year: year, month: month, projectId: projectId, houseId: houseId }, false);
  } else if (creatingNewCustomer && projectId) {
    // This folder was just created empty by the authenticated admin. Seed its
    // authoritative blank workflow so first publication need not inspect Drive.
    try {
      const details = { year: year, month: month, projectId: projectId, houseId: houseId };
      if (!workflowReadProject_(details)) workflowResetCustomerProject_(details, false);
    } catch (cacheError) { /* A confirmed new Drive folder stays created; first workflow use can import it safely. */ }
  }
  clearCustomerDriveDeletion_({ year: year, month: month, projectId: projectId, houseId: houseId });
  cacheFolder_("gmcrm-customer-folder-" + year + "-" + month + "-" + folderKey, folder);
  return { ok: true, folderId: folder.getId(), folderName: folder.getName(), folderUrl: folder.getUrl(), year: year, month: month, projectId: projectId, houseId: houseId };
}

/**
 * Rename an existing customer folder when the user changes its house code.
 * The internal projectId is retained in the cache and is used as a fallback
 * for folders created before house codes were introduced.
 */
function customerMutationMonthFolder_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  if (!/^\d{4}$/.test(String(year)) || month < 1 || month > 12 || month % 1) throw new Error("Tháng hoặc năm của hồ sơ không hợp lệ.");
  const uniqueChild = function(parent, name) {
    if (!parent) return null;
    const matches = findFolders_(parent, name).filter(function(folder) { return !folder.isTrashed || !folder.isTrashed(); });
    if (matches.length > 1) throw new Error("Có nhiều thư mục trùng tên " + name + " trên Drive. Hãy xử lý thư mục trùng trước khi đổi tên hoặc xóa.");
    return matches[0] || null;
  };
  const customers = uniqueChild(rootFolder_(), CUSTOMERS_FOLDER_NAME);
  const yearFolder = uniqueChild(customers, String(year));
  const monthFolder = uniqueChild(yearFolder, "T" + month);
  if (!monthFolder) throw new Error("Không tìm thấy thư mục tháng của hồ sơ trên Drive.");
  return monthFolder;
}

function existingCustomerMutationFolder_(payload, monthFolder) {
  const names = [payload.oldHouseId, payload.houseId, payload.projectId].map(function(value) { return String(value || "").trim(); }).filter(Boolean);
  if (!names.length || names.some(function(name) { return !validCustomerFolderKey_(name); })) throw new Error("Mã nhà hoặc mã hồ sơ không hợp lệ.");
  const wanted = names.map(normalizeDriveName_);
  const requestedId = String(payload.folderId || "").trim();
  const matches = [];
  const children = monthFolder.getFolders();
  while (children.hasNext()) {
    const child = children.next();
    if (child.isTrashed && child.isTrashed()) continue;
    if (wanted.indexOf(normalizeDriveName_(child.getName())) < 0) continue;
    if (requestedId && child.getId() !== requestedId) continue;
    matches.push(child);
  }
  if (!matches.length) throw new Error("Không tìm thấy đúng thư mục hồ sơ cũ trên Drive. Hãy nạp lại danh sách.");
  if (matches.length !== 1) throw new Error("Có nhiều thư mục khớp hồ sơ này trên Drive. Chưa thể xác định an toàn thư mục cần đổi tên hoặc xóa.");
  return matches[0];
}

function customerDriveMutationsKey_() {
  return "gmcrm-customer-drive-mutations-" + configuredRootFolderId_();
}

function customerDriveMutations_() {
  try { const value = readPropertyJson_(customerDriveMutationsKey_()); return Array.isArray(value) ? value : []; } catch (error) { return []; }
}

function customerMutationMatches_(record, mutation) {
  const aliases = mutation.aliases || [];
  if (record.driveFolderId && mutation.folderId) return String(record.driveFolderId) === String(mutation.folderId);
  const projectId = normalizeDriveName_(record.projectId);
  return projectId ? aliases.indexOf(projectId) >= 0 : aliases.indexOf(normalizeDriveName_(record.houseId)) >= 0;
}

function isCustomerDriveRecordDeleted_(payload) {
  return customerDriveMutations_().some(function(mutation) {
    return mutation.deleted && Number(mutation.year) === Number(payload.year) && Number(mutation.month) === Number(payload.month) && customerMutationMatches_(payload, mutation);
  });
}

function applyCustomerDriveMutations_(years) {
  const mutations = customerDriveMutations_();
  return (Array.isArray(years) ? years : []).map(function(year) {
    return { ...year, months: (Array.isArray(year.months) ? year.months : []).map(function(month, index) {
      const monthNumber = /^T(\d{1,2})$/.exec(String(month.label || ""));
      const selected = mutations.filter(function(mutation) { return Number(mutation.year) === Number(year.year) && Number(mutation.month) === (monthNumber ? Number(monthNumber[1]) : index + 1); });
      const records = (Array.isArray(month.records) ? month.records : []).reduce(function(result, record) {
        const mutation = selected.find(function(item) { return customerMutationMatches_(record, item); });
        if (mutation && mutation.deleted) return result;
        if (!mutation) { result.push(record); return result; }
        const name = mutation.name || (mutation.aliases.indexOf(normalizeDriveName_(record.name)) >= 0 ? mutation.houseId : record.name);
        result.push({ ...record, projectId: mutation.projectId, houseId: mutation.houseId, name: name, cacheUpdatedAt: Math.max(Number(record.cacheUpdatedAt || 0), Number(mutation.updatedAt)) });
        return result;
      }, []);
      return { ...month, records: records };
    }) };
  });
}

function saveCustomerDriveMutation_(payload, folder, deleted) {
  const existing = customerDriveMutations_();
  const current = existing.find(function(item) { return Number(item.year) === Number(payload.year) && Number(item.month) === Number(payload.month) && item.projectId === String(payload.projectId); });
  const aliases = [payload.projectId, payload.oldHouseId, payload.houseId, folder.getName()].concat(current && current.aliases || []).map(normalizeDriveName_).filter(Boolean);
  const mutation = { year: Number(payload.year), month: Number(payload.month), projectId: String(payload.projectId || "").trim(), houseId: String(payload.houseId || folder.getName()).trim(), folderId: folder.getId(), aliases: Array.from(new Set(aliases)), deleted: Boolean(deleted), updatedAt: Date.now() };
  if (Object.prototype.hasOwnProperty.call(payload, "name")) mutation.name = String(payload.name || "").trim();
  const next = existing.filter(function(item) { return !(Number(item.year) === mutation.year && Number(item.month) === mutation.month && item.projectId === mutation.projectId); });
  next.push(mutation);
  writePropertyJson_(customerDriveMutationsKey_(), next);
  const stored = readPropertyJson_(WORKSPACE_CACHE_PROPERTY_KEY);
  if (stored && Array.isArray(stored.years)) writePropertyJson_(WORKSPACE_CACHE_PROPERTY_KEY, { ...stored, updatedAt: mutation.updatedAt, years: applyCustomerDriveMutations_(stored.years) });
  PropertiesService.getScriptProperties().setProperty("gmcrm-customer-tree-revision-" + configuredRootFolderId_(), String(mutation.updatedAt) + "-" + Math.random().toString(36).slice(2, 7));
  return mutation;
}

function clearCustomerDriveDeletion_(payload) {
  const previous = customerDriveMutations_();
  const houseKey = normalizeDriveName_(payload.houseId || payload.projectId);
  const next = previous.filter(function(mutation) { return !(mutation.deleted && Number(mutation.year) === Number(payload.year) && Number(mutation.month) === Number(payload.month) && (customerMutationMatches_(payload, mutation) || normalizeDriveName_(mutation.houseId) === houseKey)); }).map(function(mutation) {
    if (Number(mutation.year) !== Number(payload.year) || Number(mutation.month) !== Number(payload.month) || normalizeDriveName_(mutation.houseId) === houseKey || mutation.projectId === payload.projectId) return mutation;
    return { ...mutation, aliases: (mutation.aliases || []).filter(function(alias) { return alias !== houseKey; }) };
  });
  if (JSON.stringify(next) !== JSON.stringify(previous)) writePropertyJson_(customerDriveMutationsKey_(), next);
}

function customerMutationRequest_(payload, action, completedResult) {
  const id = String(payload.mutationId || "").trim();
  if (!id) return null;
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(id)) throw new Error("Mã yêu cầu thay đổi hồ sơ không hợp lệ.");
  const key = "gmcrm-customer-mutation-requests-" + configuredRootFolderId_();
  const stored = readPropertyJson_(key);
  const requests = Array.isArray(stored) ? stored : [];
  const signature = JSON.stringify([action, Number(payload.year), Number(payload.month), String(payload.projectId || "").trim(), String(payload.oldHouseId || "").trim(), String(payload.houseId || "").trim(), String(payload.folderId || "").trim(), String(payload.name || "").trim()]);
  const previous = requests.find(function(request) { return request.id === id; });
  if (previous) {
    if (previous.signature !== signature) throw new Error("Mã yêu cầu đã được dùng cho thao tác hoặc hồ sơ khác. Hãy thử lại bằng yêu cầu mới.");
    return { ...previous.result, repeated: true };
  }
  if (completedResult) {
    requests.push({ id: id, signature: signature, result: completedResult, completedAt: Date.now() });
    writePropertyJson_(key, requests.slice(-100));
  }
  return null;
}

function deleteCustomerFolder_(payload) {
  requireCustomerAdminSession_(payload);
  const repeated = customerMutationRequest_(payload, "delete");
  if (repeated) return repeated;
  if (!String(payload.projectId || "").trim()) throw new Error("Thiếu mã hồ sơ cần xóa.");
  const prior = customerDriveMutations_().find(function(mutation) { return mutation.deleted && Number(mutation.year) === Number(payload.year) && Number(mutation.month) === Number(payload.month) && mutation.projectId === String(payload.projectId).trim() && (!payload.folderId || payload.folderId === mutation.folderId); });
  if (prior) {
    try {
      const removed = DriveApp.getFolderById(prior.folderId);
      if (removed.isTrashed && removed.isTrashed()) {
        try { workflowResetCustomerProject_(prior, true); } catch (cleanupError) { /* The Drive deletion mask remains until a strict recreation reset succeeds. */ }
        const result = { ok: true, deleted: true, trashed: true, alreadyDeleted: true, folderId: prior.folderId, year: prior.year, month: prior.month, projectId: prior.projectId, houseId: prior.houseId };
        customerMutationRequest_(payload, "delete", result);
        return result;
      }
    } catch (error) { /* Missing Drive permission is not proof that the folder was deleted. */ }
  }
  const monthFolder = customerMutationMonthFolder_(payload);
  const folder = existingCustomerMutationFolder_(payload, monthFolder);
  const folderId = folder.getId();
  const folderName = folder.getName();
  folder.setTrashed(true);
  saveCustomerDriveMutation_(payload, folder, true);
  const details = { year: Number(payload.year), month: Number(payload.month), projectId: String(payload.projectId).trim() };
  clearPropertyJson_(workNotesPropertyKey_(details));
  const notes = readPropertyJson_(ACTIVE_WORK_NOTES_PROPERTY_KEY);
  if (Array.isArray(notes)) writePropertyJson_(ACTIVE_WORK_NOTES_PROPERTY_KEY, notes.filter(function(note) { return !(Number(note.year) === details.year && Number(note.month) === details.month && (String(note.projectId) === details.projectId || normalizeDriveName_(note.houseId) === normalizeDriveName_(folderName))); }));
  try { workflowResetCustomerProject_({ ...details, houseId: payload.houseId || folderName }, true); } catch (cleanupError) { /* Confirmed Drive deletion must not fail solely because optional canonical cleanup is unavailable. */ }
  const result = { ok: true, deleted: true, trashed: true, folderId: folderId, folderName: folderName, year: details.year, month: details.month, projectId: details.projectId, houseId: String(payload.houseId || folderName) };
  customerMutationRequest_(payload, "delete", result);
  return result;
}

function renameCustomerFolder_(payload) {
  requireCustomerWorkflowManager_(payload);
  const repeated = customerMutationRequest_(payload, "rename");
  if (repeated) return repeated;
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  const oldHouseId = String(payload.oldHouseId || "").trim();
  const houseId = String(payload.houseId || "").trim();
  if (!/^\d{4}$/.test(String(year)) || month < 1 || month > 12 || !projectId || !validCustomerFolderKey_(houseId)) {
    throw new Error("Thiếu thông tin mã nhà hợp lệ để lưu thay đổi.");
  }

  const monthFolder = customerMutationMonthFolder_(payload);
  let folder;
  try { folder = existingCustomerMutationFolder_({ ...payload, houseId: oldHouseId || projectId }, monthFolder); }
  catch (error) {
    const prior = customerDriveMutations_().find(function(mutation) { return !mutation.deleted && Number(mutation.year) === year && Number(mutation.month) === month && mutation.projectId === projectId && normalizeDriveName_(mutation.houseId) === normalizeDriveName_(houseId); });
    if (!prior || String(error.message || "").indexOf("Không tìm thấy đúng") !== 0) throw error;
    folder = existingCustomerMutationFolder_({ projectId: projectId, houseId: houseId, folderId: prior.folderId }, monthFolder);
  }
  const duplicate = findFolders_(monthFolder, houseId).some(function(item) { return item.getId() !== folder.getId(); });
  if (duplicate) {
    throw new Error("Mã nhà đã tồn tại trong cùng tháng. Hãy chọn mã khác.");
  }
  if (folder.getName() !== houseId) folder.setName(houseId);
  saveCustomerDriveMutation_(payload, folder, false);
  cacheFolder_("gmcrm-customer-folder-" + year + "-" + month + "-" + houseId, folder);
  if (oldHouseId && oldHouseId !== houseId) {
    try { CacheService.getScriptCache().remove(driveScopedCacheKey_("gmcrm-customer-folder-" + year + "-" + month + "-" + oldHouseId)); } catch (error) { /* Cache is optional. */ }
  }
  const result = { ok: true, folderId: folder.getId(), folderName: folder.getName(), folderUrl: folder.getUrl(), year: year, month: month, projectId: projectId, houseId: houseId };
  customerMutationRequest_(payload, "rename", result);
  return result;
}

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents || "{}");
    if (payload.action === "redeploy-latest") return json_(redeployLatest(payload));
    if (["audio-insight", "process-audio-chunk", "store-audio-chunk", "delete-audio-note", "customer-portal-share", "sync-design-progress"].indexOf(payload.action) >= 0) requireCustomerWorkflowManager_(payload);
    if (payload.action === "audio-insight") return json_(transcribeAudio_(payload));
    if (payload.action === "process-audio-chunk") return json_(processStoredAudioChunk_(payload));
    if (payload.action === "store-audio-chunk") {
      const audioLock = LockService.getScriptLock();
      audioLock.waitLock(30000);
      try {
        return json_(storeAudioChunk_(payload));
      } finally {
        audioLock.releaseLock();
      }
    }
    if (payload.action === "delete-audio-note") {
      const audioLock = LockService.getScriptLock();
      audioLock.waitLock(30000);
      try {
        return json_(deleteAudioNote_(payload));
      } finally {
        audioLock.releaseLock();
      }
    }
    if (payload.action === "list-workflow-files") return json_(listWorkflowFiles_(payload));
    if (payload.action === "load-work-notes") return json_(loadWorkNotes_(payload));
    if (payload.action === "load-customer-messages") return json_(loadCustomerMessages_(payload));
    if (payload.action === "load-assigned-work-notes") return json_(loadAssignedWorkNotes_(payload));
    if (payload.action === "load-assigned-design-tasks") return json_(loadAssignedDesignTasks_(payload));
    if (payload.action === "load-workspace-cache") return json_(loadWorkspaceCache_(payload));
    if (payload.action === "list-documents") return json_(listDocuments_(payload));
    if (payload.action === "list-3d-files") return json_(list3DFiles_(payload));
    if (payload.action === "load-personnel") return json_(loadPersonnel_(payload));
    if (payload.action === "verify-employee-login") return json_(verifyEmployeeLogin_(payload));
    if (payload.action === "load-consulting") return json_(loadConsultingWorkspace_(payload));
    if (payload.action === "customer-portal-share") return json_(customerPortalShare_(payload));
    if (payload.action === "inspect-drive-tree") return json_(inspectDriveTree_(payload));

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      if (payload.action === "create-workflow-date-folder") return json_(createWorkflowDateFolder_(payload));
      if (payload.action === "workflow-command") return json_(workflowCommand_(payload));
      if (payload.action === "upload-workflow-file") return json_(uploadWorkflowFile_(payload));
      if (payload.action === "save-personnel-cache") return json_(savePersonnelCache_(payload.personnel || {}));
      if (payload.action === "export-personnel") return json_(syncPersonnelWorkbook_(payload.personnel || {}));
      if (payload.action === "sync-personnel") return json_(syncPersonnelWorkbook_(payload.personnel || {}));
      if (payload.action === "register-employee-account") return json_(registerEmployeeAccount_(payload));
      if (payload.action === "request-password-reset") return json_(requestEmployeePasswordReset_(payload));
      if (payload.action === "reset-employee-password") return json_(resetEmployeePassword_(payload));
      if (payload.action === "set-drive-root") return json_(setDriveRootFolder_(payload));
      if (payload.action === "create-customer-folder") return json_(createCustomerFolder_(payload));
      if (payload.action === "rename-customer-folder") return json_(renameCustomerFolder_(payload));
      if (payload.action === "delete-customer-folder") return json_(deleteCustomerFolder_(payload));
      if (payload.action === "save-workspace-cache") return json_(saveWorkspaceCache_(payload));
      if (payload.action === "sync-work-notes") return json_(syncWorkNotes_(payload));
      if (payload.action === "complete-work-note") return json_(completeWorkNote_(payload));
      if (payload.action === "save-pancake-config") return json_(savePancakeConfig_(payload));
      if (payload.action === "update-customer-message-status") return json_(updateCustomerMessageStatus_(payload));
      if (payload.action === "sync-design-tasks") return json_(syncDesignTasks_(payload));
    if (payload.action === "create-document-snapshot") return json_(createDocumentSnapshot_(payload));
    if (payload.action === "update-document-metadata") return json_(updateDocumentMetadata_(payload));
    if (payload.action === "set-document-snapshot-lock") return json_(setDocumentSnapshotLock_(payload));
    if (payload.action === "delete-document-snapshot") return json_(deleteDocumentSnapshot_(payload));
      if (!payload.record || !payload.year || !payload.month) throw new Error("Thi\u1ebfu d\u1eef li\u1ec7u h\u1ed3 s\u01a1.");

      if (payload.action === "sync-design-progress") {
        const designResult = exportDesignProgressWorkbook_(payload.record, Number(payload.year), Number(payload.month), payload.progressKind);
        return json_({ ok: true, ...designResult });
      }

      if (payload.action === "sync-warranty") {
        const warrantyResult = exportWarrantyWorkbook_(payload.record, Number(payload.year), Number(payload.month));
        return json_({ ok: true, ...warrantyResult });
      }

      requireCustomerWorkflowManager_(payload);
      const result = exportCustomerWorkbook_(payload.record, Number(payload.year), Number(payload.month));
      return json_({ ok: true, ...result });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return json_({ ok: false, code: error && error.code || "SERVER_ERROR", error: error && error.message ? error.message : "Kh\u00f4ng th\u1ec3 xu\u1ea5t Excel." });
  }
}

function transcribeAudio_(payload) {
  const audio = payload.audio || {};
  const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
  if (!apiKey) throw new Error("Ch\u01b0a c\u1ea5u h\u00ecnh GEMINI_API_KEY trong Script Properties.");
  if (typeof audio.data !== "string" || !audio.data || typeof audio.mimeType !== "string" || !audio.mimeType) {
    throw new Error("Thi\u1ebfu d\u1eef li\u1ec7u file ghi \u00e2m.");
  }
  if (audio.data.length > 25200000) throw new Error("File ghi \u00e2m qu\u00e1 l\u1edbn. H\u00e3y d\u00f9ng file t\u1ed1i \u0111a 18 MB.");

  const transcriptSchema = {
    type: "OBJECT",
    properties: {
      language: { type: "STRING" },
      segments: { type: "ARRAY", items: { type: "OBJECT", properties: { time: { type: "STRING" }, text: { type: "STRING" } }, required: ["time", "text"] } },
    },
    required: ["language", "segments"],
  };
  const transcript = generateGeminiJson_(apiKey, [{
    role: "user",
    parts: [
      { inline_data: { mime_type: audio.mimeType, data: audio.data } },
      { text: "Chuy\u1ec3n to\u00e0n b\u1ed9 l\u1eddi n\u00f3i trong ghi \u00e2m th\u00e0nh v\u0103n b\u1ea3n ch\u00ednh x\u00e1c. Chia th\u00e0nh c\u00e1c \u0111o\u1ea1n \u00fd ngh\u0129a 1\u20133 c\u00e2u v\u00e0 ghi m\u1ed1c th\u1eddi gian MM:SS. Gi\u1eef nguy\u00ean ng\u00f4n ng\u1eef v\u00e0 l\u1eddi n\u00f3i; kh\u00f4ng t\u00f3m t\u1eaft, kh\u00f4ng r\u00fat \u00fd, kh\u00f4ng th\u00eam th\u00f4ng tin." },
    ],
  }], transcriptSchema);

  const segments = (transcript.segments || []).filter(function(segment) {
    return segment && typeof segment.text === "string" && segment.text.trim();
  }).map(function(segment) {
    return { time: typeof segment.time === "string" ? segment.time : "~", text: segment.text.trim() };
  });
  if (!segments.length) throw new Error("Kh\u00f4ng nh\u1eadn di\u1ec7n \u0111\u01b0\u1ee3c l\u1eddi n\u00f3i trong file ghi \u00e2m.");
  return {
    ok: true,
    language: transcript.language || "Ti\u1ebfng Vi\u1ec7t",
    segments: segments,
    apiCallsUsed: 1,
  };
}

function storeAudioChunk_(payload) {
  const audio = payload.audio || {};
  const year = Number(payload.year);
  const month = Number(payload.month);
  const chunkIndex = Number(payload.chunkIndex);
  const totalChunks = Number(payload.totalChunks);
  const projectId = String(payload.projectId || "").trim();
  const folderKey = customerFolderKey_(payload);
  if (!year || month < 1 || month > 12 || !projectId || chunkIndex < 0 || totalChunks < 1 || chunkIndex >= totalChunks) {
    throw new Error("Thi\u1ebfu th\u00f4ng tin th\u01b0 m\u1ee5c ghi \u00e2m.");
  }
  if (typeof audio.data !== "string" || !audio.data || typeof audio.mimeType !== "string" || !audio.mimeType) {
    throw new Error("Thi\u1ebfu d\u1eef li\u1ec7u \u0111o\u1ea1n ghi \u00e2m.");
  }

  const audioFolder = getAudioFolderForPayload_(payload, true);
  const prefix = "Ghi \u00e2m " + folderKey + " - ph\u1ea7n ";
  if (chunkIndex === 0) trashFilesByPrefix_(audioFolder, prefix);
  const extensionMatch = /\.([a-z0-9]{1,5})$/i.exec(String(audio.fileName || ""));
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : audio.mimeType === "audio/mpeg" ? "mp3" : "wav";
  const fileName = audioChunkBaseName_(folderKey, chunkIndex, totalChunks) + "." + extension;
  trashFilesByName_(audioFolder, fileName);
  const blob = Utilities.newBlob(Utilities.base64Decode(audio.data), audio.mimeType, fileName);
  const file = audioFolder.createFile(blob);
  return { ok: true, fileId: file.getId(), fileUrl: file.getUrl(), fileName: fileName, folderUrl: audioFolder.getUrl() };
}

function deleteAudioNote_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  if (!year || month < 1 || month > 12 || !projectId) throw new Error("Thi\u1ebfu th\u00f4ng tin ghi \u00e2m c\u1ea7n x\u00f3a.");
  const audioFolder = getAudioFolderForPayload_(payload, false);
  if (!audioFolder) return { ok: true, deletedCount: 0 };
  let deletedCount = 0;
  const files = audioFolder.getFiles();
  while (files.hasNext()) {
    files.next().setTrashed(true);
    deletedCount += 1;
  }
  return { ok: true, deletedCount: deletedCount };
}

function processStoredAudioChunk_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const chunkIndex = Number(payload.chunkIndex);
  const totalChunks = Number(payload.totalChunks);
  const projectId = String(payload.projectId || "").trim();
  const folderKey = customerFolderKey_(payload);
  if (!year || month < 1 || month > 12 || !projectId || chunkIndex < 0 || totalChunks < 1 || chunkIndex >= totalChunks) {
    throw new Error("Thi\u1ebfu th\u00f4ng tin \u0111o\u1ea1n ghi \u00e2m c\u1ea7n x\u1eed l\u00fd.");
  }
  const baseName = audioChunkBaseName_(folderKey, chunkIndex, totalChunks) + ".";
  const audioFolder = getAudioFolderForPayload_(payload, false);
  let audioFile = findFileByPrefix_(audioFolder, baseName);
  if (!audioFile && folderKey !== projectId) audioFile = findFileByPrefix_(audioFolder, audioChunkBaseName_(projectId, chunkIndex, totalChunks) + ".");
  if (!audioFile) throw new Error("Kh\u00f4ng t\u00ecm th\u1ea5y \u0111o\u1ea1n ghi \u00e2m " + (chunkIndex + 1) + "/" + totalChunks + " tr\u00ean Drive.");
  const blob = audioFile.getBlob();
  const result = transcribeAudio_({ audio: { fileName: audioFile.getName(), mimeType: audioMimeType_(audioFile.getName(), blob.getContentType()), data: Utilities.base64Encode(blob.getBytes()) } });
  result.chunkIndex = chunkIndex;
  result.totalChunks = totalChunks;
  return result;
}

function audioChunkBaseName_(projectId, chunkIndex, totalChunks) {
  return "Ghi \u00e2m " + projectId + " - ph\u1ea7n " + padAudioNumber_(chunkIndex + 1) + "-" + padAudioNumber_(totalChunks);
}

function padAudioNumber_(value) {
  return ("000" + Number(value)).slice(-3);
}

function audioMimeType_(fileName, contentType) {
  if (/^audio\//i.test(contentType || "")) return contentType;
  const extension = String(fileName || "").toLowerCase().split(".").pop();
  return { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac" }[extension] || "audio/wav";
}

function generateGeminiJson_(apiKey, contents, responseSchema) {
  const response = UrlFetchApp.fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent", {
    method: "post",
    contentType: "application/json",
    headers: { "x-goog-api-key": apiKey },
    payload: JSON.stringify({ contents: contents, generationConfig: { responseMimeType: "application/json", responseSchema: responseSchema } }),
    muteHttpExceptions: true,
  });
  const responseText = response.getContentText();
  let result;
  try { result = JSON.parse(responseText || "{}"); } catch (error) { throw new Error("Gemini tr\u1ea3 v\u1ec1 d\u1eef li\u1ec7u kh\u00f4ng \u0111\u00fang \u0111\u1ecbnh d\u1ea1ng."); }
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error((result.error && result.error.message) || "Gemini kh\u00f4ng th\u1ec3 x\u1eed l\u00fd b\u1ea3n ghi \u00e2m.");
  }
  const parts = result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts;
  const text = (parts || []).map(function(part) { return part.text || ""; }).join("").trim();
  if (!text) throw new Error("Gemini kh\u00f4ng tr\u1ea3 v\u1ec1 n\u1ed9i dung.");
  try { return JSON.parse(text); } catch (error) { throw new Error("Gemini tr\u1ea3 v\u1ec1 d\u1eef li\u1ec7u kh\u00f4ng \u0111\u00fang \u0111\u1ecbnh d\u1ea1ng."); }
}

function splitTranscript_(text) {
  const lines = text.split("\n").filter(Boolean);
  const chunks = [];
  let current = "";
  lines.forEach(function(line) {
    if (current && current.length + line.length + 1 > 6500) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  });
  if (current) chunks.push(current);
  return chunks;
}

function driveScopedCacheKey_(key) {
  const rootId = configuredRootFolderId_();
  const revision = PropertiesService.getScriptProperties().getProperty("gmcrm-customer-tree-revision-" + rootId) || "";
  return "gmcrm-root-" + rootId + (revision ? "-r" + revision : "") + "-" + key;
}

function readCachedJson_(key) {
  try {
    const raw = CacheService.getScriptCache().get(driveScopedCacheKey_(key));
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function cacheJson_(key, value, seconds) {
  try {
    CacheService.getScriptCache().put(driveScopedCacheKey_(key), JSON.stringify(value), seconds);
  } catch (error) {
    // A large result simply bypasses the server cache; Drive loading still works.
  }
}

function loadConsultingWorkspace_(payload) {
  const root = rootFolder_();
  const customers = findFolder_(root, CUSTOMERS_FOLDER_NAME);
  if (!customers) return { ok: true, years: [] };

  const mode = String(payload.mode || "index");
  const refresh = Boolean(payload.refresh);
  if (mode === "detail") return loadCustomerDetail_(customers, payload);
  if (mode === "progress") return loadCustomerProgress_(customers, payload);
  if (mode === "search") {
    const query = String(payload.query || "").trim();
    const cacheKey = "gmcrm-search-" + Utilities.base64EncodeWebSafe(query).slice(0, 120);
    const cached = refresh ? null : readCachedJson_(cacheKey);
    if (cached) return cached;
    const result = { ok: true, years: searchCustomerIndex_(customers, query) };
    cacheJson_(cacheKey, result, 180);
    return result;
  }

  const timezone = "Asia/Ho_Chi_Minh";
  const now = new Date();
  const year = Number(payload.year || Utilities.formatDate(now, timezone, "yyyy"));
  const month = Number(payload.month || Utilities.formatDate(now, timezone, "M"));
  const cacheKey = "gmcrm-index-" + year + "-" + month;
  const cached = refresh ? null : readCachedJson_(cacheKey);
  if (cached) return cached;
  const result = { ok: true, years: loadMonthCustomerIndex_(customers, year, month) };
  cacheJson_(cacheKey, result, 300);
  return result;
}

// Small read-only diagnostic used to verify that the configured root is the
// same folder level as the user's Drive/Shared drives path. It intentionally
// returns names and folder flags only (never file contents).
function inspectDriveTree_(payload) {
  const root = rootFolder_();
  const maxDepth = Math.min(Math.max(Number(payload.depth || 2), 1), 3);
  const maxItems = Math.min(Math.max(Number(payload.limit || 200), 1), 500);
  const walk = function(folder, depth) {
    const result = { name: folder.getName(), id: folder.getId(), children: [] };
    if (depth >= maxDepth) return result;
    const folders = folder.getFolders();
    while (folders.hasNext() && result.children.length < maxItems) {
      result.children.push(walk(folders.next(), depth + 1));
    }
    return result;
  };
  return { ok: true, root: walk(root, 0) };
}

// A random token in the published link selects one read-only project snapshot.
function customerPortalShare_(payload) {
  const shareToken = normalizeCustomerShareToken_(payload.shareToken);
  if (!shareToken) throw new Error("Link xem dự án không hợp lệ.");
  const root = rootFolder_();
  const customers = findFolder_(root, CUSTOMERS_FOLDER_NAME);
  const match = customers && findCustomerPortalShare_(customers, shareToken);
  if (!match) throw new Error("Link xem dự án đã hết hạn hoặc không hợp lệ.");
  const record = recordFromWorkbook_(match.workbook, match.projectId, match.customerFolder, true);
  return { ok: true, record: customerPortalRecord_(record) };
}

function normalizeCustomerShareToken_(value) {
  const token = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{48}$/.test(token) ? token : "";
}

function findCustomerPortalShare_(customers, shareToken) {
  const years = customers.getFolders();
  while (years.hasNext()) {
    const yearFolder = years.next();
    if (!/^\d{4}$/.test(yearFolder.getName())) continue;
    const months = yearFolder.getFolders();
    while (months.hasNext()) {
      const monthFolder = months.next();
      if (!/^T(?:1[0-2]|[1-9])$/.test(monthFolder.getName())) continue;
      const projects = monthFolder.getFolders();
      while (projects.hasNext()) {
        const customerFolder = projects.next();
        const projectId = customerFolder.getName();
        if (projectId.indexOf("-") === 0) continue;
        const workbook = latestCustomerWorkbook_(customerFolder, projectId);
        if (!workbook) continue;
        const sheets = readXlsxSheets_(workbook);
        const metadata = keyValueRows_(sheets["0. GM-CRM"] || []);
        if (normalizeCustomerShareToken_(metadata.customerShareToken) === shareToken) return { customerFolder: customerFolder, projectId: projectId, workbook: workbook };
      }
    }
  }
  return null;
}

function customerPortalProgressRows_(rows) {
  return (rows || []).filter(function(row) {
    return row && (row.content || row.plannedDate || row.actualDate || row.reportedDate || row.completedDate);
  }).map(function(row) {
    return {
      content: String(row.content || ""),
      plannedDate: String(row.plannedDate || row.reportedDate || ""),
      actualDate: String(row.actualDate || row.completedDate || ""),
    };
  });
}

function customerPortalRecord_(record) {
  return {
    projectId: String(record.projectId || ""),
    name: String(record.name || ""),
    houseId: String(record.houseId || ""),
    designProgress: customerPortalProgressRows_(record.designProgress),
    interiorDesignProgress: customerPortalProgressRows_(record.interiorDesignProgress),
    acceptanceDesignProgress: customerPortalProgressRows_(record.acceptanceDesignProgress),
    warrantyProgress: customerPortalProgressRows_(record.warrantyProgress),
  };
}

function monthResult_(year, month, records) {
  return [{ year: Number(year), months: [{ label: "T" + Number(month), records: records }] }];
}

function loadMonthCustomerIndex_(customers, year, month) {
  if (!/^\d{4}$/.test(String(year)) || month < 1 || month > 12) return [];
  const yearFolder = findFolder_(customers, String(year));
  const monthFolder = yearFolder && findFolder_(yearFolder, "T" + month);
  if (!monthFolder) return monthResult_(year, month, []);
  const recordsByHouse = {};
  const customerFolders = monthFolder.getFolders();
  while (customerFolders.hasNext()) {
    const customerFolder = customerFolders.next();
    const projectId = customerFolder.getName();
    if (projectId.indexOf("-") === 0) continue;
    const record = fastCustomerIndexFromFolder_(projectId, customerFolder);
    if (!record) continue;
    const key = normalizeDriveName_(record.houseId || record.projectId);
    const previous = recordsByHouse[key];
    if (!previous || customerIndexPriority_(record) > customerIndexPriority_(previous)) recordsByHouse[key] = record;
  }
  return monthResult_(year, month, Object.keys(recordsByHouse).map(function(key) { return recordsByHouse[key]; }));
}

function customerIndexPriority_(record) {
  let score = 0;
  if (record && record.houseId) score += 100;
  if (record && record.projectId && record.projectId === record.houseId) score += 20;
  if (record && record.projectId && !/^GM\d{2}\d{2}\d{4}/i.test(record.projectId)) score += 10;
  return score;
}

function dedupeCustomerIndexRecords_(records) {
  const recordsByHouse = {};
  (records || []).forEach(function(record) {
    if (!record) return;
    const key = normalizeDriveName_(record.houseId || record.projectId);
    const previous = recordsByHouse[key];
    if (!previous || customerIndexPriority_(record) > customerIndexPriority_(previous)) recordsByHouse[key] = record;
  });
  return Object.keys(recordsByHouse).map(function(key) { return recordsByHouse[key]; });
}

function fastCustomerIndexFromFolder_(folderName, customerFolder) {
  const dateMatch = /^GM(\d{2})(\d{2})(\d{4})/.exec(folderName);
  const isLegacyProjectFolder = Boolean(dateMatch);
  const houseId = isLegacyProjectFolder ? customerHouseIdFromFolder_(customerFolder, folderName) : folderName;
  let driveUpdatedAt = "";
  try {
    if (customerFolder && customerFolder.getLastUpdated) driveUpdatedAt = customerFolder.getLastUpdated().toISOString();
  } catch (error) {
    // Folder timestamps are an optional hint; the customer index remains
    // usable on deployments where Drive does not expose them.
  }
  return {
    id: "drive-" + folderName,
    driveFolderId: customerFolder && customerFolder.getId ? customerFolder.getId() : "",
    name: "",
    houseId: houseId,
    projectId: folderName,
    createdAt: dateMatch ? dateMatch[1] + "/" + dateMatch[2] + "/" + dateMatch[3] : "",
    driveUpdatedAt: driveUpdatedAt,
    details: {},
    isHydrated: false,
  };
}

function customerHouseIdFromFolder_(customerFolder, projectId) {
  if (!customerFolder || !/^GM\d{2}\d{2}\d{4}/i.test(String(projectId || ""))) return "";
  try {
    const workbook = latestCustomerWorkbook_(customerFolder, projectId);
    if (!workbook) return "";
    const sheets = readXlsxSheets_(workbook);
    const metadata = keyValueRows_(sheets["0. GM-CRM"] || []);
    return String(metadata.houseId || "").trim();
  } catch (error) {
    return "";
  }
}

function loadCustomerDetail_(customers, payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  if (!/^\d{4}$/.test(String(year)) || month < 1 || month > 12 || !projectId) {
    throw new Error("Thi\u1ebfu th\u00f4ng tin h\u1ed3 s\u01a1 c\u1ea7n n\u1ea1p.");
  }
  const yearFolder = findFolder_(customers, String(year));
  const monthFolder = yearFolder && findFolder_(yearFolder, "T" + month);
  const customerFolder = customerFolderForPayload_(payload, false);
  if (!customerFolder) throw new Error("Kh\u00f4ng t\u00ecm th\u1ea5y th\u01b0 m\u1ee5c h\u1ed3 s\u01a1 tr\u00ean Drive.");
  const workbook = latestCustomerWorkbook_(customerFolder, projectId);
  if (!workbook) throw new Error("Kh\u00f4ng t\u00ecm th\u1ea5y Phi\u1ebfu th\u00f4ng tin kh\u00e1ch h\u00e0ng trong th\u01b0 m\u1ee5c T\u01b0 v\u1ea5n.");
  const includeProgress = payload.includeProgress !== false;
  const record = recordFromWorkbook_(workbook, projectId, customerFolder, includeProgress);
  record.isHydrated = true;
  return { ok: true, year: year, month: month, record: record };
}

function loadCustomerProgress_(customers, payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  if (!/^\d{4}$/.test(String(year)) || month < 1 || month > 12 || !projectId) {
    throw new Error("Thi\u1ebfu th\u00f4ng tin ti\u1ebfn \u0111\u1ed9 c\u1ea7n n\u1ea1p.");
  }
  const yearFolder = findFolder_(customers, String(year));
  const monthFolder = yearFolder && findFolder_(yearFolder, "T" + month);
  const customerFolder = customerFolderForPayload_(payload, false);
  if (!customerFolder) throw new Error("Kh\u00f4ng t\u00ecm th\u1ea5y th\u01b0 m\u1ee5c h\u1ed3 s\u01a1 tr\u00ean Drive.");
  return {
    ok: true,
    year: year,
    month: month,
    record: {
      projectId: projectId,
      driveFolderId: customerFolder.getId(),
      houseId: String(payload.houseId || ""),
      designProgress: readDesignProgress_(customerFolder, projectId, "architecture"),
      interiorDesignProgress: readDesignProgress_(customerFolder, projectId, "interior"),
      acceptanceDesignProgress: readDesignProgress_(customerFolder, projectId, "acceptance"),
      warrantyProgress: readWarrantyProgress_(customerFolder, projectId),
      progressHydrated: true,
    },
  };
}

function customerIndexFromFolder_(customerFolder, projectId) {
  const workbook = latestCustomerWorkbook_(customerFolder, projectId);
  if (!workbook) return null;
  const record = customerIndexFromWorkbook_(workbook, projectId);
  record.driveFolderId = customerFolder.getId();
  return record;
}

function customerIndexFromWorkbook_(file, projectId) {
  const sheets = readXlsxSheets_(file);
  const metadata = keyValueRows_(sheets["0. GM-CRM"] || []);
  const dateMatch = /^GM(\d{2})(\d{2})(\d{4})/.exec(projectId);
  return {
    id: "drive-" + projectId,
    name: metadata.name || metadata.houseId || projectId,
    houseId: metadata.houseId || "",
    projectId: metadata.projectId || projectId,
    createdAt: normalizeExcelDate_(metadata.createdAt) || (dateMatch ? dateMatch[1] + "/" + dateMatch[2] + "/" + dateMatch[3] : ""),
    details: {},
    isHydrated: false,
  };
}

function searchCustomerIndex_(customers, query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return [];
  const directProjectMatches = searchExactProjectId_(customers, String(query || "").trim());
  if (directProjectMatches.length) return directProjectMatches;
  const resultsByPeriod = {};
  let resultCount = 0;
  const yearFolders = customers.getFolders();
  while (yearFolders.hasNext() && resultCount < 16) {
    const yearFolder = yearFolders.next();
    const yearName = yearFolder.getName();
    if (yearName.indexOf("-") === 0 || !/^\d{4}$/.test(yearName)) continue;
    const monthFolders = yearFolder.getFolders();
    while (monthFolders.hasNext() && resultCount < 16) {
      const monthFolder = monthFolders.next();
      const match = /^T(1[0-2]|[1-9])$/.exec(monthFolder.getName());
      if (monthFolder.getName().indexOf("-") === 0 || !match) continue;
      const customerFolders = monthFolder.getFolders();
      while (customerFolders.hasNext() && resultCount < 16) {
        const customerFolder = customerFolders.next();
        const projectId = customerFolder.getName();
        if (projectId.indexOf("-") === 0) continue;
        const record = customerIndexFromFolder_(customerFolder, projectId);
        if (!record) continue;
        const haystack = [record.name, record.houseId, record.projectId].join(" ").toLowerCase();
        if (haystack.indexOf(normalized) === -1) continue;
        const periodKey = yearName + "/" + match[1];
        if (!resultsByPeriod[periodKey]) resultsByPeriod[periodKey] = { year: Number(yearName), months: [{ label: "T" + Number(match[1]), records: [] }] };
        resultsByPeriod[periodKey].months[0].records.push(record);
        resultCount += 1;
      }
    }
  }
  return Object.keys(resultsByPeriod).map(function(key) {
    const result = resultsByPeriod[key];
    result.months[0].records = dedupeCustomerIndexRecords_(result.months[0].records);
    return result;
  }).sort(function(a, b) {
    return b.year - a.year || Number(b.months[0].label.slice(1)) - Number(a.months[0].label.slice(1));
  });
}

function searchExactProjectId_(customers, projectId) {
  // Drive resolves an exact folder name from its index. This keeps a pasted
  // house code from triggering a month-by-month scan of every customer.
  if (!validCustomerFolderKey_(projectId)) return [];
  const resultsByPeriod = {};
  const folders = DriveApp.getFoldersByName(projectId);
  while (folders.hasNext()) {
    const customerFolder = folders.next();
    const monthParents = customerFolder.getParents();
    if (!monthParents.hasNext()) continue;
    const monthFolder = monthParents.next();
    const monthMatch = /^T(1[0-2]|[1-9])$/.exec(monthFolder.getName());
    if (!monthMatch) continue;
    const yearParents = monthFolder.getParents();
    if (!yearParents.hasNext()) continue;
    const yearFolder = yearParents.next();
    const yearName = yearFolder.getName();
    if (!/^\d{4}$/.test(yearName)) continue;
    const customersParents = yearFolder.getParents();
    if (!customersParents.hasNext() || customersParents.next().getId() !== customers.getId()) continue;
    const record = customerIndexFromFolder_(customerFolder, projectId);
    if (!record) continue;
    const key = yearName + "/" + monthMatch[1];
    if (!resultsByPeriod[key]) resultsByPeriod[key] = { year: Number(yearName), months: [{ label: "T" + Number(monthMatch[1]), records: [] }] };
    resultsByPeriod[key].months[0].records.push(record);
  }
  return Object.keys(resultsByPeriod).map(function(key) { return resultsByPeriod[key]; }).sort(function(a, b) {
    return b.year - a.year || Number(b.months[0].label.slice(1)) - Number(a.months[0].label.slice(1));
  });
}

function latestWorkbook_(folder) {
  const files = folder.getFiles();
  let latest = null;
  while (files.hasNext()) {
    const file = files.next();
    if (!/\.xlsx$/i.test(file.getName())) continue;
    if (!latest || file.getLastUpdated().getTime() > latest.getLastUpdated().getTime()) latest = file;
  }
  return latest;
}

function latestCustomerWorkbook_(customerFolder, projectId) {
  const fileName = "Phi\u1ebfu th\u00f4ng tin kh\u00e1ch h\u00e0ng " + projectId + ".xlsx";
  const consultingFolder = findFolder_(customerFolder, "T\u01b0 v\u1ea5n");
  const currentWorkbook = consultingFolder ? findFileByName_(consultingFolder, fileName) : null;
  if (currentWorkbook) return currentWorkbook;

  // House-code folders may contain a workbook whose filename was generated
  // with the house code, while older cached records still pass the internal
  // GM project id. Keep both generations readable by selecting the newest
  // customer workbook in the Tư vấn folder before falling back to the old
  // project-id filename at the customer-folder root.
  let latestHouseWorkbook = null;
  if (consultingFolder) {
    const files = consultingFolder.getFiles();
    while (files.hasNext()) {
      const candidate = files.next();
      if (!/^Phi\u1ebfu th\u00f4ng tin kh\u00e1ch h\u00e0ng .*\.xlsx$/i.test(candidate.getName())) continue;
      if (!latestHouseWorkbook || candidate.getLastUpdated().getTime() > latestHouseWorkbook.getLastUpdated().getTime()) latestHouseWorkbook = candidate;
    }
  }
  if (latestHouseWorkbook) return latestHouseWorkbook;

  // Migrate the former project-root workbook exactly once, preserving the file
  // while putting it into the required T\u01b0 v\u1ea5n folder.
  const legacyWorkbook = findFileByName_(customerFolder, fileName);
  if (!legacyWorkbook) return null;
  const targetFolder = consultingFolder || getOrCreateFolder_(customerFolder, "T\u01b0 v\u1ea5n");
  legacyWorkbook.moveTo(targetFolder);
  return legacyWorkbook;
}

function latestDesignProgressWorkbook_(customerFolder, progressKind) {
  const designFolder = findFolder_(customerFolder, "Thi\u1ebft k\u1ebf");
  if (!designFolder) return null;
  const filePattern = progressKind === "interior"
    ? /^Ti\u1ebfn \u0111\u1ed9 thi\u1ebft k\u1ebf n\u1ed9i th\u1ea5t.*\.xlsx$/i
    : progressKind === "acceptance"
      ? /^Ti\u1ebfn \u0111\u1ed9 thi\u1ebft k\u1ebf nghi\u1ec7m thu.*\.xlsx$/i
      : /^Ti\u1ebfn \u0111\u1ed9 thi\u1ebft k\u1ebf ki\u1ebfn tr\u00fac.*\.xlsx$/i;
  const files = designFolder.getFiles();
  let latest = null;
  while (files.hasNext()) {
    const file = files.next();
    if (!filePattern.test(file.getName())) continue;
    if (!latest || file.getLastUpdated().getTime() > latest.getLastUpdated().getTime()) latest = file;
  }
  return latest;
}

function recordFromWorkbook_(file, projectId, customerFolder, includeProgress) {
  const sheets = readXlsxSheets_(file);
  const metadata = keyValueRows_(sheets["0. GM-CRM"] || []);
  const details = {};
  ["1. Ch\u1ee7 \u0111\u1ea7u t\u01b0", "2. Nhu c\u1ea7u", "3. Th\u1eeda \u0111\u1ea5t", "5. H\u1ec7 th\u1ed1ng"].forEach(function(name) {
    (sheets[name] || []).slice(1).forEach(function(row) {
      const code = String(row[0] || "").trim();
      if (code) details[code] = code === "NS" ? normalizeExcelDate_(row[2]) : String(row[2] || "");
    });
  });

  const floorsByName = {};
  (sheets["4. C\u00f4ng n\u0103ng"] || []).slice(1).forEach(function(row, index) {
    const floor = String(row[0] || "T\u1ea7ng 1");
    const room = { id: "drive-room-" + projectId + "-" + index, room: String(row[1] || ""), quantity: String(row[2] || ""), description: String(row[3] || "") };
    if (!room.room && !room.quantity && !room.description) return;
    if (!floorsByName[floor]) floorsByName[floor] = { id: "drive-floor-" + projectId + "-" + Object.keys(floorsByName).length, floor: floor, rooms: [] };
    floorsByName[floor].rooms.push(room);
  });

  const audioSheet = sheets["6. Th\u00f4ng tin ghi \u00e2m"] || [];
  const audioRows = audioSheet.slice(1);
  const audioChunks = [];
  const audioHeader = audioSheet[0] || [];
  const isChunkedAudio = String(audioHeader[1] || "") === "Lo\u1ea1i";
  const isTranscriptOnlyAudio = String(audioHeader[1] || "") === "M\u1ed1c th\u1eddi gian";
  if (isChunkedAudio) {
    const chunksByIndex = {};
    audioRows.forEach(function(row) {
      const index = Math.max(0, Number(row[0] || 1) - 1);
      const type = String(row[1] || "");
      const time = String(row[2] || "");
      const content = String(row[3] || "");
      if (!content) return;
      if (type === "T\u00f3m t\u1eaft") return;
      if (!chunksByIndex[index]) chunksByIndex[index] = { index: index, segments: [] };
      chunksByIndex[index].segments.push({ time: time || "~", text: content });
    });
    Object.keys(chunksByIndex).sort(function(a, b) { return Number(a) - Number(b); }).forEach(function(index) { audioChunks.push(chunksByIndex[index]); });
  } else if (isTranscriptOnlyAudio) {
    const chunksByIndex = {};
    audioRows.forEach(function(row) {
      const index = Math.max(0, Number(row[0] || 1) - 1);
      const time = String(row[1] || "");
      const text = String(row[2] || "");
      if (!text) return;
      if (!chunksByIndex[index]) chunksByIndex[index] = { index: index, segments: [] };
      chunksByIndex[index].segments.push({ time: time || "~", text: text });
    });
    Object.keys(chunksByIndex).sort(function(a, b) { return Number(a) - Number(b); }).forEach(function(index) { audioChunks.push(chunksByIndex[index]); });
  } else {
    const legacySegments = [];
    audioRows.forEach(function(row) {
      const time = String(row[0] || "");
      const text = String(row[1] || "");
      if (text) legacySegments.push({ time: time || "~", text: text });
    });
    if (legacySegments.length) audioChunks.push({ index: 0, segments: legacySegments });
  }
  const segments = [];
  audioChunks.forEach(function(chunk) {
    Array.prototype.push.apply(segments, chunk.segments || []);
  });
  const inferredCompletedChunks = audioChunks.reduce(function(completed, chunk) { return chunk.index === completed ? completed + 1 : completed; }, 0);
  const totalChunks = Number(metadata.audioTotalChunks || 0) || (audioChunks.length ? Math.max.apply(null, audioChunks.map(function(chunk) { return chunk.index + 1; })) : 0);
  const completedChunks = metadata.audioCompletedChunks === undefined || metadata.audioCompletedChunks === "" ? inferredCompletedChunks : Number(metadata.audioCompletedChunks);

  const dateMatch = /^GM(\d{2})(\d{2})(\d{4})/.exec(projectId);
  const createdAt = normalizeExcelDate_(metadata.createdAt) || (dateMatch ? dateMatch[1] + "/" + dateMatch[2] + "/" + dateMatch[3] : "");
  const record = {
    id: "drive-" + projectId,
    driveFolderId: customerFolder && customerFolder.getId ? customerFolder.getId() : "",
    name: metadata.name || details.HVT || metadata.houseId || projectId,
    houseId: metadata.houseId || "",
    customerShareToken: metadata.customerShareToken || "",
    projectId: metadata.projectId || projectId,
    createdAt: createdAt,
    details: details,
    functionalFloors: Object.keys(floorsByName).map(function(name) { return floorsByName[name]; }),
  };
  if (includeProgress !== false) {
    record.designProgress = readDesignProgress_(customerFolder, projectId, "architecture");
    record.interiorDesignProgress = readDesignProgress_(customerFolder, projectId, "interior");
    record.acceptanceDesignProgress = readDesignProgress_(customerFolder, projectId, "acceptance");
    record.warrantyProgress = readWarrantyProgress_(customerFolder, projectId);
    record.progressHydrated = true;
  } else {
    record.progressHydrated = false;
  }
  if (segments.length || metadata.audioFileName || totalChunks) {
    record.audioNote = {
      fileName: metadata.audioFileName || "Ghi \u00e2m trong " + file.getName(),
      language: metadata.audioLanguage || "Ti\u1ebfng Vi\u1ec7t",
      updatedAt: Utilities.formatDate(file.getLastUpdated(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"),
      segments: segments,
      chunks: audioChunks,
      totalChunks: totalChunks,
      completedChunks: completedChunks,
      status: metadata.audioStatus || (totalChunks && completedChunks >= totalChunks ? "complete" : "processing"),
    };
  }
  return record;
}

function readDesignProgress_(customerFolder, projectId, progressKind) {
  const workbook = latestDesignProgressWorkbook_(customerFolder, progressKind);
  if (!workbook) return [];
  const sheets = readXlsxSheets_(workbook);
  const rows = sheets["Ti\u1ebfn \u0111\u1ed9"] || sheets[Object.keys(sheets)[0]] || [];
  const header = rows[0] || [];
  const hasAssignee = String(header[3] || "") === "Ng\u01b0\u1eddi ph\u1ee5 tr\u00e1ch";
  const noteColumn = hasAssignee ? 4 : 3;
  const idColumn = hasAssignee ? 5 : 4;
  const customColumn = hasAssignee ? 6 : 5;
  const fixedContents = progressKind === "interior"
    ? ["Ki\u1ec3m tra v\u00e0 kh\u1edbp MBCN", "T\u01b0 v\u1ea5n concept n\u1ed9i th\u1ea5t", "Ph\u1ed1i c\u1ea3nh 3D n\u1ed9i th\u1ea5t", "H\u1ed3 s\u01a1 k\u1ef9 thu\u1eadt n\u1ed9i th\u1ea5t", "Nghi\u1ec7m thu v\u00e0 b\u00e0n giao"]
    : ["T\u01b0 v\u1ea5n concept", "M\u1eb7t b\u1eb1ng c\u00f4ng n\u0103ng", "Ph\u1ed1i c\u1ea3nh 3D", "H\u1ed3 s\u01a1 k\u1ef9 thu\u1eadt", "Nghi\u1ec7m thu v\u00e0 b\u00e0n giao"];
  const prefix = progressKind === "interior" ? "interior-design" : progressKind === "acceptance" ? "acceptance-design" : "design";
  return rows.slice(1).filter(function(row) {
    return row.slice(0, customColumn + 1).some(function(value) { return String(value || "").trim(); });
  }).map(function(row, index) {
    const content = String(row[0] || "");
    const customCell = String(row[customColumn] || "").toLowerCase();
    return {
      id: String(row[idColumn] || (prefix + "-drive-" + projectId + "-" + index)),
      isCustom: customCell ? customCell === "true" || customCell === "1" || customCell === "t\u00f9y ch\u1ec9nh" : fixedContents.indexOf(content) === -1,
      content: content,
      plannedDate: normalizeExcelDate_(row[1]),
      actualDate: normalizeExcelDate_(row[2]),
      assignee: hasAssignee ? String(row[3] || "") : "",
      assigneeEmail: String(row[7] || "").trim().toLowerCase(),
      acceptedAt: String(row[8] || ""),
      acceptedBy: String(row[9] || "").trim().toLowerCase(),
      publishedAt: String(row[10] || ""),
      note: String(row[noteColumn] || ""),
    };
  });
}

function latestWarrantyWorkbook_(customerFolder) {
  const warrantyFolder = findFolder_(customerFolder, "B\u1ea3o h\u00e0nh");
  if (!warrantyFolder) return null;
  const files = warrantyFolder.getFiles();
  let latest = null;
  while (files.hasNext()) {
    const file = files.next();
    if (!/^Phi\u1ebfu th\u00f4ng tin b\u1ea3o h\u00e0nh.*\.xlsx$/i.test(file.getName())) continue;
    if (!latest || file.getLastUpdated().getTime() > latest.getLastUpdated().getTime()) latest = file;
  }
  return latest;
}

function readWarrantyProgress_(customerFolder, projectId) {
  const workbook = latestWarrantyWorkbook_(customerFolder);
  if (!workbook) return [];
  const sheets = readXlsxSheets_(workbook);
  const rows = sheets["B\u1ea3o h\u00e0nh"] || sheets[Object.keys(sheets)[0]] || [];
  const fixedContents = ["Ng\u00e0y ho\u00e0n th\u00e0nh thi c\u00f4ng n\u1ed9i th\u1ea5t", "Ng\u00e0y ho\u00e0n th\u00e0nh thi c\u00f4ng ki\u1ebfn tr\u00fac", "Th\u1eddi gian b\u1ea3o h\u00e0nh", "Chi ph\u00ed b\u1ea3o h\u00e0nh l\u1ea7n 1", "Chi ph\u00ed b\u1ea3o h\u00e0nh l\u1ea7n 2"];
  return rows.slice(1).filter(function(row) {
    return row.slice(0, 7).some(function(value) { return String(value || "").trim(); });
  }).map(function(row, index) {
    const content = String(row[0] || "");
    const customCell = String(row[6] || "").toLowerCase();
    return {
      id: String(row[5] || ("warranty-drive-" + projectId + "-" + index)),
      isCustom: customCell ? customCell === "true" || customCell === "1" || customCell === "t\u00f9y ch\u1ec9nh" : fixedContents.indexOf(content) === -1,
      content: content,
      reportedDate: normalizeExcelDate_(row[1]),
      completedDate: normalizeExcelDate_(row[2]),
      assignee: String(row[3] || ""),
      note: String(row[4] || ""),
    };
  });
}

function readXlsxSheets_(file) {
  const entries = {};
  // XLSX is a ZIP archive, but Drive preserves the Excel MIME type. Utilities.unzip
  // requires application/zip, so normalize only the in-memory blob before reading it.
  const xlsxArchive = file.getBlob().setContentType("application/zip");
  Utilities.unzip(xlsxArchive).forEach(function(blob) { entries[blob.getName()] = blob.getDataAsString("UTF-8"); });
  const sharedStrings = readSharedStrings_(entries["xl/sharedStrings.xml"]);
  const workbook = XmlService.parse(entries["xl/workbook.xml"]).getRootElement();
  const workbookNs = workbook.getNamespace();
  const relationshipNs = XmlService.getNamespace("r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships");
  const relationshipRoot = XmlService.parse(entries["xl/_rels/workbook.xml.rels"]).getRootElement();
  const relationshipMap = {};
  relationshipRoot.getChildren("Relationship", relationshipRoot.getNamespace()).forEach(function(relationship) {
    relationshipMap[relationship.getAttribute("Id").getValue()] = relationship.getAttribute("Target").getValue();
  });
  const sheets = {};
  const sheetsElement = workbook.getChild("sheets", workbookNs);
  (sheetsElement ? sheetsElement.getChildren("sheet", workbookNs) : []).forEach(function(sheet) {
    const relationship = sheet.getAttribute("id", relationshipNs);
    const target = relationship && relationshipMap[relationship.getValue()];
    if (!target) return;
    const path = "xl/" + target.replace(/^\.\//, "");
    sheets[sheet.getAttribute("name").getValue()] = readWorksheetRows_(entries[path], sharedStrings);
  });
  return sheets;
}

function readSharedStrings_(xml) {
  if (!xml) return [];
  const root = XmlService.parse(xml).getRootElement();
  const ns = root.getNamespace();
  return root.getChildren("si", ns).map(function(item) { return richText_(item, ns); });
}

function richText_(element, ns) {
  let text = element.getChildText("t", ns) || "";
  element.getChildren("r", ns).forEach(function(run) { text += run.getChildText("t", ns) || ""; });
  return text;
}

function readWorksheetRows_(xml, sharedStrings) {
  if (!xml) return [];
  const root = XmlService.parse(xml).getRootElement();
  const ns = root.getNamespace();
  const data = root.getChild("sheetData", ns);
  if (!data) return [];
  return data.getChildren("row", ns).map(function(row) {
    const values = [];
    row.getChildren("c", ns).forEach(function(cell) {
      const reference = cell.getAttribute("r") ? cell.getAttribute("r").getValue() : "A1";
      const column = columnIndex_(reference);
      const type = cell.getAttribute("t") ? cell.getAttribute("t").getValue() : "";
      const value = cell.getChildText("v", ns) || "";
      if (type === "s") values[column] = sharedStrings[Number(value)] || "";
      else if (type === "inlineStr") values[column] = richText_(cell.getChild("is", ns), ns);
      else values[column] = value;
    });
    return values;
  });
}

function normalizeExcelDate_(value) {
  const text = String(value === undefined || value === null ? "" : value).trim();
  const serial = /^([2-7]\d{4})(?:\.0+)?$/.exec(text);
  if (!serial) return text;
  const date = new Date(Date.UTC(1899, 11, 30) + Number(serial[1]) * 86400000);
  return Utilities.formatDate(date, "Asia/Ho_Chi_Minh", "dd/MM/yyyy");
}

function columnIndex_(reference) {
  const letters = (reference.match(/[A-Z]+/) || ["A"])[0];
  let value = 0;
  for (let index = 0; index < letters.length; index += 1) value = value * 26 + letters.charCodeAt(index) - 64;
  return value - 1;
}

function keyValueRows_(rows) {
  const values = {};
  rows.slice(1).forEach(function(row) {
    if (row[0]) values[String(row[0])] = String(row[1] || "");
  });
  return values;
}

function exportCustomerWorkbook_(record, year, month) {
  const folderKey = customerFolderKey_(record);
  const customerFolder = customerFolderForRecord_(record, year, month, true);
  const consultingFolder = getOrCreateFolder_(customerFolder, "T\u01b0 v\u1ea5n");
  const fileName = "Phi\u1ebfu th\u00f4ng tin kh\u00e1ch h\u00e0ng " + folderKey + ".xlsx";

  const spreadsheet = SpreadsheetApp.create("GM-CRM temporary " + folderKey);
  try {
    writeWorkbook_(spreadsheet, record);
    const xlsxBlob = exportXlsx_(spreadsheet.getId()).setName(fileName);
    const legacyWorkbook = findFileByName_(customerFolder, fileName);
    if (legacyWorkbook) legacyWorkbook.moveTo(consultingFolder);
    const xlsxFile = replaceWorkbookFile_(consultingFolder, fileName, xlsxBlob);
    return {
      fileId: xlsxFile.getId(),
      fileUrl: xlsxFile.getUrl(),
      folderUrl: consultingFolder.getUrl(),
      fileName: fileName,
    };
  } finally {
    try { DriveApp.getFileById(spreadsheet.getId()).setTrashed(true); } catch (error) { /* Preserve the original export result. */ }
  }
}

function exportDesignProgressWorkbook_(record, year, month, progressKind) {
  const folderKey = customerFolderKey_(record);
  const customerFolder = customerFolderForRecord_(record, year, month, true);
  const designFolder = getOrCreateFolder_(customerFolder, "Thi\u1ebft k\u1ebf");
  const isInterior = progressKind === "interior";
  const isAcceptance = progressKind === "acceptance";
  const label = isInterior ? "n\u1ed9i th\u1ea5t" : isAcceptance ? "nghi\u1ec7m thu" : "ki\u1ebfn tr\u00fac";
  const fileName = "Ti\u1ebfn \u0111\u1ed9 thi\u1ebft k\u1ebf " + label + " " + folderKey + ".xlsx";
  const spreadsheet = SpreadsheetApp.create("GM-CRM " + label + " design progress temporary " + folderKey);
  try {
    const sheet = spreadsheet.getSheets()[0];
    sheet.setName("Ti\u1ebfn \u0111\u1ed9");
    const sourceRows = isInterior ? record.interiorDesignProgress || [] : isAcceptance ? record.acceptanceDesignProgress || [] : record.designProgress || [];
    const rows = sourceRows.map(function(row) {
      return [String(row.content || ""), String(row.plannedDate || ""), String(row.actualDate || ""), String(row.assignee || ""), String(row.note || ""), String(row.id || ""), row.isCustom ? "true" : "false", String(row.assigneeEmail || ""), String(row.acceptedAt || ""), String(row.acceptedBy || ""), String(row.publishedAt || "")];
    });
    const values = [["N\u1ed9i dung", "Ng\u00e0y d\u1ef1 ki\u1ebfn", "Ng\u00e0y th\u1ef1c t\u1ebf", "Ng\u01b0\u1eddi ph\u1ee5 tr\u00e1ch", "Ghi ch\u00fa", "_ID", "_T\u00f9y ch\u1ec9nh", "_Email ng\u01b0\u1eddi ph\u1ee5 tr\u00e1ch", "_\u0110\u00e3 nh\u1eadn", "_Ng\u01b0\u1eddi nh\u1eadn", "_Ph\u00e1t h\u00e0nh"]].concat(rows);
    sheet.getRange(1, 1, values.length, 11).setValues(values).setVerticalAlignment("top").setWrap(true).setFontFamily("Roboto");
    sheet.getRange(1, 1, 1, 11).setFontWeight("bold").setBackground("#eeeae5").setFontColor("#4f4b45");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 220);
    sheet.setColumnWidth(2, 125);
    sheet.setColumnWidth(3, 125);
    sheet.setColumnWidth(4, 160);
    sheet.setColumnWidth(5, 420);
    sheet.hideColumns(6, 6);
    sheet.autoResizeRows(1, Math.max(1, sheet.getLastRow()));
    const xlsxBlob = exportXlsx_(spreadsheet.getId()).setName(fileName);
    const xlsxFile = replaceWorkbookFile_(designFolder, fileName, xlsxBlob);
    return { fileId: xlsxFile.getId(), fileUrl: xlsxFile.getUrl(), folderUrl: designFolder.getUrl(), fileName: fileName };
  } finally {
    try { DriveApp.getFileById(spreadsheet.getId()).setTrashed(true); } catch (error) { /* Preserve the original export result. */ }
  }
}

function exportWarrantyWorkbook_(record, year, month) {
  const folderKey = customerFolderKey_(record);
  const customerFolder = customerFolderForRecord_(record, year, month, true);
  const warrantyFolder = getOrCreateFolder_(customerFolder, "B\u1ea3o h\u00e0nh");
  const fileName = "Phi\u1ebfu th\u00f4ng tin b\u1ea3o h\u00e0nh " + folderKey + ".xlsx";
  const spreadsheet = SpreadsheetApp.create("GM-CRM warranty temporary " + folderKey);
  try {
    const sheet = spreadsheet.getSheets()[0];
    sheet.setName("B\u1ea3o h\u00e0nh");
    const rows = (record.warrantyProgress || []).map(function(row) {
      return [String(row.content || ""), String(row.reportedDate || ""), String(row.completedDate || ""), String(row.assignee || ""), String(row.note || ""), String(row.id || ""), row.isCustom ? "true" : "false"];
    });
    const values = [["N\u1ed9i dung", "Ng\u00e0y b\u00e1o", "Ng\u00e0y ho\u00e0n th\u00e0nh", "Ng\u01b0\u1eddi ph\u1ee5 tr\u00e1ch", "Ghi ch\u00fa", "_ID", "_T\u00f9y ch\u1ec9nh"]].concat(rows);
    sheet.getRange(1, 1, values.length, 7).setValues(values).setVerticalAlignment("top").setWrap(true).setFontFamily("Roboto");
    sheet.getRange(1, 1, 1, 7).setFontWeight("bold").setBackground("#eeeae5").setFontColor("#4f4b45");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 270);
    sheet.setColumnWidth(2, 125);
    sheet.setColumnWidth(3, 145);
    sheet.setColumnWidth(4, 160);
    sheet.setColumnWidth(5, 420);
    sheet.hideColumns(6, 2);
    sheet.autoResizeRows(1, Math.max(1, sheet.getLastRow()));
    const xlsxBlob = exportXlsx_(spreadsheet.getId()).setName(fileName);
    const xlsxFile = replaceWorkbookFile_(warrantyFolder, fileName, xlsxBlob);
    return { fileId: xlsxFile.getId(), fileUrl: xlsxFile.getUrl(), folderUrl: warrantyFolder.getUrl(), fileName: fileName };
  } finally {
    try { DriveApp.getFileById(spreadsheet.getId()).setTrashed(true); } catch (error) { /* Preserve the original export result. */ }
  }
}

function writeWorkbook_(spreadsheet, record) {
  const sheetDefinitions = [
    ["0. GM-CRM", ["Kh\u00f3a", "Gi\u00e1 tr\u1ecb"], null],
    ["1. Ch\u1ee7 \u0111\u1ea7u t\u01b0", ["M\u00e3", "N\u1ed9i dung", "K\u1ebft qu\u1ea3 thu th\u1eadp"], [
      ["HVT", "H\u1ecd v\u00e0 t\u00ean"], ["NS", "Ng\u00e0y th\u00e1ng n\u0103m sinh"], ["DC", "\u0110\u1ecba ch\u1ec9"], ["SDT", "S\u1ed1 \u0111i\u1ec7n tho\u1ea1i/Zalo"], ["EMA", "Email"],
    ]],
    ["2. Nhu c\u1ea7u", ["M\u00e3", "N\u1ed9i dung", "K\u1ebft qu\u1ea3 thu th\u1eadp"], [
      ["NCT-KT", "Nhu c\u1ea7u thi\u1ebft k\u1ebf ki\u1ebfn tr\u00fac"], ["NCT-NT", "Nhu c\u1ea7u thi\u1ebft k\u1ebf n\u1ed9i th\u1ea5t"], ["NCT-NTU", "Nhu c\u1ea7u thi\u1ebft k\u1ebf nghi\u1ec7m thu"], ["NCC-KT", "Nhu c\u1ea7u thi c\u00f4ng ki\u1ebfn tr\u00fac"], ["NCC-NT", "Nhu c\u1ea7u thi c\u00f4ng n\u1ed9i th\u1ea5t"], ["PC-KT", "Phong c\u00e1ch ki\u1ebfn tr\u00fac"], ["PC-NT", "Phong c\u00e1ch n\u1ed9i th\u1ea5t"], ["QCTC", "Quy c\u00e1ch thi c\u00f4ng"],
    ]],
    ["3. Th\u1eeda \u0111\u1ea5t", ["M\u00e3", "N\u1ed9i dung", "K\u1ebft qu\u1ea3 thu th\u1eadp"], [
      ["QM", "Quy m\u00f4"], ["VTR", "V\u1ecb tr\u00ed c\u00f4ng tr\u00ecnh"], ["HNH", "H\u01b0\u1edbng nh\u00e0"], ["DTD", "Di\u1ec7n t\u00edch \u0111\u1ea5t"], ["DTX", "Di\u1ec7n t\u00edch x\u00e2y d\u1ef1ng"], ["VTMD", "V\u1ecb tr\u00ed so v\u1edbi m\u1eb7t \u0111\u01b0\u1eddng"],
    ]],
    ["4. C\u00f4ng n\u0103ng", ["T\u1ea7ng", "C\u00f4ng n\u0103ng", "S\u1ed1 l\u01b0\u1ee3ng", "M\u00f4 t\u1ea3 chi ti\u1ebft"], null],
    ["5. H\u1ec7 th\u1ed1ng", ["M\u00e3", "N\u1ed9i dung", "K\u1ebft qu\u1ea3 thu th\u1eadp"], [
      ["D", "\u0110i\u1ec7n"], ["N", "N\u01b0\u1edbc"], ["E", "N\u0103ng l\u01b0\u1ee3ng"], ["EL", "Thang m\u00e1y"], ["DR", "C\u1eeda"],
    ]],
    ["6. Th\u00f4ng tin ghi \u00e2m", ["Ph\u1ea7n", "M\u1ed1c th\u1eddi gian", "N\u1ed9i dung ghi \u00e2m"], null],
  ];

  sheetDefinitions.forEach(function(definition, index) {
    const name = definition[0];
    const headers = definition[1];
    const fieldRows = definition[2];
    const sheet = index === 0 ? spreadsheet.getSheets()[0] : spreadsheet.insertSheet();
    sheet.setName(name);
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontFamily("Roboto").setFontWeight("bold").setBackground("#eee9e2");

    if (name === "0. GM-CRM") {
      const note = record.audioNote || {};
      sheet.getRange(2, 1, 10, 2).setValues([
        ["projectId", record.projectId || ""], ["name", record.name || ""], ["houseId", record.houseId || ""], ["createdAt", record.createdAt || ""],
        ["audioLanguage", note.language || ""], ["audioFileName", note.fileName || ""], ["audioTotalChunks", note.totalChunks || ""],
        ["audioCompletedChunks", note.completedChunks || ""], ["audioStatus", note.status || ""],
        ["customerShareToken", record.customerShareToken || ""],
      ]);
    } else if (name === "4. C\u00f4ng n\u0103ng") {
      const rows = [];
      (record.functionalFloors || []).forEach(function(floor) {
        (floor.rooms || []).forEach(function(room) {
          if (room.room || room.quantity || room.description) rows.push([floor.floor || "T\u1ea7ng 1", room.room || "", room.quantity || "", room.description || ""]);
        });
      });
      if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    } else if (name === "6. Th\u00f4ng tin ghi \u00e2m") {
      const note = record.audioNote || {};
      const chunks = note.chunks && note.chunks.length ? note.chunks.slice().sort(function(a, b) { return a.index - b.index; }) :
        (note.segments && note.segments.length ? [{ index: 0, segments: note.segments || [] }] : []);
      const rows = [];
      chunks.forEach(function(chunk) {
        (chunk.segments || []).forEach(function(segment) {
          rows.push([Number(chunk.index) + 1, segment.time || "", segment.text || ""]);
        });
      });
      if (rows.length) {
        sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
        sheet.getRange(2, 1, rows.length, headers.length).setFontColor("#1F1F1D");
      }
    } else {
      const rows = fieldRows.map(function(field) {
        return [field[0], field[1], (record.details && record.details[field[0]]) || ""];
      });
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
    sheet.getDataRange().setFontFamily("Roboto").setWrap(true);
    sheet.setFrozenRows(1);
    if (name === "6. Th\u00f4ng tin ghi \u00e2m") {
      sheet.setColumnWidth(1, 55);
      sheet.setColumnWidth(2, 95);
      sheet.setColumnWidth(3, 520);
    } else {
      sheet.autoResizeColumns(1, headers.length);
    }
    sheet.autoResizeRows(1, Math.max(1, sheet.getLastRow()));
  });
  spreadsheet.getSheetByName("0. GM-CRM").hideSheet();
}

function exportXlsx_(spreadsheetId) {
  SpreadsheetApp.flush();
  const url = "https://www.googleapis.com/drive/v3/files/" + spreadsheetId + "/export?mimeType=" + encodeURIComponent(EXCEL_MIME);
  const response = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true, headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() } });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error("Không thể xuất Excel từ Google Sheets (HTTP " + response.getResponseCode() + "). Dữ liệu và tệp cũ được giữ nguyên.");
  const blob = response.getBlob();
  const mime = String(blob.getContentType() || "").split(";")[0].toLowerCase();
  const bytes = blob.getBytes();
  if ([EXCEL_MIME, "application/zip", "application/octet-stream"].indexOf(mime) < 0 || bytes.length < 4 || (bytes[0] & 255) !== 80 || (bytes[1] & 255) !== 75 || (bytes[2] & 255) !== 3 || (bytes[3] & 255) !== 4) throw new Error("Google chưa trả về tệp Excel hợp lệ. Dữ liệu và tệp cũ được giữ nguyên; hãy thử xuất lại.");
  return blob.setContentType(EXCEL_MIME);
}

function replaceWorkbookFile_(folder, fileName, blob, metadata) {
  const previous = [];
  const matches = folder.getFilesByName(fileName);
  while (matches.hasNext()) previous.push(matches.next());
  const created = folder.createFile(blob.setName(fileName));
  if (metadata && metadata.description) {
    try { created.setDescription(metadata.description); }
    catch (error) {
      try { created.setTrashed(true); } catch (cleanupError) { /* Keep old archives available even if cleanup is unavailable. */ }
      throw new Error("Chưa thể xác nhận thông tin tệp Excel mới. Tệp cũ vẫn được giữ nguyên để thử lưu lại.");
    }
  }
  previous.forEach(function(file) {
    if (file.getId() !== created.getId()) {
      try { file.setTrashed(true); } catch (error) { /* The new valid workbook exists; old copies remain recoverable. */ }
    }
  });
  return created;
}

function getOrCreateFolder_(parent, name) {
  const matches = findFolders_(parent, name);
  if (!matches.length) return parent.createFolder(name);
  const primary = matches[0];
  // Drive permits multiple children with the same name. Concurrent web
  // requests used to create those duplicates; Drive for desktop renders them
  // as "(1)", "(2)", ... . All mutating requests are now serialized, and an
  // old duplicate is folded into the primary folder without losing its data.
  matches.slice(1).forEach(function(duplicate) {
    mergeFolderInto_(primary, duplicate);
    duplicate.setTrashed(true);
  });
  return primary;
}

function driveFileViewUrl_(fileId) {
  return "https://drive.google.com/file/d/" + encodeURIComponent(fileId) + "/view";
}

function listWorkflowFiles_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  const folderKey = customerFolderKey_(payload);
  const workflow = String(payload.workflow || "").trim();
  const allowedWorkflows = ["Ghi chú", "T\u01b0 v\u1ea5n", "Thi\u1ebft k\u1ebf", "D\u1ef1 to\u00e1n", "Thi c\u00f4ng", "Nghi\u1ec7m thu", "B\u1ea3o h\u00e0nh"];
  if (!year || !month || !projectId || allowedWorkflows.indexOf(workflow) === -1) throw new Error("Thi\u1ebfu th\u00f4ng tin th\u01b0 m\u1ee5c c\u1ea7n n\u1ea1p.");

  const cacheKey = "gmcrm-files-" + year + "-" + month + "-" + folderKey + "-" + Utilities.base64EncodeWebSafe(workflow);
  const cached = payload.refresh ? null : readCachedJson_(cacheKey);
  if (cached) return cached;

  // Ghi chú was added after some existing projects were created. Opening it
  // creates just that missing folder, without rechecking every project folder.
  const customerFolder = customerFolderForPayload_(payload, false);
  if (!customerFolder) return { ok: true, files: [] };
  const workflowFolderCacheKey = "gmcrm-workflow-folder-" + year + "-" + month + "-" + folderKey + "-" + Utilities.base64EncodeWebSafe(workflow);
  const workflowFolder = getCachedFolder_(workflowFolderCacheKey) || findFolder_(customerFolder, workflow) || (workflow === "Ghi chú" ? getOrCreateFolder_(customerFolder, workflow) : null);
  if (!workflowFolder) return { ok: true, files: [] };
  cacheFolder_(workflowFolderCacheKey, workflowFolder);

  const files = [];
  try {
    // One Drive API request returns only the lightweight metadata needed by
    // the UI. It avoids one Apps Script call per file/folder.
    listDriveChildrenMetadata_(workflowFolder.getId()).forEach(function(item) {
      const isFolder = item.mimeType === "application/vnd.google-apps.folder";
      if (isFolder && item.name.indexOf("-") === 0) return;
      if (!isFolder && isSpecialWorkflowWorkbook_(item.name)) return;
      if (!isFolder && isSpreadsheetFile_(item.name, item.mimeType)) return;
      const modified = item.modifiedTime ? new Date(item.modifiedTime) : new Date(0);
      files.push({
        id: item.id,
        name: item.name,
        downloadUrl: isFolder ? (item.webViewLink || "https://drive.google.com/drive/folders/" + item.id) : (item.webContentLink || "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(item.id)),
        viewUrl: isFolder ? (item.webViewLink || "https://drive.google.com/drive/folders/" + item.id) : (item.webViewLink || driveFileViewUrl_(item.id)),
        updatedAt: Utilities.formatDate(modified, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"),
        mimeType: item.mimeType,
        isFolder: isFolder,
        updatedAtMillis: modified.getTime(),
      });
    });
  } catch (error) {
    // Older deployments without permission for the REST endpoint retain a
    // compatible DriveApp fallback.
    const folders = workflowFolder.getFolders();
    while (folders.hasNext()) {
      const folder = folders.next();
      if (folder.getName().indexOf("-") === 0) continue;
      const folderUpdated = folder.getLastUpdated();
      files.push({ id: folder.getId(), name: folder.getName(), downloadUrl: folder.getUrl(), viewUrl: folder.getUrl(), updatedAt: Utilities.formatDate(folderUpdated, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"), mimeType: "application/vnd.google-apps.folder", isFolder: true, updatedAtMillis: folderUpdated.getTime() });
    }
    const iterator = workflowFolder.getFiles();
    while (iterator.hasNext()) {
      const file = iterator.next();
      if (file.getName() === WORK_NOTES_FILE_NAME) continue;
      if (isSpecialWorkflowWorkbook_(file.getName())) continue;
      if (isSpreadsheetFile_(file.getName(), file.getMimeType())) continue;
      const fileUpdated = file.getLastUpdated();
      files.push({ id: file.getId(), name: file.getName(), downloadUrl: "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(file.getId()), viewUrl: driveFileViewUrl_(file.getId()), updatedAt: Utilities.formatDate(fileUpdated, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"), mimeType: file.getMimeType(), updatedAtMillis: fileUpdated.getTime() });
    }
  }
  files.sort(function(a, b) { return b.updatedAtMillis - a.updatedAtMillis; });
  const result = { ok: true, files: files.map(function(file) {
    return { id: file.id, name: file.name, downloadUrl: file.downloadUrl, viewUrl: file.viewUrl, updatedAt: file.updatedAt, mimeType: file.mimeType, isFolder: Boolean(file.isFolder) };
  }) };
  cacheJson_(cacheKey, result, 300);
  return result;
}

function listDriveChildrenMetadata_(folderId) {
  const items = [];
  let pageToken = "";
  do {
    const query = "'" + folderId.replace(/'/g, "\\'") + "' in parents and trashed = false";
    let url = "https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(query)
      + "&pageSize=1000&orderBy=modifiedTime%20desc"
      + "&fields=" + encodeURIComponent("nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,webContentLink)")
      + "&supportsAllDrives=true&includeItemsFromAllDrives=true";
    if (pageToken) url += "&pageToken=" + encodeURIComponent(pageToken);
    const response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error("Drive metadata request failed.");
    const data = JSON.parse(response.getContentText() || "{}");
    (data.files || []).forEach(function(item) { items.push(item); });
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return items;
}

function createWorkflowDateFolder_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  const folderKey = customerFolderKey_(payload);
  const workflow = String(payload.workflow || "").trim();
  const allowedWorkflows = ["Ghi chú", "Tư vấn", "Thiết kế", "Dự toán", "Thi công", "Nghiệm thu", "Bảo hành"];
  if (!year || !month || !projectId || allowedWorkflows.indexOf(workflow) === -1) throw new Error("Thiếu thông tin thư mục cần tạo.");
  const customerFolder = customerFolderForPayload_(payload, true);
  const workflowFolder = getOrCreateFolder_(customerFolder, workflow);
  const folderName = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd-MM-yyyy");
  const folder = getOrCreateFolder_(workflowFolder, folderName);
  CacheService.getScriptCache().remove(driveScopedCacheKey_("gmcrm-files-" + year + "-" + month + "-" + folderKey + "-" + Utilities.base64EncodeWebSafe(workflow)));
  return { ok: true, folderId: folder.getId(), folderName: folderName, folderUrl: folder.getUrl() };
}

function uploadWorkflowFile_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  const folderKey = customerFolderKey_(payload);
  const workflow = String(payload.workflow || "").trim();
  const upload = payload.file || {};
  const allowedWorkflows = ["Ghi chú", "Tư vấn", "Thiết kế", "Dự toán", "Thi công", "Nghiệm thu", "Bảo hành"];
  if (!year || month < 1 || month > 12 || !projectId || allowedWorkflows.indexOf(workflow) === -1) {
    throw new Error("Thiếu thông tin thư mục tải tệp.");
  }
  if (typeof upload.data !== "string" || !upload.data) throw new Error("Tệp tải lên không có dữ liệu.");
  const fileName = String(upload.fileName || "").replace(/[\\/]/g, "-").trim();
  if (!fileName) throw new Error("Tên tệp không hợp lệ.");

  const customerFolder = customerFolderForPayload_(payload, true);
  const workflowFolder = getOrCreateFolder_(customerFolder, workflow);
  const bytes = Utilities.base64Decode(upload.data);
  if (bytes.length > 12 * 1024 * 1024) throw new Error("Mỗi tệp tải trực tiếp tối đa 12 MB.");
  trashFilesByName_(workflowFolder, fileName);
  const blob = Utilities.newBlob(bytes, String(upload.mimeType || "application/octet-stream"), fileName);
  const file = workflowFolder.createFile(blob);
  CacheService.getScriptCache().remove(driveScopedCacheKey_("gmcrm-files-" + year + "-" + month + "-" + folderKey + "-" + Utilities.base64EncodeWebSafe(workflow)));
  return { ok: true, fileId: file.getId(), fileName: fileName, fileUrl: file.getUrl(), folderUrl: workflowFolder.getUrl() };
}

const WORK_NOTES_FILE_NAME = "_gmcrm_cong_viec.json";
const COMPLETED_WORK_NOTES_FILE_NAME = "_gmcrm_cong_viec_hoan_thanh.json";
const ACTIVE_WORK_NOTES_FILE_NAME = "_gmcrm_cong_viec_dang_giao.json";
const WORK_NOTES_ADMIN_ACCOUNT = "admin";
const WORK_NOTE_PRIORITIES = ["Gấp", "Cần lập tức", "Bình thường"];
const WORK_NOTE_TYPES = ["Thiết kế", "Tư vấn", "Bảo hành", "Nghiệm thu", "Thi công", "Dự toán"];
const WORK_NOTE_STATUSES = ["Đỏ", "Cam", "Xanh", "Đen"];
// A shared Apps Script property store keeps active notes working when the
// account running the Web App can read Drive but cannot write to the shared
// root folder. Values are split because Script Properties limits one value to
// roughly 9 KB. Drive remains the preferred archival store when writable.
const WORK_NOTES_PROPERTY_PREFIX = "gmcrm-work-notes-state-";
const ACTIVE_WORK_NOTES_PROPERTY_KEY = "gmcrm-active-work-notes-state";
const SCRIPT_PROPERTY_CHUNK_SIZE = 8000;
const VIRTUAL_PANCAKE_TEST_PROJECT_ID = "GMCRM-VIRTUAL-BUI-DUC-THANH";

function isVirtualPancakeTestProject_(details) {
  const projectId = workNoteText_(details && details.projectId, 160);
  const houseId = workNoteText_(details && details.houseId, 160);
  return projectId === VIRTUAL_PANCAKE_TEST_PROJECT_ID || normalizeDriveName_(houseId) === normalizeDriveName_("Bùi Đức Thành");
}

function workNotesCacheKey_(details) {
  return "gmcrm-work-notes-" + details.year + "-" + details.month + "-" + details.projectId;
}

function workNotesPropertyKey_(details) {
  return WORK_NOTES_PROPERTY_PREFIX + details.year + "-" + details.month + "-" + Utilities.base64EncodeWebSafe(details.projectId).replace(/=+$/g, "");
}

function readPropertyJson_(key) {
  const properties = PropertiesService.getScriptProperties();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const head = properties.getProperty(key + ":manifest");
    if (!head) {
      const legacyCount = properties.getProperty(key + ":count");
      const count = Number(legacyCount || 0);
      if (!legacyCount || legacyCount === "0") return null;
      if (!Number.isInteger(count) || count < 1 || count > 1000) throw workflowError_("STORAGE_CORRUPT", "Dữ liệu cache cũ không hợp lệ. Hệ thống giữ nguyên dữ liệu và chưa nhận thay đổi mới.");
      let text = "";
      let missing = false;
      for (let index = 0; index < count; index += 1) { const chunk = properties.getProperty(key + ":" + index); if (typeof chunk !== "string") { missing = true; break; } text += chunk; }
      if (properties.getProperty(key + ":manifest")) continue;
      if (missing) throw workflowError_("STORAGE_CORRUPT", "Dữ liệu cache cũ bị thiếu một phần. Hệ thống chưa ghi đè dữ liệu hiện có.");
      try { return JSON.parse(text); } catch (error) { throw workflowError_("STORAGE_CORRUPT", "Dữ liệu cache cũ không thể đọc. Hệ thống chưa ghi đè dữ liệu hiện có."); }
    }
    let manifest;
    try { manifest = JSON.parse(head); } catch (error) { throw workflowError_("STORAGE_CORRUPT", "Thông tin phiên bản cache không thể đọc. Hệ thống chưa ghi đè dữ liệu hiện có."); }
    if (!manifest || manifest.version !== 2) throw workflowError_("STORAGE_CORRUPT", "Phiên bản cache không được hỗ trợ. Hệ thống chưa ghi đè dữ liệu hiện có.");
    if (manifest.deleted) return null;
    if (typeof manifest.generation !== "string" || !Number.isInteger(manifest.count) || manifest.count < 1 || manifest.count > 1000 || !Number.isInteger(manifest.length) || manifest.length < 1) throw workflowError_("STORAGE_CORRUPT", "Thông tin cache không đầy đủ. Hệ thống chưa ghi đè dữ liệu hiện có.");
    let text = "";
    let missing = false;
    for (let index = 0; index < manifest.count; index += 1) {
      const chunk = properties.getProperty(key + ":g:" + manifest.generation + ":" + index);
      if (typeof chunk !== "string") { missing = true; break; }
      text += chunk;
    }
    // A reader that captured the previous head may race old-generation
    // cleanup. Retry the newly published immutable generation in that case.
    if (missing || text.length !== manifest.length) {
      if (properties.getProperty(key + ":manifest") !== head) continue;
      throw workflowError_("STORAGE_CORRUPT", "Dữ liệu cache bị thiếu một phần. Hệ thống giữ nguyên dữ liệu và chưa nhận thay đổi mới.");
    }
    try { return JSON.parse(text); }
    catch (error) { if (properties.getProperty(key + ":manifest") === head) throw workflowError_("STORAGE_CORRUPT", "Dữ liệu cache không thể đọc. Hệ thống giữ nguyên dữ liệu và chưa nhận thay đổi mới."); }
  }
  throw workflowError_("RETRYABLE", "Cache đang được cập nhật trên thiết bị khác. Hãy thử đồng bộ lại.");
}

function writePropertyJson_(key, value) {
  const properties = PropertiesService.getScriptProperties();
  const text = JSON.stringify(value);
  if (typeof text !== "string") throw new Error("Dữ liệu cache không hợp lệ. Giá trị cũ được giữ nguyên.");
  const chunks = [];
  let chunk = "";
  let byteLength = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    const bytes = character.length === 2 ? 4 : code < 128 ? 1 : code < 2048 ? 2 : 3;
    if (byteLength + bytes > SCRIPT_PROPERTY_CHUNK_SIZE && chunk) { chunks.push(chunk); chunk = ""; byteLength = 0; }
    chunk += character;
    byteLength += bytes;
  }
  if (chunk) chunks.push(chunk);
  const generation = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2) + "-" + Math.random().toString(36).slice(2);
  const previousHead = properties.getProperty(key + ":manifest");
  const legacyCount = Number(properties.getProperty(key + ":count") || 0);
  const nextHead = JSON.stringify({ version: 2, generation: generation, count: chunks.length, length: text.length });
  const written = [];
  try {
    chunks.forEach(function(chunk, index) {
      const chunkKey = key + ":g:" + generation + ":" + index;
      written.push(chunkKey);
      properties.setProperty(chunkKey, chunk);
    });
    properties.setProperty(key + ":manifest", nextHead);
  } catch (error) {
    let observed = false;
    let committed = false;
    try { committed = properties.getProperty(key + ":manifest") === nextHead; observed = true; } catch (readError) { /* A timeout may follow a successful commit. */ }
    if (!committed) {
      if (observed) written.forEach(function(chunkKey) { try { properties.deleteProperty(chunkKey); } catch (cleanupError) { /* Preserve the last committed generation. */ } });
      throw workflowError_("RETRYABLE", "Chưa thể xác nhận lưu cache dùng chung. Hệ thống giữ nguyên dữ liệu đã ghi; hãy thử đồng bộ lại.");
    }
  }
  try {
    const previous = previousHead ? JSON.parse(previousHead) : null;
    if (previous && previous.version === 2 && previous.generation && Number.isInteger(previous.count) && previous.count <= 1000) for (let index = 0; index < previous.count; index += 1) properties.deleteProperty(key + ":g:" + previous.generation + ":" + index);
    if (Number.isInteger(legacyCount) && legacyCount <= 1000) for (let index = 0; index < legacyCount; index += 1) properties.deleteProperty(key + ":" + index);
    properties.deleteProperty(key + ":count");
  } catch (cleanupError) { /* Committed data remains valid if old chunks cannot be removed. */ }
}

function clearPropertyJson_(key) {
  const properties = PropertiesService.getScriptProperties();
  const head = properties.getProperty(key + ":manifest");
  const count = Number(properties.getProperty(key + ":count") || 0);
  properties.setProperty(key + ":manifest", JSON.stringify({ version: 2, deleted: true }));
  try {
    const manifest = head ? JSON.parse(head) : null;
    if (manifest && manifest.generation && Number.isInteger(manifest.count) && manifest.count <= 1000) for (let index = 0; index < manifest.count; index += 1) properties.deleteProperty(key + ":g:" + manifest.generation + ":" + index);
    if (Number.isInteger(count) && count <= 1000) for (let index = 0; index < count; index += 1) properties.deleteProperty(key + ":" + index);
    properties.deleteProperty(key + ":count");
  } catch (cleanupError) { /* The committed tombstone prevents old chunks from reappearing. */ }
}

const WORKSPACE_CACHE_PROPERTY_KEY = "gmcrm-workspace-cache-v1";

function loadWorkspaceCache_() {
  const stored = readPropertyJson_(WORKSPACE_CACHE_PROPERTY_KEY);
  return {
    ok: true,
    updatedAt: stored && Number(stored.updatedAt || 0) || 0,
    years: stored && Array.isArray(stored.years) ? workflowProtectWorkspace_(applyCustomerDriveMutations_(stored.years), true) : [],
  };
}

function saveWorkspaceCache_(payload) {
  const incomingUpdatedAt = Number(payload.updatedAt || Date.now());
  const current = readPropertyJson_(WORKSPACE_CACHE_PROPERTY_KEY);
  if (current && Number(current.updatedAt || 0) > incomingUpdatedAt) {
    return { ok: true, updatedAt: Number(current.updatedAt || 0), years: Array.isArray(current.years) ? current.years : [], ignored: true };
  }
  const incoming = applyCustomerDriveMutations_(Array.isArray(payload.years) ? payload.years : []);
  const previous = applyCustomerDriveMutations_(current && Array.isArray(current.years) ? current.years : []);
  const years = workflowProtectWorkspace_(protectedCustomerCacheYears_(incoming, previous, payload));
  writePropertyJson_(WORKSPACE_CACHE_PROPERTY_KEY, { version: 1, updatedAt: incomingUpdatedAt, years: years });
  return { ok: true, updatedAt: incomingUpdatedAt, savedYears: years.length };
}

function protectedCustomerCacheYears_(incoming, previous, payload) {
  let admin = false;
  if (payload.adminSessionToken) { requireCustomerAdminSession_(payload); admin = true; }
  const manager = admin || Boolean(payload.workflowSessionToken && workflowActor_(payload).manager);
  const managerFields = ["id", "name", "houseId", "createdAt", "details", "audioNote", "functionalFloors", "functionalRows", "designProgress", "interiorDesignProgress", "acceptanceDesignProgress", "customerShareToken"];
  const periods = new Map();
  const years = [];
  const known = new Map();
  const seen = new Set();
  const seenFolders = new Set();
  const periodNumber = function(month, index) {
    const match = /^T(\d{1,2})$/.exec(String(month.label || ""));
    return match ? Number(match[1]) : index + 1;
  };
  const keyFor = function(year, month, record) { return year + ":" + month + ":" + String(record.projectId || "").trim(); };
  const targetPeriod = function(year, month, sourceYear, sourceMonth) {
    const key = year + ":" + month;
    if (periods.has(key)) return periods.get(key);
    let nextYear = years.find(function(item) { return Number(item.year) === year; });
    if (!nextYear) {
      const months = Array.from({ length: 12 }, function(_, index) { return { label: "T" + (index + 1), records: [] }; });
      (Array.isArray(sourceYear.months) ? sourceYear.months : []).forEach(function(source, index) {
        const number = periodNumber(source, index);
        if (number >= 1 && number <= 12) months[number - 1] = { ...source, label: "T" + number, records: [] };
      });
      nextYear = { ...sourceYear, year: year, months: months };
      years.push(nextYear);
    }
    const nextMonth = { ...sourceMonth, label: "T" + month, records: [] };
    nextYear.months[month - 1] = nextMonth;
    periods.set(key, nextMonth);
    return nextMonth;
  };
  previous.forEach(function(year) {
    (Array.isArray(year.months) ? year.months : []).forEach(function(month, index) {
      const monthNumber = periodNumber(month, index);
      (Array.isArray(month.records) ? month.records : []).forEach(function(record) {
        known.set(keyFor(Number(year.year), monthNumber, record), { year: Number(year.year), month: monthNumber, record: record, sourceYear: year, sourceMonth: month });
      });
    });
  });
  // Only additions and omissions need Drive metadata. Ordinary employee edits
  // to known customers remain entirely in the shared property cache.
  const drivePeriods = new Map();
  let driveRoot;
  const driveChildren = function(year, month) {
    const key = year + ":" + month;
    if (drivePeriods.has(key)) return drivePeriods.get(key);
    if (!driveRoot) driveRoot = rootFolder_();
    const unique = function(parent, name) {
      if (!parent) return null;
      const matches = findFolders_(parent, name).filter(function(folder) { return !folder.isTrashed || !folder.isTrashed(); });
      if (matches.length > 1) throw new Error("Có nhiều thư mục trùng tên trên Drive. Chưa thể xác nhận hồ sơ khách hàng.");
      return matches[0] || null;
    };
    const customers = unique(driveRoot, CUSTOMERS_FOLDER_NAME);
    const yearFolder = unique(customers, String(year));
    const monthFolder = unique(yearFolder, "T" + month);
    const folders = [];
    const children = monthFolder && monthFolder.getFolders();
    while (children && children.hasNext()) {
      const child = children.next();
      if (!child.isTrashed || !child.isTrashed()) folders.push({ id: child.getId(), name: normalizeDriveName_(child.getName()) });
    }
    drivePeriods.set(key, folders);
    return folders;
  };
  const existingDriveFolder = function(year, month, record, omitted) {
    const folderId = String(record.driveFolderId || "").trim();
    const names = [record.houseId, record.projectId].map(function(value) { return normalizeDriveName_(value); }).filter(Boolean);
    const matches = driveChildren(year, month).filter(function(folder) {
      if (folderId && folder.id !== folderId) return false;
      return Boolean(omitted && folderId) || names.indexOf(folder.name) >= 0;
    });
    if (matches.length > 1) throw new Error("Có nhiều thư mục khớp mã nhà trên Drive. Chưa thể xác nhận hồ sơ khách hàng.");
    return matches[0] || null;
  };
  incoming.forEach(function(year) {
    const yearNumber = Number(year.year);
    (Array.isArray(year.months) ? year.months : []).forEach(function(month, index) {
      const monthNumber = periodNumber(month, index);
      if (!/^\d{4}$/.test(String(yearNumber)) || monthNumber < 1 || monthNumber > 12) throw new Error("Tháng hoặc năm của hồ sơ không hợp lệ.");
      const target = targetPeriod(yearNumber, monthNumber, year, month);
      (Array.isArray(month.records) ? month.records : []).forEach(function(record) {
        let next = record;
        const recordKey = keyFor(yearNumber, monthNumber, record);
        const prior = known.get(recordKey);
        if (prior && !admin) {
          const previousRecord = prior.record;
          next = { ...record, houseId: record.houseId || previousRecord.houseId, driveFolderId: record.driveFolderId || previousRecord.driveFolderId };
          const identityChanged = normalizeDriveName_(next.houseId) !== normalizeDriveName_(previousRecord.houseId) || String(next.driveFolderId || "") !== String(previousRecord.driveFolderId || "");
          let confirmedFolder;
          if (identityChanged) {
            confirmedFolder = existingDriveFolder(yearNumber, monthNumber, next, false);
            const previousNames = [previousRecord.houseId, previousRecord.projectId].map(normalizeDriveName_).filter(Boolean);
            if (!confirmedFolder || (previousRecord.driveFolderId ? confirmedFolder.id !== previousRecord.driveFolderId : previousNames.indexOf(confirmedFolder.name) < 0)) throw new Error("Không thể thay đổi định danh thư mục hồ sơ qua cache. Hãy dùng Rename để đổi mã nhà.");
            next.driveFolderId = confirmedFolder.id;
          }
          if (previousRecord.pendingDriveSync && !next.pendingDriveSync) {
            try { confirmedFolder = confirmedFolder || existingDriveFolder(yearNumber, monthNumber, next, false); }
            catch (error) { confirmedFolder = null; }
            if (!confirmedFolder) next.pendingDriveSync = true;
          }
        }
        if (!prior && !admin) {
          let folder;
          try { folder = existingDriveFolder(yearNumber, monthNumber, record, false); }
          catch (error) { throw new Error("Chỉ admin mới có quyền tạo khách hàng. Chưa thể xác nhận hồ sơ mới trên Drive: " + String(error.message || error)); }
          if (!folder) throw new Error("Chỉ admin mới có quyền tạo khách hàng. Hồ sơ mới chưa tồn tại trên Drive.");
          const alias = Array.from(known.values()).find(function(item) {
            if (item.year !== yearNumber || item.month !== monthNumber) return false;
            return item.record.driveFolderId ? item.record.driveFolderId === folder.id : [item.record.houseId, item.record.projectId].map(normalizeDriveName_).indexOf(folder.name) >= 0;
          });
          if (alias) throw new Error("Hồ sơ khách hàng đã có trong cache. Không thể tạo bản trùng của cùng thư mục Drive.");
          next = { ...record, driveFolderId: folder.id };
        }
        if (!manager) {
          next = { ...next };
          const fields = prior ? managerFields : ["details", "audioNote", "functionalFloors", "functionalRows", "designProgress", "interiorDesignProgress", "acceptanceDesignProgress", "customerShareToken"];
          fields.forEach(function(field) {
            if (prior && Object.prototype.hasOwnProperty.call(prior.record, field)) next[field] = prior.record[field];
            else if (field === "details") next.details = {};
            else delete next[field];
          });
        }
        if (!validCustomerFolderKey_(String(next.projectId || "").trim())) throw new Error("Mã hồ sơ khách hàng không hợp lệ.");
        if (seen.has(recordKey)) throw new Error("Hồ sơ khách hàng bị trùng trong dữ liệu gửi lên.");
        const folderKey = next.driveFolderId ? yearNumber + ":" + monthNumber + ":" + next.driveFolderId : "";
        if (folderKey && seenFolders.has(folderKey)) throw new Error("Hồ sơ khách hàng bị trùng thư mục Drive trong dữ liệu gửi lên.");
        if (folderKey) seenFolders.add(folderKey);
        seen.add(recordKey);
        target.records.push(next);
      });
    });
  });
  known.forEach(function(item, key) {
    if (seen.has(key)) return;
    let retain = Boolean(item.record.pendingDriveSync);
    if (!retain) {
      try { retain = Boolean(existingDriveFolder(item.year, item.month, item.record, true)); }
      catch (error) { retain = true; } // A failed Drive read is never evidence of deletion.
    }
    if (retain) targetPeriod(item.year, item.month, item.sourceYear, item.sourceMonth).records.push(item.record);
  });
  return years;
}

function workNotesFolder_(year, month, projectId, createMissing, houseId) {
  const customerFolder = customerFolderForPayload_({ year: year, month: month, projectId: projectId, houseId: houseId }, createMissing);
  if (!customerFolder) return null;
  return createMissing ? getOrCreateFolder_(customerFolder, "Ghi chú") : findFolder_(customerFolder, "Ghi chú");
}

function workNotesPayload_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  const houseId = String(payload.houseId || "").trim();
  if (!year || month < 1 || month > 12 || !projectId) throw new Error("Thiếu thông tin hồ sơ ghi chú.");
  return { year: year, month: month, projectId: projectId, houseId: houseId };
}

function workNoteText_(value, maximum) {
  return String(value === null || value === undefined ? "" : value).trim().slice(0, maximum);
}

function normalizeWorkNoteDate_(value) {
  const text = workNoteText_(value, 10);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return iso[3] + "/" + iso[2] + "/" + iso[1];
  return /^\d{2}\/\d{2}\/\d{4}$/.test(text) ? text : "";
}

function normalizeWorkNotes_(notes) {
  return (Array.isArray(notes) ? notes : []).map(function(note, index) {
    const priority = workNoteText_(note && note.priority, 30);
    const workType = workNoteText_(note && note.workType, 50);
    const status = workNoteText_(note && note.status, 20);
    const dueDate = normalizeWorkNoteDate_(note && note.dueDate);
    const actualDate = normalizeWorkNoteDate_(note && note.actualDate);
    const completedAt = workNoteText_(note && note.completedAt, 40);
    const acceptedAt = workNoteText_(note && note.acceptedAt, 40);
    const normalized = {
      id: workNoteText_(note && note.id, 100) || "work-note-" + index + "-" + new Date().getTime(),
      priority: WORK_NOTE_PRIORITIES.indexOf(priority) >= 0 ? priority : "Bình thường",
      workType: WORK_NOTE_TYPES.indexOf(workType) >= 0 ? workType : "Tư vấn",
      assignee: workNoteText_(note && note.assignee, 160),
      assigneeEmail: workNoteText_(note && note.assigneeEmail, 240).toLowerCase(),
      creatorEmail: workNoteText_(note && note.creatorEmail, 240).toLowerCase(),
      creatorName: workNoteText_(note && note.creatorName, 160),
      acceptedBy: workNoteText_(note && note.acceptedBy, 240).toLowerCase(),
      content: workNoteText_(note && note.content, 4000),
      dueDate: dueDate,
      actualDate: actualDate,
      completedAt: completedAt,
      acceptedAt: acceptedAt,
      // A newly created note stays black until the future assignee-acceptance
      // flow explicitly records acceptedAt.
      status: workNoteStatus_(acceptedAt, dueDate),
    };
    const messageContext = workNoteText_(note && note.messageContext, 8000);
    const sourceMessageId = workNoteText_(note && note.sourceMessageId, 180);
    if (messageContext) normalized.messageContext = messageContext;
    if (sourceMessageId) normalized.sourceMessageId = sourceMessageId;
    return normalized;
  });
}

function workNoteStatus_(acceptedAt, dueDate) {
  if (!acceptedAt) return "Đen";
  const due = workflowDayNumber_(dueDate);
  if (due === null) return "Đen";
  const days = due - workflowDayNumber_(workflowToday_());
  if (days < 0) return "Tím";
  if (days <= 3) return "Đỏ";
  if (days <= 7) return "Cam";
  return "Xanh";
}

function activeWorkNotesFile_() {
  const root = rootFolder_();
  const file = findFileByName_(root, ACTIVE_WORK_NOTES_FILE_NAME);
  return file || root.createFile(ACTIVE_WORK_NOTES_FILE_NAME, "[]", MimeType.PLAIN_TEXT);
}

function readActiveWorkNotes_() {
  const shared = readPropertyJson_(ACTIVE_WORK_NOTES_PROPERTY_KEY);
  if (Array.isArray(shared)) return shared;
  try { const file = findFileByName_(rootFolder_(), ACTIVE_WORK_NOTES_FILE_NAME); if (!file) return []; const value = JSON.parse(file.getBlob().getDataAsString() || "[]"); return Array.isArray(value) ? value : []; } catch (error) { return []; }
}

function saveActiveWorkNotes_(records) {
  const normalized = records;
  writePropertyJson_(ACTIVE_WORK_NOTES_PROPERTY_KEY, normalized);
}

function syncActiveWorkNotes_(details, notes, payload) {
  const previous = readActiveWorkNotes_().filter(function(item) { return !(Number(item.year) === details.year && Number(item.month) === details.month && String(item.projectId) === details.projectId); });
  const active = notes.filter(function(note) { return !note.actualDate && note.assigneeEmail; }).map(function(note) { return { ...note, year: details.year, month: details.month, projectId: details.projectId, customerName: workNoteText_(payload.customerName, 240), houseId: workNoteText_(payload.houseId, 120), updatedAt: new Date().toISOString() }; });
  saveActiveWorkNotes_(previous.concat(active));
}

function loadAssignedWorkNotes_(payload) {
  const actor = payload.workflowSessionToken || payload.adminSessionToken ? workflowActor_(payload) : null;
  if (actor) workflowMayUse_(actor, "Ghi chú");
  const email = actor ? actor.account : workNoteText_(payload.email, 240).toLowerCase();
  if (!email) throw new Error("Thiếu email nhân viên.");
  const queue = workflowReadQueue_("notes", payload.project, actor);
  const metadata = { ok: true, projectRevisions: actor ? queue.projectRevisions : [], ...(actor && queue.projectSnapshot ? { projectSnapshot: queue.projectSnapshot } : {}) };
  const activeNotes = queue.items.filter(function(note) { return !note.actualDate && (actor || note.collectionRevision === undefined); });
  // The built-in manager account needs an overview across every customer,
  // while each employee continues to receive only work assigned to them.
  if (actor && actor.manager || email === WORK_NOTES_ADMIN_ACCOUNT) return { ...metadata, notes: activeNotes };
  const member = actor ? actor.member : employeeRosterMember_(email);
  if (personnelIsManager_(member)) return { ...metadata, notes: activeNotes };
  return { ...metadata, notes: activeNotes.filter(function(note) { return assignmentMatchesEmployee_(note.assigneeEmail, email, member); }) };
}

function loadWorkNotes_(payload) {
  const details = workNotesPayload_(payload);
  if (isCustomerDriveRecordDeleted_(details)) return { ok: true, notes: [], deleted: true };
  const canonical = workflowReadProject_(details, true);
  if (canonical) {
    if (canonical.customerDeleted) return { ok: true, notes: [], deleted: true, revision: canonical.revision, deletedIds: canonical.deletedIds || [] };
    const actor = workflowActor_(payload);
    workflowMayUse_(actor, "Ghi chú");
    return workflowSnapshot_(canonical, { source: "workflow-v2", archivePending: canonical.notes.some(function(note) { return note.archivePending; }) }, actor);
  }
  const cacheKey = workNotesCacheKey_(details);
  const shared = readPropertyJson_(workNotesPropertyKey_(details));
  if (Array.isArray(shared)) return { ok: true, notes: normalizeWorkNotes_(shared), source: "script-properties" };
  const cached = readCachedJson_(cacheKey);
  if (cached) return { ok: true, notes: normalizeWorkNotes_(cached), source: "cache" };
  const folder = workNotesFolder_(details.year, details.month, details.projectId, false, details.houseId);
  if (!folder) return { ok: true, notes: [] };
  const file = findFileByName_(folder, WORK_NOTES_FILE_NAME);
  if (!file) return { ok: true, notes: [] };
  try {
    const notes = normalizeWorkNotes_(JSON.parse(file.getBlob().getDataAsString() || "[]"));
    const keptNotes = notes.filter(function(note) {
      if (!note.actualDate || !note.completedAt) return true;
      const completedAt = new Date(note.completedAt).getTime();
      return !isFinite(completedAt) || Date.now() - completedAt < 2 * 24 * 60 * 60 * 1000;
    });
    if (keptNotes.length !== notes.length) file.setContent(JSON.stringify(keptNotes));
    cacheJson_(cacheKey, keptNotes, 21600);
    return { ok: true, notes: keptNotes, source: "drive" };
  } catch (error) {
    throw new Error("Không thể đọc dữ liệu ghi chú công việc.");
  }
}

function syncWorkNotes_(payload) {
  const details = workNotesPayload_(payload);
  if (workflowReadProject_(details)) throw workflowError_("UPDATE_REQUIRED", "Ghi chú đã chuyển sang cơ chế giao việc mới. Hãy cập nhật ứng dụng trước khi sửa.");
  if (isCustomerDriveRecordDeleted_(details)) throw new Error("Hồ sơ đã được xóa trên Drive. Không thể đồng bộ ghi chú vào hồ sơ đã xóa.");
  const notes = normalizeWorkNotes_(payload.notes);
  const propertyKey = workNotesPropertyKey_(details);
  writePropertyJson_(propertyKey, notes);
  cacheJson_(workNotesCacheKey_(details), notes, 21600);
  let driveSaved = false;
  const virtualTest = isVirtualPancakeTestProject_(details);
  if (!virtualTest) {
    try {
      const folder = workNotesFolder_(details.year, details.month, details.projectId, true, details.houseId);
      const content = JSON.stringify(notes);
      const file = findFileByName_(folder, WORK_NOTES_FILE_NAME);
      if (file) file.setContent(content);
      else folder.createFile(WORK_NOTES_FILE_NAME, content, MimeType.PLAIN_TEXT);
      driveSaved = true;
    } catch (error) {
      // Publishing must not fail just because the connected Drive folder is
      // read-only. The shared property store still reaches every employee.
    }
  }
  syncActiveWorkNotes_(details, notes, payload);
  return { ok: true, savedCount: notes.length, storage: driveSaved ? "drive" : "script-properties", driveWarning: virtualTest ? "Bùi Đức Thành đang ở chế độ khách ảo; giao việc chỉ lưu kho dùng chung, không tạo Drive." : driveSaved ? "" : "Drive hiện chỉ có quyền xem; ghi chú đã lưu vào kho dùng chung Apps Script." };
}

function completedWorkNotesFolder_(details) {
  const root = rootFolder_();
  const customers = getOrCreateFolder_(root, CUSTOMERS_FOLDER_NAME);
  const yearFolder = getOrCreateFolder_(customers, String(details.year));
  return getOrCreateFolder_(yearFolder, "T" + details.month);
}

function completeWorkNote_(payload) {
  const details = workNotesPayload_(payload);
  if (workflowReadProject_(details)) throw workflowError_("UPDATE_REQUIRED", "Ghi chú đã chuyển sang cơ chế giao việc mới. Hãy cập nhật ứng dụng trước khi hoàn thành.");
  const note = normalizeWorkNotes_([payload.note || {}])[0];
  if (!note || !note.actualDate) throw new Error("Cần xác nhận ngày hoàn thành trước khi lưu công việc vào Drive.");
  const actorEmail = workNoteText_(payload.actorEmail, 240).toLowerCase();
  const actorMember = /^member:/i.test(workNoteText_(note.assigneeEmail, 240)) ? employeeRosterMember_(actorEmail) : null;
  if (!note.assigneeEmail || !assignmentMatchesEmployee_(note.assigneeEmail, actorEmail, actorMember)) throw new Error("Chỉ người được giao việc mới có thể xác nhận hoàn thành.");

  // The Pancake test conversation is intentionally not backed by a customer
  // folder. Keep completion in the shared property/cache store so the test
  // exercises the same UI while never creating an Excel file or Drive folder.
  if (isVirtualPancakeTestProject_(details)) {
    const completedNote = { ...note, completedAt: workNoteText_(payload.note && payload.note.completedAt, 40) || new Date().toISOString() };
    let projectNotes = readPropertyJson_(workNotesPropertyKey_(details));
    projectNotes = Array.isArray(projectNotes) ? normalizeWorkNotes_(projectNotes) : [];
    const noteIndex = projectNotes.findIndex(function(item) { return item.id === completedNote.id; });
    if (noteIndex >= 0) projectNotes[noteIndex] = completedNote;
    else projectNotes.push(completedNote);
    writePropertyJson_(workNotesPropertyKey_(details), projectNotes);
    cacheJson_(workNotesCacheKey_(details), projectNotes, 21600);
    saveActiveWorkNotes_(readActiveWorkNotes_().filter(function(record) { return String(record && record.id || "") !== note.id; }));
    return { ok: true, savedCount: 0, storage: "script-properties", virtual: true, driveWarning: "Bùi Đức Thành là khách ảo; không tạo tệp Drive." };
  }

  const folder = completedWorkNotesFolder_(details);
  const file = findFileByName_(folder, COMPLETED_WORK_NOTES_FILE_NAME);
  let records = [];
  if (file) {
    try {
      const saved = JSON.parse(file.getBlob().getDataAsString() || "[]");
      records = Array.isArray(saved) ? saved.slice(-1999) : [];
    } catch (error) {
      throw new Error("Không thể đọc kho ghi chú hoàn thành của tháng này.");
    }
  }
  records = records.filter(function(record) { return String(record && record.id || "") !== note.id; });
  records.push({
    ...note,
    projectId: details.projectId,
    houseId: details.houseId,
    savedAt: Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"),
  });
  const content = JSON.stringify(records);
  if (file) file.setContent(content);
  else folder.createFile(COMPLETED_WORK_NOTES_FILE_NAME, content, MimeType.PLAIN_TEXT);
  const workFolder = workNotesFolder_(details.year, details.month, details.projectId, true, details.houseId);
  const activeFile = findFileByName_(workFolder, WORK_NOTES_FILE_NAME);
  let projectNotes = [];
  if (activeFile) {
    try { projectNotes = normalizeWorkNotes_(JSON.parse(activeFile.getBlob().getDataAsString() || "[]")); } catch (error) { projectNotes = []; }
  }
  const completedNote = { ...note, completedAt: workNoteText_(payload.note && payload.note.completedAt, 40) || new Date().toISOString() };
  const noteIndex = projectNotes.findIndex(function(item) { return item.id === completedNote.id; });
  if (noteIndex >= 0) projectNotes[noteIndex] = completedNote;
  else projectNotes.push(completedNote);
  if (activeFile) activeFile.setContent(JSON.stringify(projectNotes));
  else workFolder.createFile(WORK_NOTES_FILE_NAME, JSON.stringify(projectNotes), MimeType.PLAIN_TEXT);
  saveActiveWorkNotes_(readActiveWorkNotes_().filter(function(record) { return String(record && record.id || "") !== note.id; }));
  cacheJson_(workNotesCacheKey_(details), projectNotes, 21600);
  return { ok: true, savedCount: records.length, folderUrl: folder.getUrl() };
}

// Pancake integration -------------------------------------------------------
// Tokens are kept in Apps Script properties so they never ship to GitHub
// Pages or appear in browser localStorage. Configure them once from the admin
// Drive dialog (or Project settings > Script properties).
const PANCAKE_USER_TOKEN_PROPERTY = "PANCAKE_USER_ACCESS_TOKEN";
const PANCAKE_PAGE_TOKEN_PROPERTY = "PANCAKE_PAGE_ACCESS_TOKEN";
const PANCAKE_PAGE_ID_PROPERTY = "PANCAKE_PAGE_ID";
const PANCAKE_PAGE_NAME_PROPERTY = "PANCAKE_PAGE_NAME";
const PANCAKE_MESSAGE_STATE_FILE_NAME = "_gmcrm_tin_nhan_khach_trang_thai.json";
const PANCAKE_MESSAGE_EXPORT_FILE_NAME = "Tin nhắn khách.xlsx";
const PANCAKE_MESSAGE_STATUSES = ["new", "processing", "resolved"];

function normalizePancakeMessageStatus_(value) {
  const status = String(value || "").trim().toLocaleLowerCase();
  if (status === "processing" || status === "đang xử lý") return "processing";
  if (status === "resolved" || status === "đã xử lý" || status === "đã hoàn thành") return "resolved";
  // "deferred" was the old label for the first state. Keep old state files
  // readable, but expose the new three-choice UI as "Chưa xem".
  if (status === "deferred" || status === "new" || status === "chưa xem" || !status) return "new";
  return "new";
}

function pancakeProperty_(key) {
  return String(PropertiesService.getScriptProperties().getProperty(key) || "").trim();
}

function pancakeJsonRequest_(url) {
  const response = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true, headers: { Accept: "application/json" } });
  const status = response.getResponseCode();
  const text = response.getContentText() || "";
  let result;
  try { result = JSON.parse(text); } catch (error) { throw new Error("Pancake không trả về JSON hợp lệ (HTTP " + status + ")."); }
  if (status < 200 || status >= 300 || result.success === false) {
    const code = result.error_code ? " (" + result.error_code + ")" : "";
    throw new Error("Pancake từ chối yêu cầu" + code + ": " + String(result.message || "HTTP " + status).slice(0, 240));
  }
  return result;
}

function pancakePages_(userToken) {
  const result = pancakeJsonRequest_("https://pages.fm/api/v1/pages?access_token=" + encodeURIComponent(userToken));
  const categories = result.categorized || {};
  return [].concat(categories.activated || [], categories.hidden || [], categories.inactivated || [], categories.nopermission || []);
}

function pancakePageContext_() {
  const userToken = pancakeProperty_(PANCAKE_USER_TOKEN_PROPERTY);
  const pageToken = pancakeProperty_(PANCAKE_PAGE_TOKEN_PROPERTY);
  if (!userToken || !pageToken) throw new Error("Chưa cấu hình Pancake User Access Token và Page Access Token trong Apps Script.");
  const properties = PropertiesService.getScriptProperties();
  let pageId = pancakeProperty_(PANCAKE_PAGE_ID_PROPERTY);
  let pageName = pancakeProperty_(PANCAKE_PAGE_NAME_PROPERTY) || "Gm Manager";
  let page = null;
  if (!pageId) {
    const pages = pancakePages_(userToken);
    page = pages.find(function(item) { return String(item.name || "").trim().toLocaleLowerCase() === pageName.toLocaleLowerCase(); }) || pages.find(function(item) { return item.is_activated; });
    if (!page || !page.id) throw new Error("Không tìm thấy page Pancake " + pageName + ".");
    pageId = String(page.id);
    pageName = String(page.name || pageName);
    properties.setProperty(PANCAKE_PAGE_ID_PROPERTY, pageId);
    properties.setProperty(PANCAKE_PAGE_NAME_PROPERTY, pageName);
  }
  return { userToken: userToken, pageToken: pageToken, pageId: pageId, pageName: pageName };
}

function savePancakeConfig_(payload) {
  const userToken = workNoteText_(payload.userAccessToken, 4000);
  const pageToken = workNoteText_(payload.pageAccessToken, 4000);
  const pageName = workNoteText_(payload.pageName, 200) || "Gm Manager";
  if (!userToken || !pageToken) throw new Error("Cần nhập cả User Access Token và Page Access Token của Pancake.");
  const pages = pancakePages_(userToken);
  const page = pages.find(function(item) { return String(item.name || "").trim().toLocaleLowerCase() === pageName.toLocaleLowerCase(); }) || pages.find(function(item) { return item.is_activated; });
  if (!page || !page.id) throw new Error("User Access Token không thấy page " + pageName + ".");
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty(PANCAKE_USER_TOKEN_PROPERTY, userToken);
  properties.setProperty(PANCAKE_PAGE_TOKEN_PROPERTY, pageToken);
  properties.setProperty(PANCAKE_PAGE_ID_PROPERTY, String(page.id));
  properties.setProperty(PANCAKE_PAGE_NAME_PROPERTY, String(page.name || pageName));
  // Validate the page token with the read-only conversation endpoint before
  // telling the UI that the configuration is ready.
  pancakeJsonRequest_("https://pages.fm/api/public_api/v2/pages/" + encodeURIComponent(String(page.id)) + "/conversations?page_access_token=" + encodeURIComponent(pageToken));
  return { ok: true, pageId: String(page.id), pageName: String(page.name || pageName) };
}

function pancakeMessageStateFile_() {
  const root = rootFolder_();
  const file = findFileByName_(root, PANCAKE_MESSAGE_STATE_FILE_NAME);
  return file || root.createFile(PANCAKE_MESSAGE_STATE_FILE_NAME, "[]", MimeType.PLAIN_TEXT);
}

function readPancakeMessageStates_() {
  const shared = readPropertyJson_(WORKFLOW_MESSAGE_STATES);
  if (Array.isArray(shared)) return shared;
  try {
    const file = findFileByName_(rootFolder_(), PANCAKE_MESSAGE_STATE_FILE_NAME);
    if (!file) return [];
    const value = JSON.parse(file.getBlob().getDataAsString() || "[]");
    return Array.isArray(value) ? value : [];
  } catch (error) { return []; }
}

function savePancakeMessageStates_(states) {
  writePropertyJson_(WORKFLOW_MESSAGE_STATES, states);
}

function pancakeHouseIdFromGroupName_(groupName) {
  const match = /^(.+?)\s*-\s*GM(?:\s*-|\s*$)/i.exec(workNoteText_(groupName, 400));
  return match ? match[1].trim() : "";
}

function pancakeIsSpecialTestConversation_(groupName, conversation) {
  const expected = "bùi đức thành";
  const names = [
    groupName,
    conversation && conversation.from && conversation.from.name,
    conversation && conversation.page_customer && conversation.page_customer.name,
  ];
  return names.some(function(name) {
    return workNoteText_(name, 400).trim().toLocaleLowerCase().indexOf(expected) >= 0;
  });
}

function pancakeSpecialTestTarget_(targets) {
  const today = new Date();
  return { houseId: "Bùi Đức Thành", projectId: "", customerName: "Bùi Đức Thành", year: today.getFullYear(), month: today.getMonth() + 1 };
}

function normalizePancakeHouseId_(value) {
  return workNoteText_(value, 160).toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizePancakeGroupName_(value) {
  const text = workNoteText_(value, 400);
  const decomposed = text.normalize ? text.normalize("NFD") : text;
  return decomposed.replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function pancakeDateIso_(value) {
  if (value === null || value === undefined || value === "") return "";
  let date;
  if (typeof value === "number" || /^\d+(?:\.\d+)?$/.test(String(value))) {
    const numeric = Number(value);
    date = new Date(numeric < 100000000000 ? numeric * 1000 : numeric);
  } else date = new Date(String(value));
  return isFinite(date.getTime()) ? date.toISOString() : "";
}

function pancakePlainText_(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|p|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, function(_match, code) { return String.fromCodePoint(Number(code)); })
    .replace(/&#x([\da-f]+);/gi, function(_match, code) { return String.fromCodePoint(parseInt(code, 16)); })
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function pancakeNestedText_(value) {
  if (typeof value === "string" || typeof value === "number") return pancakePlainText_(value);
  if (!value || typeof value !== "object") return "";
  const nested = value.text || value.message || value.content || value.body;
  return pancakePlainText_(nested && typeof nested === "object" ? pancakeNestedText_(nested) : String(nested || value.name || ""));
}

function pancakeMessageText_(message) {
  return workNoteText_(pancakeNestedText_(message && (message.message || message.text || message.content || message.body || message.message_content)), 4000);
}

function pancakeMessageSender_(message, fallback) {
  const sender = message && (message.sender || message.from || message.user || message.customer || message.conv_customer);
  return workNoteText_(pancakeNestedText_(sender) || message && (message.sender_name || message.from_name || message.customer_name), 160) || fallback || "Khách hàng";
}

function pancakeIsPageMessage_(message, pageId) {
  if (!message) return false;
  if (message.is_from_page === true || message.from_page === true || message.is_page === true || message.is_admin === true) return true;
  const from = message.from || message.sender || {};
  const fromId = from && (from.id || from.global_id || from.page_id);
  if (pageId && fromId && String(fromId) === String(pageId)) return true;
  const source = String(message.sender_type || message.from_type || message.actor_type || "").toLocaleLowerCase();
  return /page|admin|staff|agent|business|shop/.test(source);
}

function pancakeRawMessages_(result) {
  const candidates = [result && result.messages, result && result.data, result && result.activities];
  for (let index = 0; index < candidates.length; index += 1) {
    const value = candidates[index];
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.messages)) return value.messages;
  }
  return [];
}

function pancakeConversationMessages_(context, conversation) {
  const base = "https://pages.fm/api/public_api/v1/pages/" + encodeURIComponent(context.pageId) + "/conversations/" + encodeURIComponent(String(conversation.id)) + "/messages?page_access_token=" + encodeURIComponent(context.pageToken);
  // This endpoint is v1 and requires current_count. Without it Pancake may
  // return its HTML shell with HTTP 200 instead of the JSON payload.
  const result = pancakeJsonRequest_(base + "&current_count=0");
  return pancakeRawMessages_(result);
}

function pancakeConversationPages_(context) {
  const conversations = [];
  let cursor = "";
  for (let page = 0; page < 20; page += 1) {
    const url = "https://pages.fm/api/public_api/v2/pages/" + encodeURIComponent(context.pageId) + "/conversations?page_access_token=" + encodeURIComponent(context.pageToken) + (cursor ? "&last_conversation_id=" + encodeURIComponent(cursor) : "");
    const result = pancakeJsonRequest_(url);
    const batch = Array.isArray(result.conversations) ? result.conversations : [];
    conversations.push.apply(conversations, batch);
    if (batch.length < 60) break;
    const next = String(batch[batch.length - 1].id || "");
    if (!next || next === cursor) break;
    cursor = next;
  }
  return conversations;
}

function pancakeTargetMap_(payload) {
  const map = {};
  (Array.isArray(payload.customerTargets) ? payload.customerTargets : []).slice(0, 2000).forEach(function(target) {
    const houseId = workNoteText_(target && target.houseId, 160);
    const key = normalizePancakeHouseId_(houseId);
    if (!key) return;
    map[key] = { houseId: houseId, projectId: workNoteText_(target.projectId, 160), customerName: workNoteText_(target.customerName, 240), zaloGroupName: workNoteText_(target.zaloGroupName, 400), year: Number(target.year) || 0, month: Number(target.month) || 0 };
  });
  return map;
}

function pancakeTargetForGroupName_(targets, groupName) {
  const expected = normalizePancakeGroupName_(groupName);
  if (!expected) return null;
  const keys = Object.keys(targets || {});
  for (let index = 0; index < keys.length; index += 1) {
    const target = targets[keys[index]];
    if (target && target.zaloGroupName && normalizePancakeGroupName_(target.zaloGroupName) === expected) return target;
  }
  return null;
}

function groupPancakeMessages_(conversation, rawMessages, target, priorGroups) {
  const fallbackName = workNoteText_(conversation && conversation.page_customer && conversation.page_customer.name, 240) || workNoteText_(conversation && conversation.from && conversation.from.name, 240) || "Khách hàng";
  const normalized = rawMessages.map(function(message, index) {
    const content = pancakeMessageText_(message);
    const sentAt = pancakeDateIso_(message && (message.inserted_at || message.created_at || message.sent_at || message.timestamp || message.time));
    return { id: workNoteText_(message && (message.id || message.message_id), 180) || "message-" + index, senderName: pancakeMessageSender_(message, fallbackName), content: content, sentAt: sentAt };
  }).filter(function(message) { return message.content && message.sentAt; }).sort(function(left, right) { return new Date(left.sentAt).getTime() - new Date(right.sentAt).getTime(); });
  const prior = (Array.isArray(priorGroups) ? priorGroups : []).filter(function(group) { return String(group.conversationId) === String(conversation.id); });
  const groups = [];
  normalized.forEach(function(message) {
    const messageTime = new Date(message.sentAt).getTime();
    let last = groups.find(function(group) { const first = new Date(group.firstMessageAt).getTime(); return messageTime >= first && messageTime - first < 2 * 60 * 60 * 1000; });
    if (!last) {
      const anchor = prior.find(function(group) { const first = new Date(group.firstMessageAt).getTime(); return messageTime >= first && messageTime - first < 2 * 60 * 60 * 1000; });
      if (anchor) { last = { ...anchor, ...target, messages: (anchor.messages || []).slice(), messageCount: (anchor.messages || []).length }; groups.push(last); }
    }
    if (!last) {
      groups.push({ id: "pancake-" + String(conversation.id) + "-" + message.sentAt, conversationId: String(conversation.id), groupName: workNoteText_(conversation && conversation.from && conversation.from.name, 400), houseId: target.houseId, projectId: target.projectId, customerName: target.customerName || fallbackName, year: target.year, month: target.month, messages: [message], firstMessageAt: message.sentAt, lastMessageAt: message.sentAt, messageCount: 1 });
    } else {
      const existing = last.messages.findIndex(function(line) { return line.id === message.id; });
      if (existing >= 0) last.messages[existing] = message; else last.messages.push(message);
      last.messages.sort(function(left, right) { return new Date(left.sentAt).getTime() - new Date(right.sentAt).getTime(); });
      last.lastMessageAt = last.messages[last.messages.length - 1].sentAt;
      last.messageCount = last.messages.length;
    }
  });
  return groups.sort(function(left, right) { return new Date(left.firstMessageAt).getTime() - new Date(right.firstMessageAt).getTime(); });
}

function loadCustomerMessages_(payload) {
  const properties = PropertiesService.getScriptProperties();
  if (!pancakeProperty_(PANCAKE_USER_TOKEN_PROPERTY) || !pancakeProperty_(PANCAKE_PAGE_TOKEN_PROPERTY)) return { ok: true, configured: false, messages: [] };
  const targets = pancakeTargetMap_(payload);
  const context = pancakePageContext_();
  const targetFingerprint = Object.keys(targets).sort().map(function(key) { return key + ":" + normalizePancakeGroupName_(targets[key].zaloGroupName || ""); });
  const cacheKey = "gmcrm-pancake-messages-" + workflowHash_(JSON.stringify(targetFingerprint));
  const cached = payload.refresh ? null : readCachedJson_(cacheKey);
  if (cached) {
    const states = workflowIngestMessages_(cached.messages || []);
    return { ...cached, messages: workflowMessagesView_(cached.messages || [], states) };
  }
  const conversations = pancakeConversationPages_(context);
  const priorStates = readPancakeMessageStates_();
  const eligibleConversations = new Set();
  const groups = [];
  conversations.forEach(function(conversation) {
    const groupName = workNoteText_(conversation && conversation.from && conversation.from.name, 400);
    const houseKey = normalizePancakeHouseId_(pancakeHouseIdFromGroupName_(groupName));
    const isSpecialTestConversation = pancakeIsSpecialTestConversation_(groupName, conversation);
    const overrideTarget = pancakeTargetForGroupName_(targets, groupName);
    // A Pancake group is useful to GM-CRM only when its name contains the
    // GM marker and the extracted house code matches a loaded customer.
    // Never surface an unassigned group in the all-customer overview.
    // The exact Bùi Đức Thành conversation is a temporary test exception. It
    // is allowed without a GM marker and is kept unassigned when no matching
    // customer record exists; every other conversation keeps the strict rule.
    if (!isSpecialTestConversation && !overrideTarget && (!/\bGM\b/i.test(groupName) || !targets[houseKey])) return;
    const target = isSpecialTestConversation ? (targets[houseKey] || pancakeSpecialTestTarget_(targets)) : (overrideTarget || targets[houseKey]);
    eligibleConversations.add(String(conversation.id));
    let messages;
    try { messages = pancakeConversationMessages_(context, conversation); } catch (error) { return; }
    groupPancakeMessages_(conversation, messages.filter(function(message) { return isSpecialTestConversation || !pancakeIsPageMessage_(message, context.pageId); }), target, priorStates).forEach(function(group) { groups.push(group); });
  });
  const states = workflowIngestMessages_(groups);
  const loadedIds = new Set(groups.map(function(group) { return group.id; }));
  const retained = states.filter(function(state) { return !loadedIds.has(state.id) && eligibleConversations.has(String(state.conversationId)) && (state.status !== "resolved" || state.archivePending); });
  const active = workflowMessagesView_(groups.concat(retained), states);
  const result = { ok: true, configured: true, pageName: context.pageName, messages: active };
  cacheJson_(cacheKey, result, 30);
  return result;
}

function normalizePancakeMessageGroup_(group) {
  group = group || {};
  return {
    id: workNoteText_(group.id, 220),
    conversationId: workNoteText_(group.conversationId, 220),
    groupName: workNoteText_(group.groupName, 400),
    houseId: workNoteText_(group.houseId, 160),
    projectId: workNoteText_(group.projectId, 160),
    customerName: workNoteText_(group.customerName, 240),
    year: Number(group.year) || 0,
    month: Number(group.month) || 0,
    messages: (Array.isArray(group.messages) ? group.messages : []).map(function(message) { return { id: workNoteText_(message && message.id, 180), senderName: workNoteText_(message && message.senderName, 160) || "Khách hàng", content: pancakePlainText_(workNoteText_(message && message.content, 4000)), sentAt: pancakeDateIso_(message && message.sentAt) }; }).filter(function(message) { return message.content && message.sentAt; }),
    firstMessageAt: pancakeDateIso_(group.firstMessageAt),
    lastMessageAt: pancakeDateIso_(group.lastMessageAt),
    messageCount: (Array.isArray(group.messages) ? group.messages : []).length,
  };
}

function pancakeMessageExportRows_(group) {
  const messages = Array.isArray(group && group.messages) ? group.messages : [];
  return messages.map(function(message) {
    const sentAt = pancakeDateIso_(message && message.sentAt);
    if (!sentAt) return null;
    const date = Utilities.formatDate(new Date(sentAt), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss");
    const sender = workNoteText_(message && message.senderName, 160);
    const content = pancakePlainText_(workNoteText_(message && message.content, 4000));
    return [date, (sender ? sender + ": " : "") + content];
  }).filter(function(row) { return row && row[1]; });
}

function appendPancakeMessageWorkbook_(group) {
  if (!group || (!group.workflowVerified && !/\bGM\b/i.test(workNoteText_(group.groupName, 400))) || !workNoteText_(group.houseId, 160)) {
    throw new Error("Tin nhắn chưa gắn được với nhóm GM và mã nhà hợp lệ.");
  }
  const year = Number(group.year);
  const month = Number(group.month);
  if (!/^\d{4}$/.test(String(year)) || month < 1 || month > 12) throw new Error("Thiếu năm/tháng của hồ sơ khách hàng.");
  const customerFolder = customerFolderForRecord_(group, year, month, true);
  const documentsFolder = documentsFolderForCustomerFolder_(customerFolder, true);
  if (!documentsFolder) throw new Error("Không tìm thấy thư mục Tài liệu của khách hàng.");
  const existingFiles = [];
  const existingIterator = documentsFolder.getFilesByName(PANCAKE_MESSAGE_EXPORT_FILE_NAME);
  while (existingIterator.hasNext()) existingFiles.push(existingIterator.next());
  let rows = [["Ngày", "Nội dung tin nhắn"]];
  const archivedLineKeys = new Set();
  const maximumCounts = new Map();
  existingFiles.forEach(function(existingFile) {
    try {
      const sheets = readXlsxSheets_(existingFile);
      const source = sheets["Tin nhắn khách"] || sheets[Object.keys(sheets)[0]] || [];
      if (!source.length) throw new Error("empty archive");
      let history = [];
      if (source.length) {
        const header = source[0] || [];
        if (String(header[0] || "").trim() === "Ngày" && String(header[1] || "").trim()) {
          history = source.slice(1).map(function(row) { return [String(row[0] || ""), String(row[1] || "")]; });
        } else {
          // Migrate the old nine-column export format into the requested
          // two-column sheet instead of creating a second workbook.
          history = source.slice(1).map(function(row) {
            return [String(row[6] || row[0] || ""), String(row[5] || row[1] || "")];
          }).filter(function(row) { return row[0] || row[1]; });
        }
      }
      const fileCounts = new Map();
      history.forEach(function(row) {
        const key = JSON.stringify(row);
        const count = Number(fileCounts.get(key) || 0) + 1;
        fileCounts.set(key, count);
        if (count > Number(maximumCounts.get(key) || 0)) { rows.push(row); maximumCounts.set(key, count); }
      });
      if (existingFile.getDescription) {
        try {
          const info = JSON.parse(existingFile.getDescription() || "{}");
          if (info.format === "gmcrm-message-archive-v2" && Array.isArray(info.lineKeys)) info.lineKeys.forEach(function(key) { archivedLineKeys.add(String(key)); });
        } catch (error) { /* Legacy workbooks have no line-identity metadata. */ }
      }
    } catch (error) {
      throw new Error("Không thể đọc tệp Tin nhắn khách.xlsx hiện có. Giữ nguyên tệp cũ và tin nhắn để thử lưu lại.");
    }
  });
  const existingKeys = {};
  rows.slice(1).forEach(function(row) { existingKeys[String(row[0]) + "\n" + String(row[1])] = true; });
  const deltaMessages = (group.messages || []).filter(function(line) { return !group.workflowVerified || !archivedLineKeys.has(workflowMessageLineKey_(line)); });
  pancakeMessageExportRows_({ ...group, messages: deltaMessages }).forEach(function(row) {
    const key = String(row[0]) + "\n" + String(row[1]);
    if (group.workflowVerified || !existingKeys[key]) { rows.push(row); existingKeys[key] = true; }
  });
  const temporary = SpreadsheetApp.create("GM-CRM Tin nhắn khách temporary " + workNoteText_(group.houseId, 100));
  try {
    const sheet = temporary.getSheets()[0];
    sheet.setName("Tin nhắn khách");
    sheet.getRange(1, 1, rows.length, 2).setValues(rows).setVerticalAlignment("top").setWrap(true).setFontFamily("Roboto");
    sheet.getRange(1, 1, 1, 2).setFontWeight("bold").setBackground("#eeeae5");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 155);
    sheet.setColumnWidth(2, 520);
    sheet.autoResizeRows(1, Math.max(1, sheet.getLastRow()));
    SpreadsheetApp.flush();
    const blob = exportXlsx_(temporary.getId()).setName(PANCAKE_MESSAGE_EXPORT_FILE_NAME);
    const lineKeys = group.workflowVerified ? Array.from(new Set(Array.from(archivedLineKeys).concat((group.messages || []).map(workflowMessageLineKey_)))).slice(-600) : Array.from(archivedLineKeys);
    const metadata = group.workflowVerified || lineKeys.length ? { description: JSON.stringify({ format: "gmcrm-message-archive-v2", lineKeys: lineKeys }) } : undefined;
    const file = replaceWorkbookFile_(documentsFolder, PANCAKE_MESSAGE_EXPORT_FILE_NAME, blob, metadata);
    return { fileId: file.getId(), fileUrl: file.getUrl(), folderUrl: documentsFolder.getUrl(), fileName: PANCAKE_MESSAGE_EXPORT_FILE_NAME };
  } finally {
    try { DriveApp.getFileById(temporary.getId()).setTrashed(true); } catch (error) { /* Cleanup must not hide an export failure or success. */ }
  }
}

function updateCustomerMessageStatus_(payload) {
  requireCustomerWorkflowManager_(payload);
  const group = normalizePancakeMessageGroup_(payload.message);
  if (workflowMessageSource_(group.id)) throw workflowError_("UPDATE_REQUIRED", "Tin nhắn đã chuyển sang cơ chế xử lý mới. Hãy cập nhật ứng dụng.");
  const status = normalizePancakeMessageStatus_(payload.status);
  if (!group.id || PANCAKE_MESSAGE_STATUSES.indexOf(status) === -1) throw new Error("Trạng thái tin nhắn không hợp lệ.");
  const states = readPancakeMessageStates_();
  const previous = states.find(function(item) { return String(item.id || "") === group.id; });
  const next = states.filter(function(item) { return String(item.id || "") !== group.id; });
  const isSpecialTest = pancakeIsSpecialTestConversation_(group.groupName, { page_customer: { name: group.customerName } });
  let exported = false;
  if (status === "resolved" && !isSpecialTest && (!previous || normalizePancakeMessageStatus_(previous.status) !== "resolved")) {
    appendPancakeMessageWorkbook_(group);
    exported = true;
  }
  const state = { ...group, status: status, resolvedAt: status === "resolved" ? new Date().toISOString() : "", statusUpdatedAt: new Date().toISOString() };
  next.push(state);
  savePancakeMessageStates_(next);
  return { ok: true, id: group.id, status: status, resolvedAt: state.resolvedAt, exported: exported };
}

// Published design rows live in one small registry at the root.  This is the
// cross-device assignment queue; the Excel files remain optional exports.
const ACTIVE_DESIGN_TASKS_FILE_NAME = "_gmcrm_thiet_ke_dang_giao.json";
const DESIGN_TASK_KINDS = ["architecture", "interior", "acceptance"];
const WORKFLOW_PROJECT_PREFIX = "gmcrm-workflow-project-v2-";
const WORKFLOW_PROJECT_INDEX = "gmcrm-workflow-project-index-v2";
const WORKFLOW_MESSAGE_STATES = "gmcrm-workflow-message-states-v2";
const WORKFLOW_MESSAGE_SOURCE_PREFIX = "gmcrm-workflow-message-source-v2-";
const WORKFLOW_DESIGN_REGISTRY = "gmcrm-active-design-tasks-v2";

function workflowError_(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function workflowHash_(value) {
  return customerAdminSessionSignature_(String(value), "gmcrm-workflow-fingerprint-v2");
}

function issueWorkflowSession_(account) {
  const claims = { version: 2, purpose: "workflow", account: account, expiresAt: Date.now() + CUSTOMER_ADMIN_SESSION_LIFETIME_MS, nonce: Utilities.getUuid() };
  const body = Utilities.base64EncodeWebSafe(JSON.stringify(claims), Utilities.Charset.UTF_8).replace(/=+$/g, "");
  return body + "." + customerAdminSessionSignature_(body, customerAdminSessionSecret_());
}

function workflowActor_(payload) {
  let account = "";
  if (payload.workflowSessionToken) {
    try {
      const token = String(payload.workflowSessionToken);
      const parts = token.split(".");
      const secret = PropertiesService.getScriptProperties().getProperty(CUSTOMER_ADMIN_SESSION_SECRET_KEY);
      if (token.length > 2048 || parts.length !== 2 || !secret || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) throw new Error("invalid token");
      const expected = customerAdminSessionSignature_(parts[0], secret);
      let difference = expected.length ^ parts[1].length;
      for (let i = 0; i < expected.length; i += 1) difference |= expected.charCodeAt(i) ^ (parts[1].charCodeAt(i) || 0);
      if (difference) throw new Error("invalid signature");
      const claims = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString("UTF-8"));
      if (claims.version === 1 && claims.purpose === "customer-admin" && payload.workflowSessionToken === payload.adminSessionToken) account = requireCustomerAdminSession_(payload).account;
      else {
        if (claims.version !== 2 || claims.purpose !== "workflow" || !Number.isFinite(claims.expiresAt) || claims.expiresAt <= Date.now()) throw new Error("expired token");
        account = String(claims.account || "").trim().toLowerCase();
      }
    } catch (error) { throw workflowError_("AUTH_REQUIRED", "Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Hãy đăng nhập lại để cập nhật công việc."); }
  } else if (payload.adminSessionToken) {
    try { account = requireCustomerAdminSession_(payload).account; }
    catch (error) { throw workflowError_("AUTH_REQUIRED", "Hãy đăng nhập lại tài khoản admin để cập nhật công việc."); }
  }
  if (!account) throw workflowError_("AUTH_REQUIRED", "Hãy đăng nhập để cập nhật công việc.");
  if (account === "admin") return { account: account, name: "Admin", admin: true, manager: true, member: null, permissions: ["Ghi chú", "Thiết kế", "Tin nhắn"] };
  const member = employeeRosterMember_(account);
  if (!member) throw workflowError_("AUTH_REQUIRED", "Nhân viên không còn hoạt động trong danh sách Nhân lực. Hãy đăng nhập lại hoặc liên hệ admin.");
  return { account: personnelAssignmentKey_(member), name: workNoteText_(member.name, 160), admin: false, manager: personnelIsManager_(member), member: member, permissions: Array.isArray(member.permissions) ? member.permissions : [] };
}

function workflowMayUse_(actor, permission) {
  if (!actor.manager && actor.permissions.indexOf(permission) < 0) throw workflowError_("FORBIDDEN", "Bạn không có quyền cập nhật phần " + permission + ".");
}

function workflowRequireManager_(actor) {
  if (!actor || !actor.manager) throw workflowError_("FORBIDDEN", "Chỉ admin và quản lý được cập nhật Tin nhắn khách, Tư vấn và Thiết kế. Nhân viên chỉ được xem.");
  return actor;
}

function requireCustomerWorkflowManager_(payload) {
  return workflowRequireManager_(workflowActor_(payload));
}

function workflowAssigned_(actor, item) {
  return assignmentMatchesEmployee_(item.assigneeEmail, actor.account, actor.member);
}

function workflowAssignee_(value) {
  const account = workNoteText_(value, 240).toLowerCase();
  if (account === "admin") return { account: "admin", name: "Admin" };
  const member = employeeRosterMember_(account);
  if (!member) throw workflowError_("VALIDATION", "Người phụ trách không tồn tại hoặc đã ngưng hoạt động trong Nhân lực.");
  return { account: personnelAssignmentKey_(member), name: workNoteText_(member.name, 160) };
}

function workflowDayNumber_(text) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(text || ""));
  if (!match) return null;
  const day = Number(match[1]), month = Number(match[2]), year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 2200 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(date.getTime() / 86400000);
}

function workflowToday_() { return Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy"); }

function workflowDueDate_(value, allowPast) {
  const text = String(value || "").trim();
  const day = workflowDayNumber_(text);
  if (day === null || (!allowPast && day < workflowDayNumber_(workflowToday_()))) throw workflowError_("VALIDATION", "Hoàn thành dự kiến phải là ngày hợp lệ hôm nay hoặc tương lai, dạng dd/mm/yyyy.");
  return text;
}

function workflowProjectKey_(details) { return WORKFLOW_PROJECT_PREFIX + workflowHash_(details.year + ":" + details.month + ":" + details.projectId); }

function workflowReadCacheKey_(key) { return "gmcrm-workflow-read-v2:" + workflowHash_(key); }

function workflowReadSnapshot_(key, useReadCache) {
  const cacheKey = workflowReadCacheKey_(key);
  if (useReadCache) {
    try {
      const cached = CacheService.getScriptCache().get(cacheKey);
      if (typeof cached === "string" && cached) return JSON.parse(cached);
    } catch (error) { /* Cache is optional; the committed property store remains authoritative. */ }
  }
  const value = readPropertyJson_(key);
  if (useReadCache) {
    const serialized = JSON.stringify(value);
    let bytes = 0;
    for (const character of serialized) { const code = character.charCodeAt(0); bytes += character.length === 2 ? 4 : code < 128 ? 1 : code < 2048 ? 2 : 3; if (bytes > 90000) break; }
    if (bytes <= 90000) {
      try { CacheService.getScriptCache().put(cacheKey, serialized, 6); } catch (error) { /* Oversized/unavailable cache never blocks a read. */ }
    }
  }
  return value;
}

function workflowInvalidateReadCache_(key) {
  try { CacheService.getScriptCache().remove(workflowReadCacheKey_(key)); } catch (error) { /* A failed invalidation expires within six seconds. */ }
}

function workflowReadProject_(details, useReadCache) {
  const key = workflowProjectKey_(details);
  // Commands omit useReadCache and always re-read the committed state under
  // the script write lock. Only UI polling uses the six-second snapshot.
  const state = workflowReadSnapshot_(key, Boolean(useReadCache));
  return state && state.version === 2 ? state : null;
}

function workflowWriteProject_(state) {
  const key = workflowProjectKey_(state.details);
  const index = readPropertyJson_(WORKFLOW_PROJECT_INDEX) || [];
  if (!index.some(function(item) { return Number(item.year) === state.details.year && Number(item.month) === state.details.month && item.projectId === state.details.projectId; })) { writePropertyJson_(WORKFLOW_PROJECT_INDEX, index.concat([state.details])); workflowInvalidateReadCache_(WORKFLOW_PROJECT_INDEX); }
  // Publish a pointer only after every chunk has been written. Readers never
  // observe a half-written note collection while a command is in progress.
  writePropertyJson_(key, state);
  workflowInvalidateReadCache_(key);
}

function workflowResetCustomerProject_(payload, customerDeleted) {
  const details = { year: Number(payload.year), month: Number(payload.month), projectId: String(payload.projectId || "").trim(), houseId: String(payload.houseId || "").trim(), customerName: "" };
  if (!details.projectId) return;
  const existing = workflowReadProject_(details);
  if (existing && existing.customerDeleted === customerDeleted && !existing.notes.length && DESIGN_TASK_KINDS.every(function(kind) { return !(existing.design[kind] || []).length; }) && !existing.legacyImportPending) return;
  const deletedIds = Array.from(new Set((existing && existing.deletedIds || []).concat((existing && existing.notes || []).map(function(note) { return note.id; }))));
  const design = {};
  DESIGN_TASK_KINDS.forEach(function(kind) { design[kind] = []; });
  workflowWriteProject_({ version: 2, details: details, revision: Number(existing && existing.revision || 0) + 1, notes: [], deletedIds: deletedIds, design: design, requests: existing && existing.requests || [], legacyImportPending: false, legacyImportError: "", customerDeleted: Boolean(customerDeleted) });
}

function workflowWorkspaceRecord_(details) {
  const workspace = readPropertyJson_(WORKSPACE_CACHE_PROPERTY_KEY);
  const year = workspace && Array.isArray(workspace.years) && workspace.years.find(function(item) { return Number(item.year) === details.year; });
  const month = year && (year.months || []).find(function(item, index) { return String(item.label) === "T" + details.month || (!item.label && index + 1 === details.month); });
  return month && (month.records || []).find(function(item) { return item.projectId === details.projectId; }) || null;
}

function workflowProject_(details, retryLegacyImport) {
  const existing = workflowReadProject_(details);
  if (existing && existing.customerDeleted) throw workflowError_("NOT_FOUND", "Khách hàng đã được xóa. Không thể cập nhật công việc cũ.");
  if (existing) return existing.legacyImportPending && retryLegacyImport ? workflowTryLegacyImport_(existing) : existing;
  const stored = readPropertyJson_(workNotesPropertyKey_(details));
  let notes = Array.isArray(stored) ? normalizeWorkNotes_(stored) : [];
  let legacyImportPending = false;
  let legacyImportError = "";
  if (!Array.isArray(stored)) {
    try { notes = workflowLegacyDriveNotes_(details); }
    catch (error) {
      if (error.code === "STORAGE_CORRUPT" || error.code === "RETRYABLE") throw error;
      legacyImportPending = true;
      legacyImportError = workNoteText_(error.message || "Chưa thể đọc lịch sử Drive. Giao việc mới vẫn được giữ trong cache.", 300);
    }
  }
  const record = workflowWorkspaceRecord_(details);
  const active = readActiveDesignTasks_().filter(function(row) { return row.year === details.year && row.month === details.month && row.projectId === details.projectId; });
  const design = {};
  DESIGN_TASK_KINDS.forEach(function(kind) {
    const field = kind === "interior" ? "interiorDesignProgress" : kind === "acceptance" ? "acceptanceDesignProgress" : "designProgress";
    const rows = normalizeDesignTaskRows_(record && record[field] || []);
    const byId = new Map(rows.map(function(row) { return [row.id, row]; }));
    active.filter(function(row) { return row.kind === kind; }).forEach(function(row) { byId.set(row.id, { ...byId.get(row.id), ...row }); });
    design[kind] = Array.from(byId.values());
  });
  return { version: 2, details: details, revision: 0, notes: notes || [], deletedIds: [], design: design, requests: [], legacyImportPending: legacyImportPending, legacyImportError: legacyImportError };
}

function workflowLegacyDriveNotes_(details) {
  if (isVirtualPancakeTestProject_(details)) return [];
  const record = workflowWorkspaceRecord_(details);
  const folder = workNotesFolder_(details.year, details.month, details.projectId, false, record && record.houseId || details.houseId);
  if (!folder) return [];
  const file = findFileByName_(folder, WORK_NOTES_FILE_NAME);
  if (!file) return [];
  const raw = JSON.parse(file.getBlob().getDataAsString("UTF-8") || "[]");
  if (!Array.isArray(raw)) throw new Error("Lịch sử ghi chú Drive không hợp lệ. Tệp cũ được giữ nguyên để thử đọc lại.");
  return normalizeWorkNotes_(raw);
}

function workflowTryLegacyImport_(state) {
  try {
    const legacy = workflowLegacyDriveNotes_(state.details);
    const known = new Set(state.notes.map(function(note) { return note.id; }));
    const deleted = new Set(state.deletedIds || []);
    legacy.forEach(function(note) { if (!known.has(note.id) && !deleted.has(note.id)) { state.notes.push(note); known.add(note.id); } });
    state.legacyImportPending = false;
    state.legacyImportError = "";
    state.revision += 1;
    state._legacyImportChanged = true;
  } catch (error) {
    if (error.code === "STORAGE_CORRUPT" || error.code === "RETRYABLE") throw error;
    state.legacyImportError = workNoteText_(error.message || "Chưa thể đọc lịch sử Drive. Dữ liệu mới vẫn được giữ trong cache.", 300);
  }
  return state;
}

function workflowDetails_(payload) {
  const details = workNotesPayload_(payload);
  if (!/^\d{4}$/.test(String(details.year)) || details.month % 1 || !validCustomerFolderKey_(details.projectId)) throw workflowError_("VALIDATION", "Thông tin khách hàng không hợp lệ.");
  if (isCustomerDriveRecordDeleted_(details)) throw workflowError_("NOT_FOUND", "Khách hàng đã được xóa. Không thể cập nhật công việc.");
  return { ...details, customerName: workNoteText_(payload.customerName, 240) };
}

function workflowSnapshot_(state, extra, actor) {
  const now = Date.now();
  const notes = state.notes.filter(function(note) { return (!actor || actor.manager || actor.permissions.indexOf("Ghi chú") >= 0 && (note.creatorEmail === actor.account || workflowAssigned_(actor, note))) && (!note.completedAt || note.archivePending || !note.archivedAt || now - new Date(note.completedAt).getTime() < 2 * 86400000); }).map(function(note) { return { ...note, status: workNoteStatus_(note.acceptedAt, note.dueDate) }; });
  return { ok: true, revision: state.revision, notes: notes, deletedIds: state.deletedIds || [], legacyImportPending: Boolean(state.legacyImportPending), legacyImportError: state.legacyImportError || "", ...extra };
}

function workflowCheckRevision_(payload, item) {
  if (payload.expectedRevision !== undefined && Number(payload.expectedRevision) !== Number(item.revision || 0)) throw workflowError_("CONFLICT", "Công việc đã được cập nhật trên thiết bị khác. Hãy tải lại trước khi sửa.");
}

function workflowRequestSignature_(payload, actor) {
  const excluded = ["workflowSessionToken", "adminSessionToken", "token", "requestId"];
  const stable = function(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.keys(value).sort().filter(function(key) { return excluded.indexOf(key) < 0; }).map(function(key) { return [key, stable(value[key])]; }));
  };
  return workflowHash_(actor.account + ":" + JSON.stringify(stable(payload)));
}

function workflowRememberRequest_(state, payload, signature, actor, targetId) {
  state.requests = (state.requests || []).concat([{ id: payload.requestId, signature: signature, actor: actor.account, operation: payload.operation, targetId: targetId || "", at: Date.now() }]).slice(-100);
}

function workflowNewNote_(draft, actor, previous) {
  draft = draft || {};
  const assignee = workflowAssignee_(draft.assigneeEmail);
  const dueDate = workflowDueDate_(draft.dueDate, Boolean(previous && previous.dueDate === draft.dueDate));
  const content = workNoteText_(draft.content, 4000);
  if (!content) throw workflowError_("VALIDATION", "Hãy nhập nội dung công việc trước khi phát hành.");
  if (WORK_NOTE_PRIORITIES.indexOf(draft.priority) < 0 || WORK_NOTE_TYPES.indexOf(draft.workType) < 0) throw workflowError_("VALIDATION", "Ưu tiên hoặc loại công việc không hợp lệ.");
  const reassigned = previous && previous.assigneeEmail !== assignee.account;
  const note = {
    ...previous, id: workNoteText_(draft.id || previous && previous.id, 100), priority: draft.priority, workType: draft.workType,
    assigneeEmail: assignee.account, assignee: assignee.name, content: content, dueDate: dueDate,
    creatorEmail: previous && previous.creatorEmail || actor.account, creatorName: previous && previous.creatorName || actor.name,
    createdAt: previous && previous.createdAt || new Date().toISOString(), publishedAt: previous && previous.publishedAt || new Date().toISOString(),
    acceptedAt: reassigned ? "" : previous && previous.acceptedAt || "", acceptedBy: reassigned ? "" : previous && previous.acceptedBy || "",
    actualDate: reassigned ? "" : previous && previous.actualDate || "", completedAt: reassigned ? "" : previous && previous.completedAt || "",
    revision: Number(previous && previous.revision || 0) + 1, updatedAt: new Date().toISOString(),
  };
  if (!note.id || !/^[A-Za-z0-9_.:-]{1,100}$/.test(note.id)) throw workflowError_("VALIDATION", "Mã công việc không hợp lệ.");
  note.status = workNoteStatus_(note.acceptedAt, note.dueDate);
  return note;
}

function workflowProjectItems_(state, domain) {
  if (domain === "notes") return state.notes;
  return DESIGN_TASK_KINDS.reduce(function(all, kind) { return all.concat((state.design[kind] || []).map(function(row) { return { ...row, kind: kind }; })); }, []);
}

function workflowArchiveItem_(details, item, kind) {
  if (isVirtualPancakeTestProject_(details)) return { virtual: true };
  const root = rootFolder_();
  const customers = findFolder_(root, CUSTOMERS_FOLDER_NAME);
  const year = customers && findFolder_(customers, String(details.year));
  const month = year && findFolder_(year, "T" + details.month);
  if (!month || !customerFolderForPayload_(details, false)) throw new Error("Thư mục khách hàng không còn tồn tại trên Drive. Giữ công việc hoàn thành trong cache.");
  const fileName = COMPLETED_WORK_NOTES_FILE_NAME;
  const file = findFileByName_(month, fileName);
  let records = [];
  if (file) {
    try { records = JSON.parse(file.getBlob().getDataAsString("UTF-8") || "[]"); }
    catch (error) { throw new Error("Không thể đọc kho hoàn thành hiện có. Giữ nguyên tệp cũ để thử lưu lại."); }
    if (!Array.isArray(records)) throw new Error("Kho hoàn thành hiện có không hợp lệ. Tệp cũ được giữ nguyên.");
  }
  const archiveKey = details.year + ":" + details.month + ":" + details.projectId + ":" + kind + ":" + item.id;
  const kept = records.filter(function(record) { return (record.archiveKey || (record.projectId === details.projectId && String(record.id) === String(item.id) && !record.kind ? archiveKey : "")) !== archiveKey; });
  kept.push({ ...item, ...details, kind: kind, archiveKey: archiveKey, savedAt: Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss") });
  if (file) file.setContent(JSON.stringify(kept));
  else month.createFile(fileName, JSON.stringify(kept), MimeType.PLAIN_TEXT);
  return { folderUrl: month.getUrl() };
}

function workflowAttemptArchives_(state, onlyId, report, actor) {
  let changed = false;
  let attempted = 0;
  const archive = function(item, kind) {
    if (actor && !actor.manager && (kind !== "note" || !workflowAssigned_(actor, item))) return item;
    if (!item.actualDate || !item.completedAt || (onlyId && item.id !== onlyId) || item.archivedAt || attempted >= 10) return item;
    attempted += 1;
    let result;
    try {
      const delivered = workflowArchiveItem_(state.details, item, kind);
      result = { ...item, archivePending: false, archivedAt: new Date().toISOString(), archiveError: "", virtual: Boolean(delivered.virtual) };
    } catch (error) {
      result = { ...item, archivePending: true, archiveError: workNoteText_(error.message || "Chưa thể lưu Drive. Công việc đã được giữ trong cache dùng chung.", 300) };
    }
    if (result.archivePending !== item.archivePending || result.archiveError !== item.archiveError || result.archivedAt !== item.archivedAt) {
      changed = true;
      if (report && kind.indexOf("design:") === 0) report.designChanged = true;
      return { ...result, revision: Number(item.revision || 0) + 1, updatedAt: new Date().toISOString() };
    }
    return item;
  };
  state.notes = state.notes.map(function(note) { return archive(note, "note"); });
  DESIGN_TASK_KINDS.forEach(function(kind) { state.design[kind] = (state.design[kind] || []).map(function(row) { return archive(row, "design:" + kind); }); });
  return changed;
}

function workflowPruneArchived_(state) {
  const expired = state.notes.filter(function(note) { return note.completedAt && note.archivedAt && !note.archivePending && Date.now() - new Date(note.completedAt).getTime() >= 2 * 86400000; });
  if (!expired.length) return false;
  const ids = new Set(expired.map(function(note) { return note.id; }));
  state.notes = state.notes.filter(function(note) { return !ids.has(note.id); });
  state.deletedIds = Array.from(new Set((state.deletedIds || []).concat(Array.from(ids))));
  state.revision += 1;
  return true;
}

function workflowProjectResponse_(state, payload, targetId, repeated, actor) {
  const kind = payload.kind;
  const note = state.notes.find(function(item) { return item.id === (targetId || payload.noteId || payload.note && payload.note.id); });
  const canViewDesign = !actor || actor.manager || actor.permissions.indexOf("Thiết kế") >= 0;
  const rows = canViewDesign && DESIGN_TASK_KINDS.indexOf(kind) >= 0 ? state.design[kind] || [] : undefined;
  const items = state.notes.concat(workflowProjectItems_(state, "design"));
  return workflowSnapshot_(state, { note: note, rows: rows, design: canViewDesign ? state.design : undefined, tasks: canViewDesign ? workflowProjectItems_(state, "design").filter(function(row) { return row.publishedAt && !row.actualDate; }) : [], archivePending: items.some(function(item) { return item.archivePending; }), repeated: Boolean(repeated), deleted: payload.operation === "note.delete" }, actor);
}

function workflowCommand_(payload) {
  const actor = workflowActor_(payload);
  const operation = workNoteText_(payload.operation, 60);
  const requestId = workNoteText_(payload.requestId, 160);
  if (!requestId || requestId !== payload.requestId || !/^[A-Za-z0-9_.:-]{1,160}$/.test(requestId)) throw workflowError_("VALIDATION", "Thiếu mã yêu cầu cập nhật công việc hợp lệ.");
  if (["note.publish", "note.edit", "note.delete", "note.accept", "note.complete", "design.publish", "design.accept", "design.complete", "message.status", "message.assign", "archive.retry"].indexOf(operation) < 0) throw workflowError_("VALIDATION", "Thao tác công việc không được hỗ trợ. Hãy cập nhật ứng dụng.");
  if (/^(?:design|message)\./.test(operation) || operation === "archive.retry" && (payload.kind || payload.rowId)) workflowRequireManager_(actor);
  if (operation === "message.status") return workflowMessageStatus_(payload, actor);
  let messageSource = null;
  let details;
  if (operation === "message.assign") {
    if (!actor.manager) throw workflowError_("FORBIDDEN", "Chỉ admin và quản lý mới có quyền giao việc từ tin nhắn.");
    messageSource = workflowMessageSource_(payload.messageId || payload.message && payload.message.id);
    if (!messageSource) throw workflowError_("NOT_FOUND", "Tin nhắn chưa có trong dữ liệu máy chủ. Hãy nạp lại tin nhắn rồi thử giao việc.");
    const special = pancakeIsSpecialTestConversation_(messageSource.groupName, { page_customer: { name: messageSource.customerName } });
    details = workflowDetails_({ ...messageSource, projectId: special ? VIRTUAL_PANCAKE_TEST_PROJECT_ID : messageSource.projectId, houseId: special ? "Bùi Đức Thành" : messageSource.houseId });
  } else details = workflowDetails_(payload);
  if (operation === "archive.retry") {
    if (!actor.manager && actor.permissions.indexOf("Ghi chú") < 0 && actor.permissions.indexOf("Thiết kế") < 0) throw workflowError_("FORBIDDEN", "Bạn không có quyền lưu trữ công việc.");
  } else workflowMayUse_(actor, operation.indexOf("design.") === 0 ? "Thiết kế" : "Ghi chú");
  const state = workflowProject_(details, operation === "archive.retry");
  const legacyImported = Boolean(state._legacyImportChanged);
  delete state._legacyImportChanged;
  const pruned = workflowPruneArchived_(state);
  const signature = workflowRequestSignature_(payload, actor);
  const previousRequest = (state.requests || []).find(function(item) { return item.id === requestId; });
  if (previousRequest) {
    if (previousRequest.signature !== signature || previousRequest.actor !== actor.account) throw workflowError_("CONFLICT", "Mã yêu cầu đã được dùng cho nội dung hoặc nhân viên khác.");
    const archiveReport = {};
    const canRetryArchive = operation === "note.complete" || operation === "design.complete" || operation === "archive.retry";
    const archiveChanged = canRetryArchive && workflowAttemptArchives_(state, previousRequest.targetId, archiveReport, actor);
    if (archiveChanged) state.revision += 1;
    if (archiveChanged || pruned || legacyImported) { workflowWriteProject_(state); workflowProjectProjection_(state, { kind: payload.kind, designChanged: Boolean(archiveReport.designChanged) }); }
    return workflowProjectResponse_(state, payload, previousRequest.targetId, true, actor);
  }
  let targetId = String(payload.noteId || payload.rowId || "");
  const now = new Date().toISOString();
  if (operation === "note.publish" || operation === "message.assign") {
    let draft = payload.note || {};
    if (messageSource) {
      const selected = Array.isArray(payload.selectedLineIds) ? Array.from(new Set(payload.selectedLineIds.map(String))) : [];
      if (!selected.length) throw workflowError_("VALIDATION", "Hãy chọn ít nhất một dòng tin nhắn để giao việc.");
      const lines = messageSource.messages.filter(function(line) { return selected.indexOf(line.id) >= 0; });
      if (lines.length !== selected.length) throw workflowError_("VALIDATION", "Dòng tin nhắn đã thay đổi. Hãy nạp lại trước khi giao việc.");
      draft = { ...(payload.assignment || {}), id: payload.assignment && payload.assignment.id || "message-task-" + workflowHash_(messageSource.id + ":" + requestId).slice(0, 40) };
      draft.messageContext = lines.map(function(line) { return line.senderName + ": " + line.content + " (" + Utilities.formatDate(new Date(line.sentAt), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm") + ")"; }).join("\n");
    }
    targetId = String(draft.id || "");
    if (state.notes.some(function(note) { return note.id === targetId; }) || state.deletedIds.indexOf(targetId) >= 0) throw workflowError_("CONFLICT", "Mã công việc đã được sử dụng. Không tạo thêm bản trùng.");
    const note = workflowNewNote_(draft, actor, null);
    if (messageSource) { note.sourceMessageId = messageSource.id; note.messageContext = draft.messageContext; }
    state.notes.push(note);
  } else if (operation.indexOf("note.") === 0) {
    targetId = String(payload.noteId || payload.note && payload.note.id || "");
    const index = state.notes.findIndex(function(note) { return note.id === targetId; });
    if (index < 0 || state.deletedIds.indexOf(targetId) >= 0) throw workflowError_("NOT_FOUND", "Ghi chú không còn tồn tại. Hãy nạp lại danh sách.");
    const current = state.notes[index];
    if (operation === "note.edit" || operation === "note.delete") {
      if (current.creatorEmail !== actor.account) throw workflowError_("FORBIDDEN", "Chỉ người tạo ghi chú mới có thể sửa hoặc xóa.");
      workflowCheckRevision_(payload, current);
      if (current.actualDate) throw workflowError_("FORBIDDEN", "Ghi chú đã hoàn thành được giữ nguyên để lưu lịch sử.");
      if (operation === "note.delete") { state.notes.splice(index, 1); state.deletedIds.push(targetId); }
      else state.notes[index] = workflowNewNote_({ ...payload.note, id: current.id }, actor, current);
    } else {
      if (!workflowAssigned_(actor, current)) throw workflowError_("FORBIDDEN", "Chỉ người phụ trách mới được nhận hoặc hoàn thành công việc này.");
      if (!current.actualDate) {
        if (operation === "note.accept") state.notes[index] = { ...current, acceptedAt: current.acceptedAt || now, acceptedBy: actor.account, revision: Number(current.revision || 0) + (current.acceptedAt ? 0 : 1), updatedAt: now, status: workNoteStatus_(now, current.dueDate) };
        else {
          if (!current.acceptedAt) throw workflowError_("VALIDATION", "Hãy xác nhận nhận việc trước khi hoàn thành.");
          state.notes[index] = { ...current, actualDate: workflowToday_(), completedAt: now, archivePending: true, revision: Number(current.revision || 0) + 1, updatedAt: now };
        }
      }
    }
  } else if (operation.indexOf("design.") === 0) {
    workflowDesignCommand_(state, payload, actor);
    targetId = String(payload.rowId || "");
  }
  state.revision += 1;
  workflowRememberRequest_(state, payload, signature, actor, targetId);
  workflowWriteProject_(state);
  const projection = { kind: payload.kind, designChanged: operation.indexOf("design.") === 0 };
  if (operation === "note.complete" || operation === "design.complete" || operation === "archive.retry") {
    if (workflowAttemptArchives_(state, operation === "archive.retry" ? null : targetId, projection, actor)) { state.revision += 1; workflowWriteProject_(state); }
  }
  workflowProjectProjection_(state, projection);
  return workflowProjectResponse_(state, payload, targetId, false, actor);
}

function workflowDesignCommand_(state, payload, actor) {
  workflowRequireManager_(actor);
  const kind = String(payload.kind || "");
  if (DESIGN_TASK_KINDS.indexOf(kind) < 0) throw workflowError_("VALIDATION", "Loại thiết kế không hợp lệ.");
  const currentRows = state.design[kind] || [];
  const now = new Date().toISOString();
  if (payload.operation === "design.publish") {
    const incoming = Array.isArray(payload.rows) ? payload.rows : [];
    if (!incoming.length || incoming.length > 300) throw workflowError_("VALIDATION", "Hãy chọn các hạng mục thiết kế cần phát hành.");
    const seen = new Set();
    let published = 0;
    const next = currentRows.slice();
    incoming.forEach(function(draft) {
      const id = workNoteText_(draft.id, 140);
      if (!id || seen.has(id)) throw workflowError_("VALIDATION", "Hạng mục thiết kế bị thiếu hoặc trùng mã.");
      seen.add(id);
      const previousIndex = next.findIndex(function(row) { return row.id === id; });
      const current = previousIndex >= 0 ? next[previousIndex] : null;
      const content = workNoteText_(draft.content, 800);
      if (!content || (!draft.assigneeEmail && !draft.plannedDate && !draft.publishedAt)) return;
      const assignee = workflowAssignee_(draft.assigneeEmail);
      const dueDate = workflowDueDate_(draft.plannedDate, Boolean(current && current.plannedDate === draft.plannedDate));
      const changed = current && current.publishedAt && (current.content !== content || current.assigneeEmail !== assignee.account || current.plannedDate !== dueDate || current.note !== workNoteText_(draft.note, 4000));
      const dirtyAcknowledgement = draft.assignmentDirty === true;
      const editingPublished = Boolean(current && current.publishedAt && (changed || dirtyAcknowledgement));
      if (editingPublished && (!actor.manager && current.creatorEmail !== actor.account)) throw workflowError_("FORBIDDEN", "Chỉ người phát hành hoặc quản lý mới được thay đổi hạng mục đã giao.");
      if (editingPublished && current.actualDate) throw workflowError_("FORBIDDEN", "Hạng mục đã hoàn thành được giữ nguyên để lưu lịch sử.");
      if (editingPublished && Number(draft.revision || 0) !== Number(current.revision || 0)) throw workflowError_("CONFLICT", "Hạng mục thiết kế đã được cập nhật trên thiết bị khác. Hãy tải lại.");
      const reassigned = current && current.assigneeEmail !== assignee.account;
      const row = { ...current, id: id, isCustom: Boolean(draft.isCustom), content: content, plannedDate: dueDate, assigneeEmail: assignee.account, assignee: assignee.name, note: workNoteText_(draft.note, 4000),
        publishedAt: current && current.publishedAt || now, creatorEmail: current && current.creatorEmail || actor.account, creatorName: current && current.creatorName || actor.name,
        acceptedAt: reassigned ? "" : current && current.acceptedAt || "", acceptedBy: reassigned ? "" : current && current.acceptedBy || "", actualDate: current && current.actualDate || "", completedAt: current && current.completedAt || "",
        revision: Number(current && current.revision || 0) + (!current || !current.publishedAt || changed || dirtyAcknowledgement ? 1 : 0), updatedAt: now, title: workNoteText_(payload.title, 160) || "Tiến độ thiết kế" };
      if (previousIndex >= 0) next[previousIndex] = row; else next.push(row);
      published += 1;
    });
    if (!published) throw workflowError_("VALIDATION", "Hãy chọn Người phụ trách và ngày dự kiến cho ít nhất một hạng mục.");
    state.design[kind] = next;
    return;
  }
  const index = currentRows.findIndex(function(row) { return row.id === payload.rowId; });
  const current = currentRows[index];
  if (!current || !current.publishedAt) throw workflowError_("NOT_FOUND", "Hạng mục chưa được phát hành hoặc không còn tồn tại.");
  if (current.actualDate) return;
  if (payload.operation === "design.accept") currentRows[index] = { ...current, acceptedAt: current.acceptedAt || now, acceptedBy: actor.account, revision: Number(current.revision || 0) + (current.acceptedAt ? 0 : 1), updatedAt: now };
  else {
    if (!current.acceptedAt) throw workflowError_("VALIDATION", "Hãy xác nhận nhận việc trước khi hoàn thành hạng mục.");
    currentRows[index] = { ...current, actualDate: workflowToday_(), completedAt: now, archivePending: true, revision: Number(current.revision || 0) + 1, updatedAt: now };
  }
  state.design[kind] = currentRows;
}

function workflowProjectProjection_(state, projection) {
  // Compatibility projections are rebuilt from the committed snapshot. A
  // failed projection never rolls back an accepted/completed canonical item.
  try { cacheJson_(workNotesCacheKey_(state.details), state.notes, 21600); } catch (cacheError) { /* Optional CacheService failure must not skip a design workspace update. */ }
  // Canonical projects are discovered through WORKFLOW_PROJECT_INDEX.
  // Keep note commands off the global workspace write path; only design
  // changes project their public progress fields into the workspace record.
  if (!projection || !projection.designChanged) return;
  try {
    const workspace = readPropertyJson_(WORKSPACE_CACHE_PROPERTY_KEY);
    if (workspace && Array.isArray(workspace.years)) {
      let found = false;
      workspace.years = workspace.years.map(function(year) {
        if (Number(year.year) !== state.details.year) return year;
        return { ...year, months: (year.months || []).map(function(month, index) {
          const monthNumber = /^T\d+$/.test(month.label) ? Number(month.label.slice(1)) : index + 1;
          if (monthNumber !== state.details.month) return month;
          return { ...month, records: (month.records || []).map(function(record) {
            if (record.projectId !== state.details.projectId) return record;
            found = true;
            return workflowOverlayDesignRecord_(record, state, projection.kind);
          }) };
        }) };
      });
      if (found) { workspace.updatedAt = Date.now(); writePropertyJson_(WORKSPACE_CACHE_PROPERTY_KEY, workspace); }
    }
  } catch (error) { /* All readers can recover directly from the canonical snapshot. */ }
}

function workflowProtectWorkspace_(years, useReadCache) {
  return years.map(function(year) { return { ...year, months: (year.months || []).map(function(month, index) { return { ...month, records: (month.records || []).map(function(record) {
    const details = { year: Number(year.year), month: /^T\d+$/.test(month.label) ? Number(month.label.slice(1)) : index + 1, projectId: record.projectId };
    const state = workflowReadProject_(details, Boolean(useReadCache));
    if (!state) return record;
    if (state.customerDeleted) return null;
    return workflowOverlayDesignRecord_(record, state);
  }).filter(Boolean) }; }) }; });
}

function workflowOverlayDesignRecord_(record, state, selectedKind) {
    const next = { ...record };
    const kinds = DESIGN_TASK_KINDS.indexOf(selectedKind) >= 0 ? [selectedKind] : DESIGN_TASK_KINDS;
    kinds.forEach(function(kind) {
      const field = kind === "interior" ? "interiorDesignProgress" : kind === "acceptance" ? "acceptanceDesignProgress" : "designProgress";
      const canonical = (state.design[kind] || []).filter(function(row) { return row.publishedAt; });
      const byId = new Map(canonical.map(function(row) { return [row.id, row]; }));
      const existing = Array.isArray(record[field]) ? record[field] : [];
      next[field] = existing.map(function(row) { const current = byId.get(row.id); byId.delete(row.id); return current || (row.publishedAt ? null : row); }).filter(Boolean).concat(Array.from(byId.values()));
    });
    return next;
}

function workflowMessageSource_(id) {
  const key = workNoteText_(id, 220);
  return key ? readPropertyJson_(WORKFLOW_MESSAGE_SOURCE_PREFIX + workflowHash_(key)) : null;
}

function workflowMessageLineKey_(line) {
  return workflowHash_(JSON.stringify([line.id, line.sentAt, line.senderName, line.content]));
}

function workflowIngestMessages_(groups) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const states = readPancakeMessageStates_();
    const byId = new Map(states.map(function(state) { return [state.id, state]; }));
    let changed = false;
    groups.forEach(function(raw) {
      const group = normalizePancakeMessageGroup_(raw);
      group.messages = Array.from(new Map(group.messages.map(function(line) { return [line.id || workflowMessageLineKey_(line), line]; })).values());
      group.messageCount = group.messages.length;
      const sourceKey = WORKFLOW_MESSAGE_SOURCE_PREFIX + workflowHash_(group.id);
      const previousSource = readPropertyJson_(sourceKey);
      if (JSON.stringify(previousSource) !== JSON.stringify(group)) writePropertyJson_(sourceKey, group);
      const previous = byId.get(group.id);
      if (!previous) { byId.set(group.id, { ...group, status: "new", revision: 1, archivedLineKeys: [], resolvedAt: "" }); changed = true; return; }
      const archivedKeys = Array.isArray(previous.archivedLineKeys) ? previous.archivedLineKeys : previous.status === "resolved" && !previous.archivePending ? (previous.messages || []).map(workflowMessageLineKey_) : [];
      const fresh = group.messages.some(function(line) { return archivedKeys.indexOf(workflowMessageLineKey_(line)) < 0; });
      const sourceChanged = JSON.stringify(previous.messages || []) !== JSON.stringify(group.messages);
      const reopened = previous.status === "resolved" && fresh && sourceChanged;
      if (sourceChanged || reopened || !Array.isArray(previous.archivedLineKeys)) {
        byId.set(group.id, { ...previous, ...group, archivedLineKeys: archivedKeys, archivedAt: previous.archivedAt || (previous.status === "resolved" && !previous.archivePending ? previous.resolvedAt || previous.statusUpdatedAt || "" : ""), status: reopened ? "new" : normalizePancakeMessageStatus_(previous.status), resolvedAt: reopened ? "" : previous.resolvedAt || "", revision: Number(previous.revision || 0) + 1 });
        changed = true;
      }
    });
    if (changed) savePancakeMessageStates_(Array.from(byId.values()));
    return Array.from(byId.values());
  } finally { lock.releaseLock(); }
}

function workflowArchiveMessage_(state) {
  const special = pancakeIsSpecialTestConversation_(state.groupName, { page_customer: { name: state.customerName } });
  const archived = Array.isArray(state.archivedLineKeys) ? state.archivedLineKeys : [];
  const pendingLines = (state.messages || []).filter(function(line) { return archived.indexOf(workflowMessageLineKey_(line)) < 0; });
  try {
    if (!special && pendingLines.length) appendPancakeMessageWorkbook_({ ...state, messages: pendingLines, workflowVerified: true });
    return { ...state, archivePending: false, archiveError: "", archivedAt: new Date().toISOString(), archivedLineKeys: Array.from(new Set(archived.concat((state.messages || []).map(workflowMessageLineKey_)))), virtual: special };
  } catch (error) {
    return { ...state, archivePending: true, archiveError: workNoteText_(error.message || "Chưa thể lưu Excel lên Drive. Tin nhắn vẫn được giữ trong cache dùng chung.", 300) };
  }
}

function workflowMessageStatus_(payload, actor) {
  workflowRequireManager_(actor);
  const id = workNoteText_(payload.messageId || payload.message && payload.message.id, 220);
  const source = workflowMessageSource_(id);
  if (!source) throw workflowError_("NOT_FOUND", "Tin nhắn chưa có trong dữ liệu máy chủ. Hãy nạp lại tin nhắn rồi thử tiếp.");
  const status = String(payload.status || "");
  if (PANCAKE_MESSAGE_STATUSES.indexOf(status) < 0) throw workflowError_("VALIDATION", "Trạng thái tin nhắn không hợp lệ.");
  const states = readPancakeMessageStates_();
  const index = states.findIndex(function(item) { return item.id === id; });
  let state = { ...source, ...(index >= 0 ? states[index] : {}), messages: source.messages };
  const signature = workflowRequestSignature_(payload, actor);
  const prior = (state.requests || []).find(function(item) { return item.id === payload.requestId; });
  if (prior && (prior.signature !== signature || prior.actor !== actor.account)) throw workflowError_("CONFLICT", "Mã yêu cầu tin nhắn đã được dùng cho nội dung hoặc nhân viên khác.");
  if (!prior) {
    workflowCheckRevision_(payload, state);
    if (state.status === "resolved" && !state.archivePending && status !== "resolved") throw workflowError_("CONFLICT", "Tin nhắn đã được hoàn thành và lưu Drive. Hãy nạp lại danh sách.");
    const now = new Date().toISOString();
    const firstResolution = status === "resolved" && state.status !== "resolved";
    state = { ...state, status: status, revision: Number(state.revision || 0) + 1, statusUpdatedAt: now, statusUpdatedBy: actor.account,
      resolvedAt: status === "resolved" ? state.resolvedAt || now : "", completedBy: status === "resolved" ? actor.account : state.completedBy || "", archivePending: status === "resolved" ? !state.archivedAt || state.archivePending || source.messages.some(function(line) { return (state.archivedLineKeys || []).indexOf(workflowMessageLineKey_(line)) < 0; }) : state.archivePending || false };
    if (firstResolution) state.completionHistory = (state.completionHistory || []).concat([{ at: now, by: actor.account, messageIds: source.messages.map(function(line) { return line.id; }) }]).slice(-50);
    state.requests = (state.requests || []).concat([{ id: payload.requestId, signature: signature, actor: actor.account, at: Date.now() }]).slice(-100);
    if (index >= 0) states[index] = state; else states.push(state);
    savePancakeMessageStates_(states);
  }
  let exported = false;
  if (state.status === "resolved" && (state.archivePending || !state.archivedAt)) {
    const archived = workflowArchiveMessage_(state);
    if (archived.archivePending !== state.archivePending || archived.archiveError !== state.archiveError || archived.archivedAt !== state.archivedAt) state = { ...archived, revision: Number(state.revision || 0) + 1 };
    const stateIndex = states.findIndex(function(item) { return item.id === id; });
    states[stateIndex] = state;
    savePancakeMessageStates_(states);
    exported = !state.archivePending && !state.virtual;
  }
  return { ok: true, id: id, status: state.status, message: workflowPublicMessage_(state), revision: state.revision, resolvedAt: state.resolvedAt || "", archivePending: Boolean(state.archivePending), exported: exported, repeated: Boolean(prior) };
}

function workflowPublicMessage_(state) {
  const { requests, archivedLineKeys, completionHistory, ...publicState } = state;
  return publicState;
}

function workflowMessagesView_(groups, states) {
  const byId = new Map(states.map(function(state) { return [state.id, state]; }));
  return groups.map(function(group) {
    const state = byId.get(group.id);
    return state ? { ...workflowPublicMessage_(state), ...workflowPublicMessage_(group), status: normalizePancakeMessageStatus_(state.status), resolvedAt: state.resolvedAt || "", statusUpdatedAt: state.statusUpdatedAt || "", revision: Number(state.revision || 0), archivePending: Boolean(state.archivePending), archiveError: state.archiveError || "", archivedAt: state.archivedAt || "" } : { ...group, status: "new", revision: 1, resolvedAt: "" };
  }).filter(function(group) { return group.status !== "resolved" || group.archivePending || !group.archivedAt; });
}

function workflowReadQueue_(domain, project, actor) {
  const readContext = { project: project, actor: actor, projectRevisions: [], projectSnapshot: undefined };
  const items = workflowAssignedRegistry_(domain, readContext);
  return { items: items, projectRevisions: readContext.projectRevisions, projectSnapshot: readContext.projectSnapshot };
}

function workflowAssignedRegistry_(domain, readContext) {
  const index = workflowReadSnapshot_(WORKFLOW_PROJECT_INDEX, true) || [];
  const migrated = new Set();
  let result = [];
  index.forEach(function(details) {
    const state = workflowReadProject_(details, true);
    if (!state) return;
    migrated.add(details.year + ":" + details.month + ":" + details.projectId);
    const deleted = state.customerDeleted || isCustomerDriveRecordDeleted_(details);
    if (readContext && readContext.actor) {
      const scope = { year: Number(details.year), month: Number(details.month), projectId: String(details.projectId), revision: state.revision };
      readContext.projectRevisions.push(scope);
      const requested = readContext.project;
      if (domain === "notes" && requested && Number(requested.year) === scope.year && Number(requested.month) === scope.month && String(requested.projectId) === scope.projectId) {
        readContext.projectSnapshot = deleted ? { ...scope, notes: [], deletedIds: state.deletedIds || [], deleted: true, legacyImportPending: false, legacyImportError: "" } : workflowSnapshot_(state, scope, readContext.actor);
      }
    }
    if (deleted) return;
    result = result.concat(workflowProjectItems_(state, domain).filter(function(item) { return !item.actualDate && (domain === "notes" || item.publishedAt); }).map(function(item) { return { ...item, ...state.details, collectionRevision: state.revision }; }));
  });
  const legacy = domain === "notes" ? readActiveWorkNotes_() : readActiveDesignTasks_();
  return result.concat(legacy.filter(function(item) { return !migrated.has(Number(item.year) + ":" + Number(item.month) + ":" + item.projectId) && !isCustomerDriveRecordDeleted_(item); }));
}

function activeDesignTasksFile_() {
  const root = rootFolder_();
  const file = findFileByName_(root, ACTIVE_DESIGN_TASKS_FILE_NAME);
  return file || root.createFile(ACTIVE_DESIGN_TASKS_FILE_NAME, "[]", MimeType.PLAIN_TEXT);
}

function readActiveDesignTasks_() {
  const shared = readPropertyJson_(WORKFLOW_DESIGN_REGISTRY);
  if (Array.isArray(shared)) return shared;
  try {
    const file = findFileByName_(rootFolder_(), ACTIVE_DESIGN_TASKS_FILE_NAME);
    if (!file) return [];
    const value = JSON.parse(file.getBlob().getDataAsString() || "[]");
    return Array.isArray(value) ? value : [];
  } catch (error) { return []; }
}

function saveActiveDesignTasks_(records) {
  writePropertyJson_(WORKFLOW_DESIGN_REGISTRY, records);
}

function normalizeDesignTaskRows_(rows) {
  return (Array.isArray(rows) ? rows : []).slice(0, 300).map(function(row, index) {
    return {
      id: workNoteText_(row && row.id, 140) || "design-task-" + index + "-" + new Date().getTime(),
      isCustom: Boolean(row && row.isCustom),
      content: workNoteText_(row && row.content, 800),
      plannedDate: normalizeWorkNoteDate_(row && row.plannedDate),
      actualDate: normalizeWorkNoteDate_(row && row.actualDate),
      assignee: workNoteText_(row && row.assignee, 160),
      assigneeEmail: workNoteText_(row && row.assigneeEmail, 240).toLowerCase(),
      acceptedAt: workNoteText_(row && row.acceptedAt, 40),
      acceptedBy: workNoteText_(row && row.acceptedBy, 240).toLowerCase(),
      publishedAt: workNoteText_(row && row.publishedAt, 40),
      note: workNoteText_(row && row.note, 4000),
    };
  });
}

function syncDesignTasks_(payload) {
  requireCustomerWorkflowManager_(payload);
  const details = workNotesPayload_(payload);
  if (workflowReadProject_(details)) throw workflowError_("UPDATE_REQUIRED", "Thiết kế đã chuyển sang cơ chế giao việc mới. Hãy cập nhật ứng dụng.");
  if (isCustomerDriveRecordDeleted_(details)) throw new Error("Hồ sơ đã được xóa trên Drive. Không thể đồng bộ thiết kế vào hồ sơ đã xóa.");
  const kind = workNoteText_(payload.kind, 40);
  if (DESIGN_TASK_KINDS.indexOf(kind) < 0) throw new Error("Loại tiến độ thiết kế không hợp lệ.");
  const title = workNoteText_(payload.title, 160) || "Tiến độ thiết kế";
  const rows = normalizeDesignTaskRows_(payload.rows);
  const previous = readActiveDesignTasks_().filter(function(item) {
    return !(Number(item.year) === details.year && Number(item.month) === details.month && String(item.projectId) === details.projectId && String(item.kind) === kind);
  });
  const active = rows.filter(function(row) { return row.content && row.publishedAt && row.assigneeEmail && !row.actualDate; }).map(function(row) {
    return {
      ...row,
      kind: kind,
      title: title,
      year: details.year,
      month: details.month,
      projectId: details.projectId,
      customerName: workNoteText_(payload.customerName, 240),
      houseId: workNoteText_(payload.houseId, 120),
      updatedAt: new Date().toISOString(),
    };
  });
  saveActiveDesignTasks_(previous.concat(active));
  return { ok: true, savedCount: active.length };
}

function loadAssignedDesignTasks_(payload) {
  const actor = payload.workflowSessionToken || payload.adminSessionToken ? workflowActor_(payload) : null;
  if (actor) workflowMayUse_(actor, "Thiết kế");
  const email = actor ? actor.account : workNoteText_(payload.email, 240).toLowerCase();
  if (!email) throw new Error("Thiếu email nhân viên.");
  const queue = workflowReadQueue_("design", undefined, actor);
  const metadata = { ok: true, projectRevisions: actor ? queue.projectRevisions : [] };
  const tasks = queue.items.filter(function(task) { return !task.actualDate && (actor || task.collectionRevision === undefined); });
  if (actor && actor.manager || email === WORK_NOTES_ADMIN_ACCOUNT) return { ...metadata, tasks: tasks };
  const member = actor ? actor.member : employeeRosterMember_(email);
  if (personnelIsManager_(member)) return { ...metadata, tasks: tasks };
  return { ...metadata, tasks: tasks.filter(function(task) { return assignmentMatchesEmployee_(task.assigneeEmail, email, member); }) };
}

const DOCUMENTS_FOLDER_NAME = "Tài liệu";
const DOCUMENT_MANIFEST_NAME = "_gmcrm_tai_lieu.json";
const DOCUMENT_WORK_OPTIONS = ["Chưa gắn", "Tư vấn", "Thiết kế", "Dự toán", "Thi công", "Nghiệm thu", "Bảo hành"];
const DOCUMENT_SNAPSHOT_UNLOCK_CODE = "mgarchi";
const DOCUMENT_HIDDEN_FILE_PATTERN = /(?:\.(?:bak|dwl2?|sv\$|ac\$|tmp|lck|lock)|^~\$)/i;

function isHiddenDocumentFile_(fileName) {
  return DOCUMENT_HIDDEN_FILE_PATTERN.test(String(fileName || "").trim());
}

function documentSnapshotName_(projectId, date) {
  const value = date || Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd-MM-yyyy");
  return value + "-" + projectId;
}

function documentSnapshotDate_(name) {
  const match = String(name || "").match(/^(\d{2})-(\d{2})-(\d{4})-/);
  return match ? match[1] + "/" + match[2] + "/" + match[3] : "";
}

function listDocumentSnapshots_(documentsFolder, projectId) {
  const snapshots = [];
  const folders = documentsFolder.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    const name = folder.getName();
    // The folder itself already scopes snapshots to one house. Accept both
    // legacy ...-GM... names and new ...-<mã nhà> names during migration.
    if (!documentSnapshotDate_(name)) continue;
    snapshots.push({ folder: folder, id: folder.getId(), name: name, date: documentSnapshotDate_(name) });
  }
  snapshots.sort(function(a, b) {
    const parse = function(item) { const parts = item.date.split("/"); return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0])).getTime(); };
    return parse(b) - parse(a) || b.name.localeCompare(a.name);
  });
  return snapshots;
}

function readDocumentManifest_(documentsFolder, manifestFileId) {
  const file = manifestFileId === undefined ? findFileByName_(documentsFolder, DOCUMENT_MANIFEST_NAME) : manifestFileId ? DriveApp.getFileById(manifestFileId) : null;
  if (!file) return { files: {}, snapshots: {} };
  try {
    const manifest = JSON.parse(file.getBlob().getDataAsString("UTF-8") || "{}");
    return manifest && manifest.files ? { files: manifest.files, snapshots: manifest.snapshots || {} } : { files: {}, snapshots: {} };
  } catch (error) {
    return { files: {}, snapshots: {} };
  }
}

function writeDocumentManifest_(documentsFolder, manifest) {
  trashFilesByName_(documentsFolder, DOCUMENT_MANIFEST_NAME);
  documentsFolder.createFile(DOCUMENT_MANIFEST_NAME, JSON.stringify({ files: manifest.files || {}, snapshots: manifest.snapshots || {} }), MimeType.PLAIN_TEXT);
}

function normalizeDocumentMeta_(meta, file, defaultWork) {
  const raw = meta || {};
  const assigned = raw.assigned === true;
  return {
    work: assigned && DOCUMENT_WORK_OPTIONS.indexOf(raw.work) >= 0 ? raw.work : (defaultWork || "Chưa gắn"),
    documentKey: String(raw.documentKey || file.getId()),
    sourceId: String(raw.sourceId || file.getId()),
    assigned: assigned,
  };
}

// The CRM workbooks are part of the core project record, so they do not need
// manual classification before appearing in the document register.  A manual
// choice stored in the manifest still takes precedence over this default.
function preferredDocumentMeta_(workflow, file) {
  const name = String(file.getName() || "").toLowerCase();
  if (name.indexOf("phiếu thông tin khách hàng") === 0) {
    return { work: "Tư vấn", assigned: true };
  }
  if (name.indexOf("tiến độ thiết kế kiến trúc") === 0 || name.indexOf("tiến độ thiết kế nội thất") === 0) {
    return { work: "Thiết kế", assigned: true };
  }
  if (name.indexOf("phiếu thông tin bảo hành") === 0) {
    return { work: "Bảo hành", assigned: true };
  }
  return null;
}

function findDocumentMetaByKey_(manifest, documentKey) {
  const entries = Object.keys(manifest.files || {});
  for (let index = 0; index < entries.length; index += 1) {
    const value = manifest.files[entries[index]];
    if (value && String(value.documentKey || "") === String(documentKey)) return value;
  }
  return null;
}

function documentsFolderForProject_(year, month, projectId, createMissing) {
  const customerFolder = getCustomerFolder_(year, month, projectId, createMissing);
  return documentsFolderForCustomerFolder_(customerFolder, createMissing);
}

function documentsFolderForPayload_(payload, createMissing) {
  // Keep the original helper as the compatibility seam for older clients and
  // unit tests that only provide the internal project id. New clients send a
  // houseId and use the house-code aware lookup below.
  if (!String(payload && payload.houseId || "").trim()) return documentsFolderForProject_(Number(payload.year), Number(payload.month), String(payload.projectId || "").trim(), createMissing);
  return documentsFolderForCustomerFolder_(customerFolderForPayload_(payload, createMissing), createMissing);
}

function documentsFolderForCustomerFolder_(customerFolder, createMissing) {
  if (!customerFolder) return null;
  let documentsFolder = findFolder_(customerFolder, DOCUMENTS_FOLDER_NAME);
  if (documentsFolder) return documentsFolder;
  const warrantyFolder = findFolder_(customerFolder, "Bảo hành");
  const legacyFolder = warrantyFolder ? findFolder_(warrantyFolder, DOCUMENTS_FOLDER_NAME) : null;
  if (legacyFolder && createMissing) {
    legacyFolder.moveTo(customerFolder);
    return legacyFolder;
  }
  return createMissing ? getOrCreateFolder_(customerFolder, DOCUMENTS_FOLDER_NAME) : null;
}

const THREE_D_FOLDER_NAME = "3D";
const THREE_D_CATEGORIES = [
  { key: "architecture", name: "Kiến trúc" },
  { key: "interior", name: "Nội thất" },
];

function ensureThreeDFolders_(customerFolder) {
  let root = findFolder_(customerFolder, THREE_D_FOLDER_NAME);
  if (!root) {
    const documentsFolder = findFolder_(customerFolder, DOCUMENTS_FOLDER_NAME);
    const legacyRoot = documentsFolder ? findFolder_(documentsFolder, THREE_D_FOLDER_NAME) : null;
    if (legacyRoot) {
      legacyRoot.moveTo(customerFolder);
      root = legacyRoot;
    } else {
      root = getOrCreateFolder_(customerFolder, THREE_D_FOLDER_NAME);
    }
  }
  return {
    root: root,
    folders: THREE_D_CATEGORIES.map(function(category) {
      return { key: category.key, name: category.name, folder: getOrCreateFolder_(root, category.name) };
    }),
  };
}

function threeDFoldersForProject_(year, month, projectId, createMissing) {
  const customerFolder = getCustomerFolder_(year, month, projectId, createMissing);
  return threeDFoldersForCustomerFolder_(customerFolder, createMissing);
}

function threeDFoldersForPayload_(payload, createMissing) {
  if (!String(payload && payload.houseId || "").trim()) return threeDFoldersForProject_(Number(payload.year), Number(payload.month), String(payload.projectId || "").trim(), createMissing);
  return threeDFoldersForCustomerFolder_(customerFolderForPayload_(payload, createMissing), createMissing);
}

function threeDFoldersForCustomerFolder_(customerFolder, createMissing) {
  if (!customerFolder) return null;
  if (createMissing) return ensureThreeDFolders_(customerFolder);
  let root = findFolder_(customerFolder, THREE_D_FOLDER_NAME);
  if (!root) {
    const documentsFolder = findFolder_(customerFolder, DOCUMENTS_FOLDER_NAME);
    root = documentsFolder ? findFolder_(documentsFolder, THREE_D_FOLDER_NAME) : null;
  }
  if (!root) return null;
  const folders = THREE_D_CATEGORIES.map(function(category) {
    const folder = createMissing ? getOrCreateFolder_(root, category.name) : findFolder_(root, category.name);
    return { key: category.key, name: category.name, folder: folder };
  });
  return { root: root, folders: folders };
}

function documentCachePrefix_(year, month, projectId) {
  return "gmcrm-documents-" + year + "-" + month + "-" + projectId;
}

function clearDocumentCache_(year, month, projectId) {
  CacheService.getScriptCache().remove(driveScopedCacheKey_(documentCachePrefix_(year, month, projectId) + "-latest"));
}

function archiveDocumentFile_(customerFolder, sourceFile, work, replaceExisting) {
  const projectId = customerFolder.getName();
  const documentsFolder = getOrCreateFolder_(customerFolder, DOCUMENTS_FOLDER_NAME);
  let snapshots = listDocumentSnapshots_(documentsFolder, projectId);
  if (!snapshots.length) {
    documentsFolder.createFolder(documentSnapshotName_(projectId));
    snapshots = listDocumentSnapshots_(documentsFolder, projectId);
  }
  const target = snapshots[0].folder;
  const manifest = readDocumentManifest_(documentsFolder);
  const documentKey = "system:" + work + ":" + sourceFile.getName();
  const existingMeta = findDocumentMetaByKey_(manifest, documentKey);
  const normalized = normalizeDocumentMeta_(existingMeta, sourceFile, work);
  normalized.documentKey = documentKey;

  const currentFiles = target.getFiles();
  while (currentFiles.hasNext()) {
    const candidate = currentFiles.next();
    const candidateMeta = normalizeDocumentMeta_(manifest.files[candidate.getId()], candidate, work);
    if (candidateMeta.documentKey === documentKey || candidate.getName() === sourceFile.getName()) {
      if (replaceExisting === false) {
        manifest.files[candidate.getId()] = normalized;
        writeDocumentManifest_(documentsFolder, manifest);
        return candidate;
      }
      delete manifest.files[candidate.getId()];
      candidate.setTrashed(true);
    }
  }
  const archived = sourceFile.makeCopy(sourceFile.getName(), target);
  manifest.files[archived.getId()] = normalized;
  writeDocumentManifest_(documentsFolder, manifest);
  return archived;
}

function seedExistingDocuments_(year, month, projectId) {
  const seedKey = driveScopedCacheKey_(documentCachePrefix_(year, month, projectId) + "-seed");
  if (CacheService.getScriptCache().get(seedKey)) return;
  const customerFolder = getCustomerFolder_(year, month, projectId, false);
  if (!customerFolder) return;
  DOCUMENT_WORK_OPTIONS.forEach(function(work) {
    const workflowFolder = findFolder_(customerFolder, work);
    if (!workflowFolder) return;
    const files = workflowFolder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (isHiddenDocumentFile_(file.getName())) continue;
      if (isSpreadsheetFile_(file.getName(), file.getMimeType())) continue;
      // Existing files are copied once into the latest daily folder, then the
      // user can decide whether they are continuous or daily documents.
      archiveDocumentFile_(customerFolder, file, work, false);
    }
  });
  CacheService.getScriptCache().put(seedKey, "1", 120);
}

function documentFileOutput_(file, meta) {
  const updated = file.getLastUpdated();
  return {
    id: file.getId(),
    name: file.getName(),
    downloadUrl: "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(file.getId()),
    viewUrl: driveFileViewUrl_(file.getId()),
    updatedAt: Utilities.formatDate(updated, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"),
    mimeType: file.getMimeType(),
    work: meta.work,
  };
}

function projectSourceFiles_(customerFolder) {
  const sources = {};
  DOCUMENT_WORK_OPTIONS.filter(function(work) { return work !== "Chưa gắn"; }).forEach(function(work) {
    const folder = findFolder_(customerFolder, work);
    if (!folder) return;
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      if (isHiddenDocumentFile_(file.getName())) continue;
      if (isSpreadsheetFile_(file.getName(), file.getMimeType())) continue;
      const documentKey = "system:" + work + ":" + file.getName();
      sources[documentKey] = { file: file, workflow: work };
    }
  });
  return sources;
}

function documentListingIndex_(documentsFolder, projectId) {
  try {
    // Enumerate only metadata once for the index. DriveApp otherwise needs
    // several remote property calls for every historical daily folder.
    const children = listDriveChildrenMetadata_(documentsFolder.getId());
    const snapshots = children.filter(function(item) {
      return item.mimeType === "application/vnd.google-apps.folder" && !!documentSnapshotDate_(item.name);
    }).map(function(item) { return { id: item.id, name: item.name, date: documentSnapshotDate_(item.name) }; });
    snapshots.sort(function(a, b) {
      const order = function(item) { const parts = item.date.split("/"); return parts[2] + parts[1] + parts[0]; };
      return order(b).localeCompare(order(a)) || b.name.localeCompare(a.name);
    });
    const manifestFile = children.find(function(item) { return item.name === DOCUMENT_MANIFEST_NAME && item.mimeType !== "application/vnd.google-apps.folder"; });
    return { snapshots: snapshots, manifest: readDocumentManifest_(documentsFolder, manifestFile ? manifestFile.id : "") };
  } catch (error) {
    // Keep older deployments working when the REST Drive scope is missing.
    return { snapshots: listDocumentSnapshots_(documentsFolder, projectId), manifest: readDocumentManifest_(documentsFolder) };
  }
}

function listDocuments_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  const folderKey = customerFolderKey_(payload);
  if (!year || month < 1 || month > 12 || !projectId) throw new Error("Thiếu thông tin Tài liệu.");
  // Listing must stay read-only. A new day is created only by the explicit
  // "Bản ngày mới" command, never when the user merely opens or switches days.
  const documentsFolder = documentsFolderForPayload_(payload, false);
  const metadataOnly = payload.metadataOnly === true;
  if (!documentsFolder) return { ok: true, snapshots: [], activeSnapshotId: "", latestSnapshotId: "", files: [], metadataOnly: metadataOnly };
  const index = documentListingIndex_(documentsFolder, folderKey);
  const snapshots = index.snapshots;
  const requestedId = payload.latest === true ? "" : String(payload.snapshotId || "");
  const snapshotIndex = Math.max(0, snapshots.findIndex(function(snapshot) { return snapshot.id === requestedId; }));
  const target = snapshots[snapshotIndex];
  const manifest = index.manifest;
  const files = [];
  if (target && !metadataOnly) {
    try {
      // Read children directly every time. A parent folder's modifiedTime
      // does not reliably change when a desktop upload changes its children.
      listDriveChildrenMetadata_(target.id).forEach(function(item) {
        if (item.mimeType === "application/vnd.google-apps.folder") return;
        if (isHiddenDocumentFile_(item.name)) return;
        if (isSpreadsheetFile_(item.name, item.mimeType)) return;
        const modified = item.modifiedTime ? new Date(item.modifiedTime) : new Date(0);
        const meta = normalizeDocumentMeta_(manifest.files[item.id], { getId: function() { return item.id; } }, "Chưa gắn");
        files.push({
          id: item.id,
          name: item.name,
          downloadUrl: item.webContentLink || "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(item.id),
          viewUrl: item.webViewLink || driveFileViewUrl_(item.id),
          updatedAt: Utilities.formatDate(modified, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"),
          mimeType: item.mimeType,
          work: meta.work,
          updatedAtMillis: modified.getTime(),
        });
      });
    } catch (error) {
      const iterator = (target.folder || DriveApp.getFolderById(target.id)).getFiles();
      while (iterator.hasNext()) {
        const file = iterator.next();
        if (isHiddenDocumentFile_(file.getName())) continue;
        if (isSpreadsheetFile_(file.getName(), file.getMimeType())) continue;
        const modified = file.getLastUpdated();
        const meta = normalizeDocumentMeta_(manifest.files[file.getId()], file, "Chưa gắn");
        files.push({ id: file.getId(), name: file.getName(), downloadUrl: "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(file.getId()), viewUrl: driveFileViewUrl_(file.getId()), updatedAt: Utilities.formatDate(modified, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"), mimeType: file.getMimeType(), work: meta.work, updatedAtMillis: modified.getTime() });
      }
    }
  }
  files.sort(function(a, b) { return b.updatedAtMillis - a.updatedAtMillis || a.name.localeCompare(b.name); });
  return { ok: true, snapshots: snapshots.map(function(snapshot) { return { id: snapshot.id, name: snapshot.name, date: snapshot.date, locked: !!((manifest.snapshots || {})[snapshot.id] || {}).locked }; }), activeSnapshotId: target ? target.id : "", latestSnapshotId: snapshots.length ? snapshots[0].id : "", files: files, metadataOnly: metadataOnly };
}

function listThreeDFolderFiles_(folder) {
  if (!folder) return [];
  const files = [];
  try {
    listDriveChildrenMetadata_(folder.getId()).forEach(function(item) {
      if (item.mimeType === "application/vnd.google-apps.folder" || isHiddenDocumentFile_(item.name)) return;
      if (isSpreadsheetFile_(item.name, item.mimeType)) return;
      const modified = item.modifiedTime ? new Date(item.modifiedTime) : new Date(0);
      files.push({
        id: item.id,
        name: item.name,
        downloadUrl: item.webContentLink || "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(item.id),
        viewUrl: item.webViewLink || driveFileViewUrl_(item.id),
        updatedAt: Utilities.formatDate(modified, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"),
        mimeType: item.mimeType,
        updatedAtMillis: modified.getTime(),
      });
    });
  } catch (error) {
    const iterator = folder.getFiles();
    while (iterator.hasNext()) {
      const file = iterator.next();
      if (isHiddenDocumentFile_(file.getName())) continue;
      if (isSpreadsheetFile_(file.getName(), file.getMimeType())) continue;
      const modified = file.getLastUpdated();
      files.push({ id: file.getId(), name: file.getName(), downloadUrl: "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(file.getId()), viewUrl: driveFileViewUrl_(file.getId()), updatedAt: Utilities.formatDate(modified, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"), mimeType: file.getMimeType(), updatedAtMillis: modified.getTime() });
    }
  }
  files.sort(function(a, b) { return b.updatedAtMillis - a.updatedAtMillis || a.name.localeCompare(b.name); });
  return files.map(function(file) { return { id: file.id, name: file.name, downloadUrl: file.downloadUrl, viewUrl: file.viewUrl, updatedAt: file.updatedAt, mimeType: file.mimeType }; });
}

function list3DFiles_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  if (!year || month < 1 || month > 12 || !projectId) throw new Error("Thiếu thông tin thư mục 3D.");
  // Opening/refreshing a library is read-only and must not wait for the global
  // mutation/export lock or create missing folders as a side effect.
  const structure = threeDFoldersForPayload_(payload, false);
  if (!structure) return { ok: true, rootUrl: "", folders: THREE_D_CATEGORIES.map(function(item) { return { key: item.key, name: item.name, folderUrl: "", files: [] }; }) };
  return {
    ok: true,
    rootUrl: structure.root.getUrl(),
    folders: structure.folders.map(function(item) {
      return { key: item.key, name: item.name, folderUrl: item.folder ? item.folder.getUrl() : "", files: listThreeDFolderFiles_(item.folder) };
    }),
  };
}

function copyNearestDocumentSnapshotFiles_(documentsFolder, sourceSnapshot, targetFolder, manifest) {
  if (!sourceSnapshot) return [];
  const copies = [];
  const sourceFiles = sourceSnapshot.folder.getFiles();
  while (sourceFiles.hasNext()) {
    const sourceFile = sourceFiles.next();
    if (isHiddenDocumentFile_(sourceFile.getName())) continue;
    const sourceMeta = normalizeDocumentMeta_(manifest.files[sourceFile.getId()], sourceFile, "Chưa gắn");
    const copiedFile = sourceFile.makeCopy(sourceFile.getName(), targetFolder);
    const copiedMeta = {
      // A new day always inherits the work assignment from the nearest prior day.
      work: sourceMeta.work,
      documentKey: "snapshot-copy:" + targetFolder.getId() + ":" + sourceFile.getId(),
      sourceId: sourceMeta.sourceId || sourceFile.getId(),
      assigned: sourceMeta.work !== "Chưa gắn",
    };
    manifest.files[copiedFile.getId()] = copiedMeta;
    copies.push(documentFileOutput_(copiedFile, copiedMeta));
  }
  return copies;
}

function createDocumentSnapshot_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  const folderKey = customerFolderKey_(payload);
  if (!year || month < 1 || month > 12 || !projectId) throw new Error("Thiếu thông tin Tài liệu.");
  const documentsFolder = documentsFolderForPayload_(payload, true);
  const todayName = documentSnapshotName_(folderKey);
  const snapshots = listDocumentSnapshots_(documentsFolder, folderKey);
  const sameDay = snapshots.filter(function(snapshot) { return snapshot.name === todayName; })[0];
  if (sameDay) return { ok: true, alreadyExists: true, snapshot: { id: sameDay.id, name: sameDay.name, date: sameDay.date, locked: !!((readDocumentManifest_(documentsFolder).snapshots || {})[sameDay.id] || {}).locked } };
  const targetFolder = documentsFolder.createFolder(todayName);
  const manifest = readDocumentManifest_(documentsFolder);
  const copiedFiles = copyNearestDocumentSnapshotFiles_(documentsFolder, snapshots[0], targetFolder, manifest);
  if (copiedFiles.length) writeDocumentManifest_(documentsFolder, manifest);
  clearDocumentCache_(year, month, projectId);
  return { ok: true, alreadyExists: false, copiedCount: copiedFiles.length, files: copiedFiles, snapshot: { id: targetFolder.getId(), name: todayName, date: documentSnapshotDate_(todayName), locked: false } };
}

function documentSnapshotForProject_(documentsFolder, projectId, snapshotId) {
  const snapshot = listDocumentSnapshots_(documentsFolder, projectId).filter(function(item) { return item.id === snapshotId; })[0];
  if (!snapshot) throw new Error("Không tìm thấy bản Tài liệu này.");
  return snapshot;
}

function setDocumentSnapshotLock_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  const folderKey = customerFolderKey_(payload);
  const snapshotId = String(payload.snapshotId || "").trim();
  const locked = payload.locked === true;
  if (!year || month < 1 || month > 12 || !projectId || !snapshotId) throw new Error("Thiếu thông tin bản Tài liệu.");
  const documentsFolder = documentsFolderForPayload_(payload, true);
  documentSnapshotForProject_(documentsFolder, folderKey, snapshotId);
  if (!locked && String(payload.passcode || "") !== DOCUMENT_SNAPSHOT_UNLOCK_CODE) throw new Error("Mã mở khóa không đúng.");
  const manifest = readDocumentManifest_(documentsFolder);
  manifest.snapshots = manifest.snapshots || {};
  manifest.snapshots[snapshotId] = { locked: locked };
  writeDocumentManifest_(documentsFolder, manifest);
  clearDocumentCache_(year, month, projectId);
  return { ok: true, locked: locked };
}

function deleteDocumentSnapshot_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  const folderKey = customerFolderKey_(payload);
  const snapshotId = String(payload.snapshotId || "").trim();
  if (!year || month < 1 || month > 12 || !projectId || !snapshotId) throw new Error("Thiếu thông tin bản Tài liệu.");
  const documentsFolder = documentsFolderForPayload_(payload, false);
  if (!documentsFolder) throw new Error("Không tìm thấy thư mục Tài liệu của hồ sơ này.");
  const snapshot = documentSnapshotForProject_(documentsFolder, folderKey, snapshotId);
  const manifest = readDocumentManifest_(documentsFolder);
  if (!!((manifest.snapshots || {})[snapshotId] || {}).locked) throw new Error("Bản ngày đang khóa. Hãy mở khóa trước khi xóa.");
  manifest.files = manifest.files || {};
  const copiedFiles = snapshot.folder.getFiles();
  while (copiedFiles.hasNext()) delete manifest.files[copiedFiles.next().getId()];
  manifest.snapshots = manifest.snapshots || {};
  delete manifest.snapshots[snapshotId];
  snapshot.folder.setTrashed(true);
  writeDocumentManifest_(documentsFolder, manifest);
  clearDocumentCache_(year, month, projectId);
  return { ok: true, deletedSnapshotId: snapshotId };
}

function updateDocumentMetadata_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  const folderKey = customerFolderKey_(payload);
  const fileId = String(payload.fileId || "").trim();
  const requestedSnapshotId = String(payload.snapshotId || "").trim();
  if (!year || month < 1 || month > 12 || !projectId || !fileId) throw new Error("Thiếu thông tin tệp Tài liệu.");
  const documentsFolder = documentsFolderForPayload_(payload, true);
  const manifest = readDocumentManifest_(documentsFolder);
  const file = DriveApp.getFileById(fileId);
  const snapshot = documentSnapshotForProject_(documentsFolder, folderKey, requestedSnapshotId);
  const existing = manifest.files[fileId] || {};
  const current = normalizeDocumentMeta_({ ...existing, documentKey: fileId, sourceId: fileId, assigned: true }, file, "Chưa gắn");
  current.assigned = true;
  if (DOCUMENT_WORK_OPTIONS.indexOf(String(payload.work || "")) >= 0) current.work = String(payload.work);
  const parents = file.getParents();
  let belongsToSnapshot = false;
  while (parents.hasNext()) if (parents.next().getId() === snapshot.id) belongsToSnapshot = true;
  if (!belongsToSnapshot) throw new Error("Tệp không thuộc bản ngày đang chọn.");
  manifest.files[fileId] = current;
  writeDocumentManifest_(documentsFolder, manifest);
  clearDocumentCache_(year, month, projectId);
  return { ok: true };
}

function personnelFolder_() {
  return getOrCreateFolder_(rootFolder_(), "Nhân lực");
}

const PERSONNEL_CACHE_PROPERTY_KEY = "gmcrm-personnel-state-v1";
function personnelRole_(value) {
  const key = String(value === null || value === undefined ? "" : value).normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
  if (key === "quản lý" || key === "quản lý chung") return "Quản lý chung";
  const roles = ["Nhân viên kỹ thuật", "Nhân viên văn phòng", "Marketing", "Giám sát", "Thợ xưởng", "Thợ công trình", "Kế toán", "Nhân viên thiết kế"];
  return roles.find(function(role) { return role.toLocaleLowerCase("vi") === key; }) || "";
}

function personnelIsManager_(member) {
  return Boolean(member && personnelRole_(member.role) === "Quản lý chung");
}
// Kept only for one-time migration of rosters created before the Drive root
// was changed. New reads/writes never depend on this folder.
const LEGACY_PERSONNEL_ROOT_FOLDER_ID = "1Z8Vj55v7LFgXEaCuusd25NC77RcQKmX4";

function savePersonnelCache_(personnel) {
  const value = personnel && typeof personnel === "object" && !Array.isArray(personnel) ? personnel : {};
  const normalized = {};
  Object.keys(value).forEach(function(category) {
    normalized[category] = (Array.isArray(value[category]) ? value[category] : []).map(function(member) {
      if (!member || typeof member !== "object" || Array.isArray(member)) return member;
      const result = Object.assign({}, member);
      if (Object.prototype.hasOwnProperty.call(member, "loginCode")) result.loginCode = employeeLoginCode_(member.loginCode);
      if (Object.prototype.hasOwnProperty.call(member, "role")) result.role = personnelRole_(member.role);
      return result;
    });
  });
  writePropertyJson_(PERSONNEL_CACHE_PROPERTY_KEY, normalized);
  return { ok: true, storage: "script-properties", savedAt: Date.now() };
}

function personnelFromWorkbook_(file) {
  const sheets = readXlsxSheets_(file);
  const rows = sheets["Nhân lực"] || sheets[Object.keys(sheets)[0]] || [];
  const personnel = {};
  const headers = (rows[0] || []).map(function(value) { return String(value || "").trim(); });
  const column = function(name, fallback) { const index = headers.indexOf(name); return index >= 0 ? index : fallback; };
  const categoryColumn = column("Nhóm ID", 0);
  const statusColumn = headers.indexOf("Hoạt động");
  const nameColumn = column("Họ và tên", 2);
  const birthDateColumn = column("Ngày sinh", 3);
  const phoneColumn = column("Số điện thoại", 4);
  const roleColumn = column("Chức vụ", 5);
  const addressColumn = column("Địa chỉ", 6);
  const idColumn = column("_ID", 7);
  const emailColumn = headers.indexOf("Email");
  const loginCodeColumn = headers.indexOf("Mã đăng nhập");
  const permissionsColumn = headers.indexOf("Quyền");
  rows.slice(1).forEach(function(row, index) {
    const category = String(row[categoryColumn] || "").trim();
    const name = String(row[nameColumn] || "").trim();
    if (!category || !name) return;
    if (!personnel[category]) personnel[category] = [];
    personnel[category].push({
      id: String(row[idColumn] || ("drive-person-" + category + "-" + index)),
      status: statusColumn >= 0 && ["Có", "Không", "Ngưng"].indexOf(String(row[statusColumn] || "")) >= 0 ? String(row[statusColumn]) : "Có",
      name: name,
      email: emailColumn >= 0 ? String(row[emailColumn] || "").trim().toLowerCase() : "",
      loginCode: loginCodeColumn >= 0 ? employeeLoginCode_(row[loginCodeColumn]) : "",
      birthDate: normalizeExcelDate_(row[birthDateColumn]),
      phone: normalizePersonnelPhone_(row[phoneColumn]),
      role: String(row[roleColumn] || ""),
      permissions: permissionsColumn >= 0 ? String(row[permissionsColumn] || "").split("|").map(function(value) { return value.trim(); }).filter(Boolean) : [],
      address: String(row[addressColumn] || ""),
    });
  });
  return personnel;
}

function loadPersonnel_() {
  // Personnel is a shared cache, not a Drive-backed record. This keeps all
  // devices in sync even when the configured Drive root changes or is read-only.
  const cached = readPropertyJson_(PERSONNEL_CACHE_PROPERTY_KEY);
  if (cached && typeof cached === "object" && !Array.isArray(cached)) {
    return { ok: true, personnel: cached, source: "script-properties" };
  }

  // One-time migration for installations that still have the old workbook.
  // A Drive permission error must not prevent the app from loading an empty
  // (and subsequently writable) personnel cache.
  try {
    let file = null;
    try {
      const folder = personnelFolder_();
      file = findFileByName_(folder, "Danh sách nhân lực.xlsx");
    } catch (error) {
      // Try the previous root below; a changed root may no longer be readable.
    }
    if (!file) {
      try {
        const legacyRoot = DriveApp.getFolderById(LEGACY_PERSONNEL_ROOT_FOLDER_ID);
        const legacyFolder = findFolder_(legacyRoot, "Nhân lực");
        file = findFileByName_(legacyFolder, "Danh sách nhân lực.xlsx");
      } catch (error) {
        // The old root is optional and may have been removed.
      }
    }
    if (!file) return { ok: true, personnel: {}, source: "empty" };
    const personnel = personnelFromWorkbook_(file);
    try { writePropertyJson_(PERSONNEL_CACHE_PROPERTY_KEY, personnel); } catch (error) { /* Migration cache is best effort. */ }
    return { ok: true, personnel: personnel, source: "drive-migrated" };
  } catch (error) {
    return { ok: true, personnel: {}, source: "empty", driveWarning: error && error.message ? error.message : "Không thể đọc danh sách nhân lực cũ." };
  }
}

function syncPersonnelWorkbook_(personnel) {
  const folder = personnelFolder_();
  const categoryLabels = {
    coordination: "Điều phối", management: "Ban quản lý", office: "Nhân viên văn phòng", site: "Nhân viên công trình",
    construction: "Nhân công xây dựng", workshop: "Nhân công xưởng", partner: "Đối tác",
  };
  const rows = [["Nhóm ID", "Nhóm", "Hoạt động", "Họ và tên", "Email", "Mã đăng nhập", "Ngày sinh", "Số điện thoại", "Chức vụ", "Quyền", "Địa chỉ", "_ID"]];
  Object.keys(personnel || {}).forEach(function(category) {
    const members = Array.isArray(personnel[category]) ? personnel[category] : [];
    members.forEach(function(member) {
      if (!member || !String(member.name || "").trim()) return;
      const status = ["Có", "Không", "Ngưng"].indexOf(String(member.status || "")) >= 0 ? String(member.status) : "Có";
      const email = String(member.email || "").trim().toLowerCase();
      const permissions = Array.isArray(member.permissions) ? member.permissions.map(function(value) { return String(value || "").trim(); }).filter(Boolean).join("|") : "";
      rows.push([category, categoryLabels[category] || category, status, String(member.name || ""), email, employeeLoginCode_(member.loginCode), String(member.birthDate || ""), normalizePersonnelPhone_(member.phone), String(member.role || ""), permissions, String(member.address || ""), String(member.id || "")]);
    });
  });
  const spreadsheet = SpreadsheetApp.create("GM-CRM nhân lực temporary");
  try {
    const sheet = spreadsheet.getSheets()[0];
    sheet.setName("Nhân lực");
    if (rows.length > 1) {
      // Apply text formatting before the values, so login codes such as
      // 00123 and phone numbers keep their leading zero in the exported XLSX.
      sheet.getRange(2, 6, rows.length - 1, 1).setNumberFormat("@");
      sheet.getRange(2, 8, rows.length - 1, 1).setNumberFormat("@");
    }
    sheet.getRange(1, 1, rows.length, 12).setValues(rows).setFontFamily("Roboto").setWrap(true).setVerticalAlignment("top");
    sheet.getRange(1, 1, 1, 12).setFontWeight("bold").setBackground("#eee9e2");
    sheet.setFrozenRows(1);
    [115, 180, 100, 180, 220, 140, 110, 135, 160, 260, 300, 130].forEach(function(width, index) { sheet.setColumnWidth(index + 1, width); });
    sheet.hideColumns(1, 2);
    sheet.hideColumns(12, 1);
    sheet.autoResizeRows(1, Math.max(1, sheet.getLastRow()));
    const fileName = "Danh sách nhân lực.xlsx";
    const xlsxBlob = exportXlsx_(spreadsheet.getId()).setName(fileName);
    const file = replaceWorkbookFile_(folder, fileName, xlsxBlob);
    return { ok: true, fileId: file.getId(), fileUrl: file.getUrl(), fileName: fileName };
  } finally {
    try { DriveApp.getFileById(spreadsheet.getId()).setTrashed(true); } catch (error) { /* Preserve the original export result. */ }
  }
}

function employeeAccountEmail_(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Hãy nhập email nhân viên hợp lệ.");
  return email;
}

function employeeRosterMember_(email) {
  const personnel = loadPersonnel_().personnel || {};
  const categories = Object.keys(personnel);
  for (let categoryIndex = 0; categoryIndex < categories.length; categoryIndex += 1) {
    const member = (personnel[categories[categoryIndex]] || []).find(function(item) {
      return personnelAssignmentKey_(item) === String(email || "").trim().toLowerCase() && String(item.status || "Có") === "Có";
    });
    if (member) return member;
  }
  return null;
}

function personnelAssignmentKey_(member) {
  if (!member) return "";
  const email = workNoteText_(member.email, 240).toLowerCase();
  if (email) return email;
  const id = workNoteText_(member.id, 160).toLowerCase();
  return id ? "member:" + id : "";
}

function assignmentMatchesEmployee_(assignmentKey, email, member) {
  const key = workNoteText_(assignmentKey, 240).toLowerCase();
  const account = workNoteText_(email, 240).toLowerCase();
  const memberId = member ? workNoteText_(member.id, 160).toLowerCase() : "";
  const legacyMemberKey = memberId ? "member:" + memberId : "";
  return Boolean(key && ((account && key === account) || (member && key === personnelAssignmentKey_(member)) || (legacyMemberKey && key === legacyMemberKey)));
}

function employeeAccountKey_(email) {
  return "gmcrm-employee-account-" + Utilities.base64EncodeWebSafe(email).replace(/=+$/g, "");
}

function employeeResetKey_(email) {
  return "gmcrm-employee-reset-" + Utilities.base64EncodeWebSafe(email).replace(/=+$/g, "");
}

function employeePasswordHash_(value, salt) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(salt) + "|" + String(value), Utilities.Charset.UTF_8).map(function(byte) {
    return ((byte + 256) % 256).toString(16).padStart(2, "0");
  }).join("");
}

function employeePassword_(value) {
  const password = String(value || "");
  if (password.length < 6) throw new Error("Mật khẩu cần tối thiểu 6 ký tự.");
  return password;
}

function readEmployeeAccount_(email) {
  const raw = PropertiesService.getScriptProperties().getProperty(employeeAccountKey_(email));
  try { return raw ? JSON.parse(raw) : null; } catch (error) { return null; }
}

function saveEmployeeAccount_(email, password) {
  const salt = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty(employeeAccountKey_(email), JSON.stringify({
    salt: salt,
    hash: employeePasswordHash_(password, salt),
    updatedAt: new Date().toISOString(),
  }));
}

function verifyEmployeeLogin_(payload) {
  if (employeeLoginName_(payload.name) === "admin") {
    if (employeeLoginCode_(payload.loginCode) !== "1") return { ok: true, valid: false };
    return { ok: true, valid: true, account: "admin", adminSessionToken: issueCustomerAdminSession_(), workflowSessionToken: issueWorkflowSession_("admin") };
  }
  // New clients authenticate directly against the roster. Keep the legacy
  // email/password path for older installed applications during rollout.
  if (Object.prototype.hasOwnProperty.call(payload, "name") || Object.prototype.hasOwnProperty.call(payload, "loginCode")) return verifyEmployeeCodeLogin_(payload);
  const email = employeeAccountEmail_(payload.email);
  const account = readEmployeeAccount_(email);
  if (!employeeRosterMember_(email) || !account || !account.salt || !account.hash) return { ok: true, valid: false };
  return { ok: true, valid: employeePasswordHash_(String(payload.password || ""), account.salt) === account.hash };
}

const CUSTOMER_ADMIN_SESSION_SECRET_KEY = "gmcrm-customer-admin-session-secret-v1";
const CUSTOMER_ADMIN_SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

function customerAdminSessionSecret_() {
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty(CUSTOMER_ADMIN_SESSION_SECRET_KEY);
  if (secret) return secret;
  // Login requests do not hold the write lock. Initialize the signing key
  // once so simultaneous first logins cannot invalidate one another.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    secret = properties.getProperty(CUSTOMER_ADMIN_SESSION_SECRET_KEY);
    if (!secret) {
      secret = Utilities.getUuid() + Utilities.getUuid();
      properties.setProperty(CUSTOMER_ADMIN_SESSION_SECRET_KEY, secret);
    }
    return secret;
  } finally {
    lock.releaseLock();
  }
}

function customerAdminSessionSignature_(body, secret) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(body, secret, Utilities.Charset.UTF_8)).replace(/=+$/g, "");
}

function issueCustomerAdminSession_() {
  const claims = { version: 1, account: "admin", purpose: "customer-admin", expiresAt: Date.now() + CUSTOMER_ADMIN_SESSION_LIFETIME_MS, nonce: Utilities.getUuid() };
  const body = Utilities.base64EncodeWebSafe(JSON.stringify(claims), Utilities.Charset.UTF_8).replace(/=+$/g, "");
  return body + "." + customerAdminSessionSignature_(body, customerAdminSessionSecret_());
}

function requireCustomerAdminSession_(payload) {
  const denied = "Chỉ admin mới có quyền tạo hoặc xóa khách hàng. Hãy đăng nhập lại bằng tài khoản admin.";
  const token = String(payload && payload.adminSessionToken || "");
  if (!token || token.length > 2048) throw new Error(denied);
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) throw new Error(denied);
    // Validation never initializes a key or writes anything. An unauthenticated
    // request must have no side effects, including on an idempotent retry.
    const secret = PropertiesService.getScriptProperties().getProperty(CUSTOMER_ADMIN_SESSION_SECRET_KEY);
    if (!secret) throw new Error(denied);
    const expected = customerAdminSessionSignature_(parts[0], secret);
    let difference = expected.length ^ parts[1].length;
    for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ (parts[1].charCodeAt(index) || 0);
    if (difference) throw new Error(denied);
    const claims = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString("UTF-8"));
    if (claims.version !== 1 || claims.account !== "admin" || claims.purpose !== "customer-admin" || !Number.isFinite(claims.expiresAt) || claims.expiresAt <= Date.now()) throw new Error(denied);
    return claims;
  } catch (error) {
    throw new Error(denied);
  }
}

function employeeLoginName_(value) {
  return String(value || "").normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");
}

function employeeLoginCode_(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function verifyEmployeeCodeLogin_(payload) {
  const name = employeeLoginName_(payload.name);
  const loginCode = employeeLoginCode_(payload.loginCode);
  if (!name || !loginCode || name.length > 240 || loginCode.length > 160) return { ok: true, valid: false };
  const personnel = loadPersonnel_().personnel || {};
  const matches = [];
  Object.keys(personnel).forEach(function(category) {
    (Array.isArray(personnel[category]) ? personnel[category] : []).forEach(function(member) {
      if (!member || String(member.status || "Có") !== "Có") return;
      if (employeeLoginName_(member.name) !== name || employeeLoginCode_(member.loginCode) !== loginCode) return;
      if (personnelAssignmentKey_(member)) matches.push(member);
    });
  });
  // Never choose the first row when the same name/code identifies two people.
  if (matches.length !== 1) return { ok: true, valid: false };
  const member = matches[0];
  return {
    ok: true,
    valid: true,
    account: personnelAssignmentKey_(member),
    workflowSessionToken: issueWorkflowSession_(personnelAssignmentKey_(member)),
    member: {
      id: String(member.id || ""),
      status: "Có",
      name: String(member.name || "").trim(),
      email: String(member.email || "").trim().toLowerCase(),
      birthDate: String(member.birthDate || ""),
      phone: normalizePersonnelPhone_(member.phone),
      role: personnelRole_(member.role),
      permissions: Array.isArray(member.permissions) ? member.permissions.map(function(value) { return String(value || ""); }) : [],
      address: String(member.address || ""),
    },
  };
}

function registerEmployeeAccount_(payload) {
  const email = employeeAccountEmail_(payload.email);
  if (!employeeRosterMember_(email)) throw new Error("Email này chưa có trong danh sách Nhân lực đang hoạt động.");
  if (readEmployeeAccount_(email)) throw new Error("Email này đã có tài khoản. Hãy đăng nhập hoặc chọn Quên mật khẩu.");
  saveEmployeeAccount_(email, employeePassword_(payload.password));
  return { ok: true };
}

function requestEmployeePasswordReset_(payload) {
  const email = employeeAccountEmail_(payload.email);
  const genericResult = { ok: true, message: "Nếu email có tài khoản, mã xác nhận đã được gửi." };
  if (!employeeRosterMember_(email) || !readEmployeeAccount_(email)) return genericResult;
  const properties = PropertiesService.getScriptProperties();
  const key = employeeResetKey_(email);
  let existing = null;
  try { existing = JSON.parse(properties.getProperty(key) || ""); } catch (error) { existing = null; }
  if (existing && Number(existing.sentAt || 0) > Date.now() - 60 * 1000) return genericResult;
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const salt = Utilities.getUuid();
  properties.setProperty(key, JSON.stringify({ salt: salt, hash: employeePasswordHash_(code, salt), sentAt: Date.now(), expiresAt: Date.now() + 15 * 60 * 1000 }));
  GmailApp.sendEmail(email, "Mã đặt lại mật khẩu GM-CRM", "Mã xác nhận của bạn là: " + code + "\n\nMã có hiệu lực trong 15 phút. Không chia sẻ mã này cho người khác.");
  return genericResult;
}

function resetEmployeePassword_(payload) {
  const email = employeeAccountEmail_(payload.email);
  const code = String(payload.code || "").replace(/\D/g, "");
  const properties = PropertiesService.getScriptProperties();
  const key = employeeResetKey_(email);
  let reset = null;
  try { reset = JSON.parse(properties.getProperty(key) || ""); } catch (error) { reset = null; }
  if (!reset || !reset.salt || !reset.hash || Number(reset.expiresAt || 0) < Date.now() || employeePasswordHash_(code, reset.salt) !== reset.hash) throw new Error("Mã xác nhận không đúng hoặc đã hết hạn.");
  if (!employeeRosterMember_(email)) throw new Error("Email này không còn là nhân viên hoạt động.");
  saveEmployeeAccount_(email, employeePassword_(payload.password));
  properties.deleteProperty(key);
  return { ok: true };
}

function normalizePersonnelPhone_(value) {
  let raw = String(value === null || value === undefined ? "" : value).trim();
  if (!raw) return "";
  const scientific = raw.replace(/\s/g, "");
  if (/^\d+(?:\.\d+)?e\+?\d+$/i.test(scientific)) raw = String(Math.round(Number(scientific)));
  if (/^\d+\.0+$/.test(raw)) raw = raw.replace(/\.0+$/, "");
  raw = raw.replace(/[\s.-]/g, "");
  if (/^\d{9}$/.test(raw) && /^[2-9]/.test(raw)) raw = "0" + raw;
  return raw;
}

function isSpecialWorkflowWorkbook_(name) {
  const normalized = String(name || "").toLowerCase();
  return [
    "Phi\u1ebfu th\u00f4ng tin kh\u00e1ch h\u00e0ng",
    "Ti\u1ebfn \u0111\u1ed9 thi\u1ebft k\u1ebf ki\u1ebfn tr\u00fac",
    "Ti\u1ebfn \u0111\u1ed9 thi\u1ebft k\u1ebf n\u1ed9i th\u1ea5t",
    "Phi\u1ebfu th\u00f4ng tin b\u1ea3o h\u00e0nh",
  ].some(function(prefix) { return normalized.indexOf(prefix.toLowerCase()) === 0; });
}

function isSpreadsheetFile_(name, mimeType) {
  const normalizedMime = String(mimeType || "").toLowerCase();
  return normalizedMime.indexOf("spreadsheet") >= 0
    || normalizedMime === "application/vnd.ms-excel"
    || normalizedMime === "text/csv"
    || /\.(?:xlsx?|xlsm|csv)$/i.test(String(name || ""));
}

function getCustomerFolder_(year, month, projectId, createMissing, createInitialDocumentSnapshot) {
  if (createMissing && isCustomerDriveRecordDeleted_({ year: year, month: month, projectId: projectId })) throw new Error("Hồ sơ đã được xóa trên Drive.");
  const folderCacheKey = "gmcrm-customer-folder-" + year + "-" + month + "-" + projectId;
  const cachedFolder = getCachedFolder_(folderCacheKey);
  if (cachedFolder) {
    if (createMissing) ensureProjectFolders_(cachedFolder);
    return cachedFolder;
  }
  const root = rootFolder_();
  // Exports, uploads and archives may initialize a customer's subfolders, but
  // must never create another customer implicitly. Only the authenticated
  // createCustomerFolder_ action establishes the customer hierarchy.
  const customers = findFolder_(root, CUSTOMERS_FOLDER_NAME);
  const yearFolder = customers && findFolder_(customers, String(year));
  const monthFolder = yearFolder && findFolder_(yearFolder, "T" + month);
  const customerFolder = monthFolder && findFolder_(monthFolder, projectId);
  if (!customerFolder && createMissing) throw new Error("Không tìm thấy hồ sơ khách hàng trên Drive. Chỉ admin mới có quyền tạo khách hàng.");
  if (customerFolder) cacheFolder_(folderCacheKey, customerFolder);
  if (customerFolder && createMissing) {
    const shouldCreateSnapshot = Boolean(createInitialDocumentSnapshot);
    ensureProjectFolders_(customerFolder, shouldCreateSnapshot);
  }
  return customerFolder || null;
}

function getCachedFolder_(key) {
  try {
    const folderId = CacheService.getScriptCache().get(driveScopedCacheKey_(key));
    return folderId ? DriveApp.getFolderById(folderId) : null;
  } catch (error) {
    CacheService.getScriptCache().remove(driveScopedCacheKey_(key));
    return null;
  }
}

function cacheFolder_(key, folder) {
  try {
    CacheService.getScriptCache().put(driveScopedCacheKey_(key), folder.getId(), 21600);
  } catch (error) {
    // Folder caching is an optimization only.
  }
}

function ensureProjectFolders_(customerFolder, createInitialDocumentSnapshot) {
  const consulting = getOrCreateFolder_(customerFolder, "T\u01b0 v\u1ea5n");
  ["Ghi chú", "Thi c\u00f4ng", "Thi\u1ebft k\u1ebf", "Nghi\u1ec7m thu", "B\u1ea3o h\u00e0nh", "D\u1ef1 to\u00e1n"].forEach(function(name) {
    getOrCreateFolder_(customerFolder, name);
  });
  const dataFolder = getOrCreateFolder_(consulting, "DataID");
  getOrCreateFolder_(dataFolder, "Ghi \u00e2m");
  let documentsFolder = findFolder_(customerFolder, DOCUMENTS_FOLDER_NAME);
  if (!documentsFolder) {
    const warrantyFolder = findFolder_(customerFolder, "B\u1ea3o h\u00e0nh");
    const legacyFolder = warrantyFolder ? findFolder_(warrantyFolder, DOCUMENTS_FOLDER_NAME) : null;
    if (legacyFolder) {
      legacyFolder.moveTo(customerFolder);
      documentsFolder = legacyFolder;
    } else {
      documentsFolder = getOrCreateFolder_(customerFolder, DOCUMENTS_FOLDER_NAME);
    }
  }
  if (createInitialDocumentSnapshot && !listDocumentSnapshots_(documentsFolder, customerFolder.getName()).length) documentsFolder.createFolder(documentSnapshotName_(customerFolder.getName()));
  ensureThreeDFolders_(customerFolder);
}

function getAudioFolder_(year, month, projectId, createMissing) {
  const customerFolder = getCustomerFolder_(year, month, projectId, createMissing);
  if (!customerFolder) return null;
  const consulting = createMissing ? getOrCreateFolder_(customerFolder, "T\u01b0 v\u1ea5n") : findFolder_(customerFolder, "T\u01b0 v\u1ea5n");
  if (!consulting) return null;
  const dataFolder = createMissing ? getOrCreateFolder_(consulting, "DataID") : findFolder_(consulting, "DataID");
  if (!dataFolder) return null;
  return createMissing ? getOrCreateFolder_(dataFolder, "Ghi \u00e2m") : findFolder_(dataFolder, "Ghi \u00e2m");
}

function getAudioFolderForPayload_(payload, createMissing) {
  const customerFolder = customerFolderForPayload_(payload, createMissing);
  if (!customerFolder) return null;
  const consulting = createMissing ? getOrCreateFolder_(customerFolder, "T\u01b0 v\u1ea5n") : findFolder_(customerFolder, "T\u01b0 v\u1ea5n");
  if (!consulting) return null;
  const dataFolder = createMissing ? getOrCreateFolder_(consulting, "DataID") : findFolder_(consulting, "DataID");
  if (!dataFolder) return null;
  return createMissing ? getOrCreateFolder_(dataFolder, "Ghi \u00e2m") : findFolder_(dataFolder, "Ghi \u00e2m");
}

function findFileByPrefix_(folder, prefix) {
  if (!folder) return null;
  const files = folder.getFiles();
  while (files.hasNext()) {
    const candidate = files.next();
    if (candidate.getName().indexOf(prefix) === 0) return candidate;
  }
  return null;
}

function normalizeDriveName_(value) {
  const raw = String(value || "").trim().replace(/\s+/g, " ");
  try {
    return raw.normalize("NFC").toLocaleLowerCase("vi");
  } catch (error) {
    return raw.toLowerCase();
  }
}

function findFolders_(parent, name) {
  const wanted = normalizeDriveName_(name);
  const matches = [];
  const folders = parent.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    if (normalizeDriveName_(folder.getName()) === wanted) matches.push(folder);
  }
  matches.sort(function(a, b) { return a.getDateCreated().getTime() - b.getDateCreated().getTime(); });
  return matches;
}

function mergeFolderInto_(target, duplicate) {
  const childFolders = duplicate.getFolders();
  while (childFolders.hasNext()) {
    const child = childFolders.next();
    const existing = findFolder_(target, child.getName());
    if (existing) {
      mergeFolderInto_(existing, child);
      child.setTrashed(true);
    } else {
      child.moveTo(target);
    }
  }
  const files = duplicate.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const existing = findFileByName_(target, file.getName());
    if (!existing) {
      file.moveTo(target);
    } else if (file.getLastUpdated().getTime() > existing.getLastUpdated().getTime()) {
      existing.setTrashed(true);
      file.moveTo(target);
    } else {
      file.setTrashed(true);
    }
  }
}

function findFolder_(parent, name) {
  const matches = findFolders_(parent, name);
  return matches.length ? matches[0] : null;
}

function findFileByName_(folder, name) {
  if (!folder) return null;
  const matches = folder.getFilesByName(name);
  return matches.hasNext() ? matches.next() : null;
}

function trashFilesByName_(folder, name) {
  const matches = folder.getFilesByName(name);
  while (matches.hasNext()) matches.next().setTrashed(true);
}

function trashFilesByPrefix_(folder, prefix) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getName().indexOf(prefix) === 0) file.setTrashed(true);
  }
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
