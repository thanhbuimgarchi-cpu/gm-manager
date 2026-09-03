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

const ROOT_FOLDER_ID = "1Z8Vj55v7LFgXEaCuusd25NC77RcQKmX4";
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

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents || "{}");
    if (payload.action === "redeploy-latest") return json_(redeployLatest(payload));
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
    if (payload.action === "list-documents") return json_(listDocuments_(payload));
    if (payload.action === "load-personnel") return json_(loadPersonnel_(payload));
    if (payload.action === "verify-employee-login") return json_(verifyEmployeeLogin_(payload));
    if (payload.action === "load-consulting") return json_(loadConsultingWorkspace_(payload));
    if (payload.action === "customer-portal-share") return json_(customerPortalShare_(payload));

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      if (payload.action === "create-workflow-date-folder") return json_(createWorkflowDateFolder_(payload));
      if (payload.action === "upload-workflow-file") return json_(uploadWorkflowFile_(payload));
      if (payload.action === "sync-personnel") return json_(syncPersonnelWorkbook_(payload.personnel || {}));
      if (payload.action === "register-employee-account") return json_(registerEmployeeAccount_(payload));
      if (payload.action === "request-password-reset") return json_(requestEmployeePasswordReset_(payload));
      if (payload.action === "reset-employee-password") return json_(resetEmployeePassword_(payload));
      if (payload.action === "sync-work-notes") return json_(syncWorkNotes_(payload));
      if (payload.action === "complete-work-note") return json_(completeWorkNote_(payload));
      if (payload.action === "save-pancake-config") return json_(savePancakeConfig_(payload));
      if (payload.action === "update-customer-message-status") return json_(updateCustomerMessageStatus_(payload));
      if (payload.action === "sync-design-tasks") return json_(syncDesignTasks_(payload));
    if (payload.action === "create-document-snapshot") return json_(createDocumentSnapshot_(payload));
    if (payload.action === "update-document-metadata") return json_(updateDocumentMetadata_(payload));
    if (payload.action === "set-document-snapshot-lock") return json_(setDocumentSnapshotLock_(payload));
    if (payload.action === "delete-document-snapshot") return json_(deleteDocumentSnapshot_(payload));
    if (payload.action === "list-3d-files") return json_(list3DFiles_(payload));
      if (!payload.record || !payload.year || !payload.month) throw new Error("Thi\u1ebfu d\u1eef li\u1ec7u h\u1ed3 s\u01a1.");

      if (payload.action === "sync-design-progress") {
        const designResult = exportDesignProgressWorkbook_(payload.record, Number(payload.year), Number(payload.month), payload.progressKind);
        return json_({ ok: true, ...designResult });
      }

      if (payload.action === "sync-warranty") {
        const warrantyResult = exportWarrantyWorkbook_(payload.record, Number(payload.year), Number(payload.month));
        return json_({ ok: true, ...warrantyResult });
      }

      const result = exportCustomerWorkbook_(payload.record, Number(payload.year), Number(payload.month));
      return json_({ ok: true, ...result });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return json_({ ok: false, error: error && error.message ? error.message : "Kh\u00f4ng th\u1ec3 xu\u1ea5t Excel." });
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
  if (!year || month < 1 || month > 12 || !projectId || chunkIndex < 0 || totalChunks < 1 || chunkIndex >= totalChunks) {
    throw new Error("Thi\u1ebfu th\u00f4ng tin th\u01b0 m\u1ee5c ghi \u00e2m.");
  }
  if (typeof audio.data !== "string" || !audio.data || typeof audio.mimeType !== "string" || !audio.mimeType) {
    throw new Error("Thi\u1ebfu d\u1eef li\u1ec7u \u0111o\u1ea1n ghi \u00e2m.");
  }

  const audioFolder = getAudioFolder_(year, month, projectId, true);
  const prefix = "Ghi \u00e2m " + projectId + " - ph\u1ea7n ";
  if (chunkIndex === 0) trashFilesByPrefix_(audioFolder, prefix);
  const extensionMatch = /\.([a-z0-9]{1,5})$/i.exec(String(audio.fileName || ""));
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : audio.mimeType === "audio/mpeg" ? "mp3" : "wav";
  const fileName = audioChunkBaseName_(projectId, chunkIndex, totalChunks) + "." + extension;
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
  const audioFolder = getAudioFolder_(year, month, projectId, false);
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
  if (!year || month < 1 || month > 12 || !projectId || chunkIndex < 0 || totalChunks < 1 || chunkIndex >= totalChunks) {
    throw new Error("Thi\u1ebfu th\u00f4ng tin \u0111o\u1ea1n ghi \u00e2m c\u1ea7n x\u1eed l\u00fd.");
  }
  const baseName = audioChunkBaseName_(projectId, chunkIndex, totalChunks) + ".";
  const audioFolder = getAudioFolder_(year, month, projectId, false);
  let audioFile = findFileByPrefix_(audioFolder, baseName);
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

function readCachedJson_(key) {
  try {
    const raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    return null;
  }
}

function cacheJson_(key, value, seconds) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), seconds);
  } catch (error) {
    // A large result simply bypasses the server cache; Drive loading still works.
  }
}

function loadConsultingWorkspace_(payload) {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
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

// A random token in the published link selects one read-only project snapshot.
function customerPortalShare_(payload) {
  const shareToken = normalizeCustomerShareToken_(payload.shareToken);
  if (!shareToken) throw new Error("Link xem dự án không hợp lệ.");
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
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
  const records = [];
  const customerFolders = monthFolder.getFolders();
  while (customerFolders.hasNext()) {
    const customerFolder = customerFolders.next();
    const projectId = customerFolder.getName();
    if (projectId.indexOf("-") === 0) continue;
    const record = fastCustomerIndexFromFolder_(projectId);
    if (record) records.push(record);
  }
  return monthResult_(year, month, records);
}

function fastCustomerIndexFromFolder_(projectId) {
  const dateMatch = /^GM(\d{2})(\d{2})(\d{4})/.exec(projectId);
  return {
    id: "drive-" + projectId,
    name: "",
    houseId: "",
    projectId: projectId,
    createdAt: dateMatch ? dateMatch[1] + "/" + dateMatch[2] + "/" + dateMatch[3] : "",
    details: {},
    isHydrated: false,
  };
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
  const customerFolder = monthFolder && findFolder_(monthFolder, projectId);
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
  const customerFolder = monthFolder && findFolder_(monthFolder, projectId);
  if (!customerFolder) throw new Error("Kh\u00f4ng t\u00ecm th\u1ea5y th\u01b0 m\u1ee5c h\u1ed3 s\u01a1 tr\u00ean Drive.");
  return {
    ok: true,
    year: year,
    month: month,
    record: {
      projectId: projectId,
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
  return workbook ? customerIndexFromWorkbook_(workbook, projectId) : null;
}

function customerIndexFromWorkbook_(file, projectId) {
  const sheets = readXlsxSheets_(file);
  const metadata = keyValueRows_(sheets["0. GM-CRM"] || []);
  const dateMatch = /^GM(\d{2})(\d{2})(\d{4})/.exec(projectId);
  return {
    id: "drive-" + projectId,
    name: metadata.name || projectId,
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
  return Object.keys(resultsByPeriod).map(function(key) { return resultsByPeriod[key]; }).sort(function(a, b) {
    return b.year - a.year || Number(b.months[0].label.slice(1)) - Number(a.months[0].label.slice(1));
  });
}

function searchExactProjectId_(customers, projectId) {
  // Drive resolves an exact folder name from its index. This keeps a pasted
  // project ID from triggering a month-by-month scan of every customer.
  if (!/^GM\d{8}[A-Za-z0-9-]*$/i.test(projectId)) return [];
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
    name: metadata.name || details.HVT || projectId,
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
  const customerFolder = getCustomerFolder_(year, month, record.projectId, true);
  const consultingFolder = getOrCreateFolder_(customerFolder, "T\u01b0 v\u1ea5n");
  const fileName = "Phi\u1ebfu th\u00f4ng tin kh\u00e1ch h\u00e0ng " + record.projectId + ".xlsx";

  const spreadsheet = SpreadsheetApp.create("GM-CRM temporary " + record.projectId);
  try {
    writeWorkbook_(spreadsheet, record);
    const xlsxBlob = exportXlsx_(spreadsheet.getId()).setName(fileName);
    const legacyWorkbook = findFileByName_(customerFolder, fileName);
    if (legacyWorkbook) legacyWorkbook.moveTo(consultingFolder);
    trashFilesByName_(consultingFolder, fileName);
    const xlsxFile = consultingFolder.createFile(xlsxBlob);
    return {
      fileId: xlsxFile.getId(),
      fileUrl: xlsxFile.getUrl(),
      folderUrl: consultingFolder.getUrl(),
      fileName: fileName,
    };
  } finally {
    DriveApp.getFileById(spreadsheet.getId()).setTrashed(true);
  }
}

function exportDesignProgressWorkbook_(record, year, month, progressKind) {
  const customerFolder = getCustomerFolder_(year, month, record.projectId, true);
  const designFolder = getOrCreateFolder_(customerFolder, "Thi\u1ebft k\u1ebf");
  const isInterior = progressKind === "interior";
  const isAcceptance = progressKind === "acceptance";
  const label = isInterior ? "n\u1ed9i th\u1ea5t" : isAcceptance ? "nghi\u1ec7m thu" : "ki\u1ebfn tr\u00fac";
  const fileName = "Ti\u1ebfn \u0111\u1ed9 thi\u1ebft k\u1ebf " + label + " " + record.projectId + ".xlsx";
  const spreadsheet = SpreadsheetApp.create("GM-CRM " + label + " design progress temporary " + record.projectId);
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
    trashFilesByName_(designFolder, fileName);
    const xlsxFile = designFolder.createFile(xlsxBlob);
    return { fileId: xlsxFile.getId(), fileUrl: xlsxFile.getUrl(), folderUrl: designFolder.getUrl(), fileName: fileName };
  } finally {
    DriveApp.getFileById(spreadsheet.getId()).setTrashed(true);
  }
}

function exportWarrantyWorkbook_(record, year, month) {
  const customerFolder = getCustomerFolder_(year, month, record.projectId, true);
  const warrantyFolder = getOrCreateFolder_(customerFolder, "B\u1ea3o h\u00e0nh");
  const fileName = "Phi\u1ebfu th\u00f4ng tin b\u1ea3o h\u00e0nh " + record.projectId + ".xlsx";
  const spreadsheet = SpreadsheetApp.create("GM-CRM warranty temporary " + record.projectId);
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
    trashFilesByName_(warrantyFolder, fileName);
    const xlsxFile = warrantyFolder.createFile(xlsxBlob);
    return { fileId: xlsxFile.getId(), fileUrl: xlsxFile.getUrl(), folderUrl: warrantyFolder.getUrl(), fileName: fileName };
  } finally {
    DriveApp.getFileById(spreadsheet.getId()).setTrashed(true);
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
  const url = "https://www.googleapis.com/drive/v3/files/" + spreadsheetId + "/export?mimeType=" + encodeURIComponent(EXCEL_MIME);
  const response = UrlFetchApp.fetch(url, { headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() } });
  return response.getBlob();
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
  const workflow = String(payload.workflow || "").trim();
  const allowedWorkflows = ["Ghi chú", "T\u01b0 v\u1ea5n", "Thi\u1ebft k\u1ebf", "D\u1ef1 to\u00e1n", "Thi c\u00f4ng", "Nghi\u1ec7m thu", "B\u1ea3o h\u00e0nh"];
  if (!year || !month || !projectId || allowedWorkflows.indexOf(workflow) === -1) throw new Error("Thi\u1ebfu th\u00f4ng tin th\u01b0 m\u1ee5c c\u1ea7n n\u1ea1p.");

  const cacheKey = "gmcrm-files-" + year + "-" + month + "-" + projectId + "-" + Utilities.base64EncodeWebSafe(workflow);
  const cached = payload.refresh ? null : readCachedJson_(cacheKey);
  if (cached) return cached;

  // Ghi chú was added after some existing projects were created. Opening it
  // creates just that missing folder, without rechecking every project folder.
  const customerFolder = getCustomerFolder_(year, month, projectId, false);
  if (!customerFolder) return { ok: true, files: [] };
  const workflowFolderCacheKey = "gmcrm-workflow-folder-" + year + "-" + month + "-" + projectId + "-" + Utilities.base64EncodeWebSafe(workflow);
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
  const workflow = String(payload.workflow || "").trim();
  const allowedWorkflows = ["Ghi chú", "Tư vấn", "Thiết kế", "Dự toán", "Thi công", "Nghiệm thu", "Bảo hành"];
  if (!year || !month || !projectId || allowedWorkflows.indexOf(workflow) === -1) throw new Error("Thiếu thông tin thư mục cần tạo.");
  const customerFolder = getCustomerFolder_(year, month, projectId, true);
  const workflowFolder = getOrCreateFolder_(customerFolder, workflow);
  const folderName = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd-MM-yyyy");
  const folder = getOrCreateFolder_(workflowFolder, folderName);
  CacheService.getScriptCache().remove("gmcrm-files-" + year + "-" + month + "-" + projectId + "-" + Utilities.base64EncodeWebSafe(workflow));
  return { ok: true, folderId: folder.getId(), folderName: folderName, folderUrl: folder.getUrl() };
}

function uploadWorkflowFile_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  const workflow = String(payload.workflow || "").trim();
  const upload = payload.file || {};
  const allowedWorkflows = ["Ghi chú", "Tư vấn", "Thiết kế", "Dự toán", "Thi công", "Nghiệm thu", "Bảo hành"];
  if (!year || month < 1 || month > 12 || !projectId || allowedWorkflows.indexOf(workflow) === -1) {
    throw new Error("Thiếu thông tin thư mục tải tệp.");
  }
  if (typeof upload.data !== "string" || !upload.data) throw new Error("Tệp tải lên không có dữ liệu.");
  const fileName = String(upload.fileName || "").replace(/[\\/]/g, "-").trim();
  if (!fileName) throw new Error("Tên tệp không hợp lệ.");

  const customerFolder = getCustomerFolder_(year, month, projectId, true);
  const workflowFolder = getOrCreateFolder_(customerFolder, workflow);
  const bytes = Utilities.base64Decode(upload.data);
  if (bytes.length > 12 * 1024 * 1024) throw new Error("Mỗi tệp tải trực tiếp tối đa 12 MB.");
  trashFilesByName_(workflowFolder, fileName);
  const blob = Utilities.newBlob(bytes, String(upload.mimeType || "application/octet-stream"), fileName);
  const file = workflowFolder.createFile(blob);
  CacheService.getScriptCache().remove("gmcrm-files-" + year + "-" + month + "-" + projectId + "-" + Utilities.base64EncodeWebSafe(workflow));
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

function workNotesCacheKey_(details) {
  return "gmcrm-work-notes-" + details.year + "-" + details.month + "-" + details.projectId;
}

function workNotesPropertyKey_(details) {
  return WORK_NOTES_PROPERTY_PREFIX + details.year + "-" + details.month + "-" + Utilities.base64EncodeWebSafe(details.projectId).replace(/=+$/g, "");
}

function readPropertyJson_(key) {
  const properties = PropertiesService.getScriptProperties();
  const count = Number(properties.getProperty(key + ":count") || 0);
  if (!count) return null;
  let text = "";
  for (let index = 0; index < count; index += 1) text += properties.getProperty(key + ":" + index) || "";
  if (!text) return null;
  try { return JSON.parse(text); } catch (error) { return null; }
}

function writePropertyJson_(key, value) {
  const properties = PropertiesService.getScriptProperties();
  const text = JSON.stringify(value);
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += SCRIPT_PROPERTY_CHUNK_SIZE) chunks.push(text.slice(offset, offset + SCRIPT_PROPERTY_CHUNK_SIZE));
  const previousCount = Number(properties.getProperty(key + ":count") || 0);
  chunks.forEach(function(chunk, index) { properties.setProperty(key + ":" + index, chunk); });
  for (let index = chunks.length; index < previousCount; index += 1) properties.deleteProperty(key + ":" + index);
  properties.setProperty(key + ":count", String(chunks.length));
}

function clearPropertyJson_(key) {
  const properties = PropertiesService.getScriptProperties();
  const count = Number(properties.getProperty(key + ":count") || 0);
  for (let index = 0; index < count; index += 1) properties.deleteProperty(key + ":" + index);
  properties.deleteProperty(key + ":count");
}

function workNotesFolder_(year, month, projectId, createMissing) {
  const customerFolder = getCustomerFolder_(year, month, projectId, createMissing);
  if (!customerFolder) return null;
  return createMissing ? getOrCreateFolder_(customerFolder, "Ghi chú") : findFolder_(customerFolder, "Ghi chú");
}

function workNotesPayload_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  if (!year || month < 1 || month > 12 || !projectId) throw new Error("Thiếu thông tin hồ sơ ghi chú.");
  return { year: year, month: month, projectId: projectId };
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
  return (Array.isArray(notes) ? notes : []).slice(0, 500).map(function(note, index) {
    const priority = workNoteText_(note && note.priority, 30);
    const workType = workNoteText_(note && note.workType, 50);
    const status = workNoteText_(note && note.status, 20);
    const dueDate = normalizeWorkNoteDate_(note && note.dueDate);
    const actualDate = normalizeWorkNoteDate_(note && note.actualDate);
    const completedAt = workNoteText_(note && note.completedAt, 40);
    const acceptedAt = workNoteText_(note && note.acceptedAt, 40);
    return {
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
  });
}

function workNoteStatus_(acceptedAt, dueDate) {
  if (!acceptedAt) return "Đen";
  const matched = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dueDate || "");
  if (!matched) return "Xanh";
  const due = new Date(Number(matched[3]), Number(matched[2]) - 1, Number(matched[1]));
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const days = Math.floor((due.getTime() - now.getTime()) / 86400000);
  if (days < 0) return "Tím";
  if (days <= 3) return "Đỏ";
  if (days <= 7) return "Cam";
  return "Xanh";
}

function activeWorkNotesFile_() {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const file = findFileByName_(root, ACTIVE_WORK_NOTES_FILE_NAME);
  return file || root.createFile(ACTIVE_WORK_NOTES_FILE_NAME, "[]", MimeType.PLAIN_TEXT);
}

function readActiveWorkNotes_() {
  const shared = readPropertyJson_(ACTIVE_WORK_NOTES_PROPERTY_KEY);
  if (Array.isArray(shared)) return shared;
  try { const value = JSON.parse(activeWorkNotesFile_().getBlob().getDataAsString() || "[]"); return Array.isArray(value) ? value : []; } catch (error) { return []; }
}

function saveActiveWorkNotes_(records) {
  const normalized = records.slice(-3000);
  writePropertyJson_(ACTIVE_WORK_NOTES_PROPERTY_KEY, normalized);
  try { activeWorkNotesFile_().setContent(JSON.stringify(normalized)); } catch (error) { /* Shared property storage is the fallback when Drive is read-only. */ }
}

function syncActiveWorkNotes_(details, notes, payload) {
  const previous = readActiveWorkNotes_().filter(function(item) { return !(Number(item.year) === details.year && Number(item.month) === details.month && String(item.projectId) === details.projectId); });
  const active = notes.filter(function(note) { return !note.actualDate && note.assigneeEmail; }).map(function(note) { return { ...note, year: details.year, month: details.month, projectId: details.projectId, customerName: workNoteText_(payload.customerName, 240), houseId: workNoteText_(payload.houseId, 120), updatedAt: new Date().toISOString() }; });
  saveActiveWorkNotes_(previous.concat(active));
}

function loadAssignedWorkNotes_(payload) {
  const email = workNoteText_(payload.email, 240).toLowerCase();
  if (!email) throw new Error("Thiếu email nhân viên.");
  const activeNotes = readActiveWorkNotes_().filter(function(note) { return !note.actualDate; });
  // The built-in manager account needs an overview across every customer,
  // while each employee continues to receive only work assigned to them.
  if (email === WORK_NOTES_ADMIN_ACCOUNT) return { ok: true, notes: activeNotes };
  return { ok: true, notes: activeNotes.filter(function(note) { return String(note.assigneeEmail || "").toLowerCase() === email; }) };
}

function loadWorkNotes_(payload) {
  const details = workNotesPayload_(payload);
  const cacheKey = workNotesCacheKey_(details);
  const shared = readPropertyJson_(workNotesPropertyKey_(details));
  if (Array.isArray(shared)) return { ok: true, notes: normalizeWorkNotes_(shared), source: "script-properties" };
  const cached = readCachedJson_(cacheKey);
  if (cached) return { ok: true, notes: normalizeWorkNotes_(cached), source: "cache" };
  const folder = workNotesFolder_(details.year, details.month, details.projectId, false);
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
  const notes = normalizeWorkNotes_(payload.notes);
  const propertyKey = workNotesPropertyKey_(details);
  writePropertyJson_(propertyKey, notes);
  cacheJson_(workNotesCacheKey_(details), notes, 21600);
  let driveSaved = false;
  try {
    const folder = workNotesFolder_(details.year, details.month, details.projectId, true);
    const content = JSON.stringify(notes);
    const file = findFileByName_(folder, WORK_NOTES_FILE_NAME);
    if (file) file.setContent(content);
    else folder.createFile(WORK_NOTES_FILE_NAME, content, MimeType.PLAIN_TEXT);
    driveSaved = true;
  } catch (error) {
    // Publishing must not fail just because the connected Drive folder is
    // read-only. The shared property store still reaches every employee.
  }
  syncActiveWorkNotes_(details, notes, payload);
  return { ok: true, savedCount: notes.length, storage: driveSaved ? "drive" : "script-properties", driveWarning: driveSaved ? "" : "Drive hiện chỉ có quyền xem; ghi chú đã lưu vào kho dùng chung Apps Script." };
}

function completedWorkNotesFolder_(details) {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const customers = getOrCreateFolder_(root, CUSTOMERS_FOLDER_NAME);
  const yearFolder = getOrCreateFolder_(customers, String(details.year));
  return getOrCreateFolder_(yearFolder, "T" + details.month);
}

function completeWorkNote_(payload) {
  const details = workNotesPayload_(payload);
  const note = normalizeWorkNotes_([payload.note || {}])[0];
  if (!note || !note.actualDate) throw new Error("Cần xác nhận ngày hoàn thành trước khi lưu công việc vào Drive.");
  const actorEmail = workNoteText_(payload.actorEmail, 240).toLowerCase();
  if (!note.assigneeEmail || actorEmail !== note.assigneeEmail) throw new Error("Chỉ người được giao việc mới có thể xác nhận hoàn thành.");

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
    savedAt: Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"),
  });
  const content = JSON.stringify(records);
  if (file) file.setContent(content);
  else folder.createFile(COMPLETED_WORK_NOTES_FILE_NAME, content, MimeType.PLAIN_TEXT);
  const workFolder = workNotesFolder_(details.year, details.month, details.projectId, true);
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
const PANCAKE_MESSAGE_STATUSES = ["new", "deferred", "processing", "resolved"];

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
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const file = findFileByName_(root, PANCAKE_MESSAGE_STATE_FILE_NAME);
  return file || root.createFile(PANCAKE_MESSAGE_STATE_FILE_NAME, "[]", MimeType.PLAIN_TEXT);
}

function readPancakeMessageStates_() {
  try {
    const value = JSON.parse(pancakeMessageStateFile_().getBlob().getDataAsString() || "[]");
    return Array.isArray(value) ? value : [];
  } catch (error) { return []; }
}

function savePancakeMessageStates_(states) {
  pancakeMessageStateFile_().setContent(JSON.stringify(states.slice(-5000)));
}

function pancakeHouseIdFromGroupName_(groupName) {
  const match = /^(.+?)\s*-\s*GM(?:\s*-|\s*$)/i.exec(workNoteText_(groupName, 400));
  return match ? match[1].trim() : "";
}

function normalizePancakeHouseId_(value) {
  return workNoteText_(value, 160).toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
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

function pancakeNestedText_(value) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object") return "";
  const nested = value.text || value.message || value.content || value.body;
  return (nested && typeof nested === "object" ? pancakeNestedText_(nested) : String(nested || value.name || ""));
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
    map[key] = { houseId: houseId, projectId: workNoteText_(target.projectId, 160), customerName: workNoteText_(target.customerName, 240), year: Number(target.year) || 0, month: Number(target.month) || 0 };
  });
  return map;
}

function groupPancakeMessages_(conversation, rawMessages, target) {
  const fallbackName = workNoteText_(conversation && conversation.page_customer && conversation.page_customer.name, 240) || workNoteText_(conversation && conversation.from && conversation.from.name, 240) || "Khách hàng";
  const normalized = rawMessages.map(function(message, index) {
    const content = pancakeMessageText_(message);
    const sentAt = pancakeDateIso_(message && (message.inserted_at || message.created_at || message.sent_at || message.timestamp || message.time));
    return { id: workNoteText_(message && (message.id || message.message_id), 180) || "message-" + index, senderName: pancakeMessageSender_(message, fallbackName), content: content, sentAt: sentAt };
  }).filter(function(message) { return message.content && message.sentAt; }).sort(function(left, right) { return new Date(left.sentAt).getTime() - new Date(right.sentAt).getTime(); });
  const groups = [];
  normalized.forEach(function(message) {
    const last = groups[groups.length - 1];
    const messageTime = new Date(message.sentAt).getTime();
    if (!last || messageTime - new Date(last.lastMessageAt).getTime() > 2 * 60 * 60 * 1000) {
      groups.push({ id: "pancake-" + String(conversation.id) + "-" + message.sentAt, conversationId: String(conversation.id), groupName: workNoteText_(conversation && conversation.from && conversation.from.name, 400), houseId: target.houseId, projectId: target.projectId, customerName: target.customerName || fallbackName, year: target.year, month: target.month, messages: [message], firstMessageAt: message.sentAt, lastMessageAt: message.sentAt, messageCount: 1 });
    } else {
      last.messages.push(message);
      last.lastMessageAt = message.sentAt;
      last.messageCount += 1;
    }
  });
  return groups;
}

function loadCustomerMessages_(payload) {
  const properties = PropertiesService.getScriptProperties();
  if (!pancakeProperty_(PANCAKE_USER_TOKEN_PROPERTY) || !pancakeProperty_(PANCAKE_PAGE_TOKEN_PROPERTY)) return { ok: true, configured: false, messages: [] };
  const targets = pancakeTargetMap_(payload);
  const context = pancakePageContext_();
  const cacheKey = "gmcrm-pancake-messages-" + Utilities.base64EncodeWebSafe(JSON.stringify(Object.keys(targets).sort())).slice(0, 100);
  const cached = payload.refresh ? null : readCachedJson_(cacheKey);
  if (cached) return cached;
  const conversations = pancakeConversationPages_(context);
  const groups = [];
  conversations.forEach(function(conversation) {
    const groupName = workNoteText_(conversation && conversation.from && conversation.from.name, 400);
    const houseKey = normalizePancakeHouseId_(pancakeHouseIdFromGroupName_(groupName));
    // A Pancake group is useful to GM-CRM only when its name contains the
    // GM marker and the extracted house code matches a loaded customer.
    // Never surface an unassigned group in the all-customer overview.
    if (!/\bGM\b/i.test(groupName) || !targets[houseKey]) return;
    const target = targets[houseKey];
    let messages;
    try { messages = pancakeConversationMessages_(context, conversation); } catch (error) { return; }
    groupPancakeMessages_(conversation, messages.filter(function(message) { return !pancakeIsPageMessage_(message, context.pageId); }), target).forEach(function(group) { groups.push(group); });
  });
  const states = readPancakeMessageStates_();
  const stateById = {};
  states.forEach(function(state) { stateById[String(state.id || "")] = state; });
  const now = Date.now();
  const active = groups.map(function(group) {
    const state = stateById[group.id];
    return state ? { ...group, status: state.status, resolvedAt: state.resolvedAt || "", statusUpdatedAt: state.statusUpdatedAt || "" } : { ...group, status: "new", resolvedAt: "", statusUpdatedAt: "" };
  }).filter(function(group) { return group.status !== "resolved" || !group.resolvedAt || now - new Date(group.resolvedAt).getTime() < 24 * 60 * 60 * 1000; });
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
    messages: (Array.isArray(group.messages) ? group.messages : []).slice(0, 200).map(function(message) { return { id: workNoteText_(message && message.id, 180), senderName: workNoteText_(message && message.senderName, 160) || "Khách hàng", content: workNoteText_(message && message.content, 4000), sentAt: pancakeDateIso_(message && message.sentAt) }; }).filter(function(message) { return message.content && message.sentAt; }),
    firstMessageAt: pancakeDateIso_(group.firstMessageAt),
    lastMessageAt: pancakeDateIso_(group.lastMessageAt),
    messageCount: Math.min(200, Number(group.messageCount) || 0),
  };
}

function exportPancakeMessageWorkbook_(records) {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const temporary = SpreadsheetApp.create("GM-CRM Tin nhắn khách temporary");
  try {
    const sheet = temporary.getSheets()[0];
    sheet.setName("Tin nhắn khách");
    const rows = [["Nhóm Pancake", "Mã nhà", "ID dự án", "Khách hàng", "Người nhắn", "Nội dung", "Ngày giờ khách nhắn", "Ngày giờ hoàn thiện", "Trạng thái"]];
    records.filter(function(record) { return record && record.status === "resolved"; }).forEach(function(record) {
      const messages = Array.isArray(record.messages) ? record.messages : [];
      const content = messages.map(function(message) { return message.senderName + ": " + message.content; }).join("\n");
      const times = messages.map(function(message) { return message.sentAt; }).filter(Boolean).join("\n");
      rows.push([record.groupName, record.houseId, record.projectId, record.customerName, messages.map(function(message) { return message.senderName; }).filter(Boolean).join(", "), content, times, record.resolvedAt || "", "Đã xử lý"]);
    });
    if (rows.length) sheet.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, rows[0].length).setFontWeight("bold");
    SpreadsheetApp.flush();
    const blob = DriveApp.getFileById(temporary.getId()).getBlob().getAs(EXCEL_MIME).setName(PANCAKE_MESSAGE_EXPORT_FILE_NAME);
    trashFilesByName_(root, PANCAKE_MESSAGE_EXPORT_FILE_NAME);
    root.createFile(blob);
  } finally {
    DriveApp.getFileById(temporary.getId()).setTrashed(true);
  }
}

function updateCustomerMessageStatus_(payload) {
  const group = normalizePancakeMessageGroup_(payload.message);
  const status = workNoteText_(payload.status, 20);
  if (!group.id || PANCAKE_MESSAGE_STATUSES.indexOf(status) === -1) throw new Error("Trạng thái tin nhắn không hợp lệ.");
  const states = readPancakeMessageStates_();
  const next = states.filter(function(item) { return String(item.id || "") !== group.id; });
  const state = { ...group, status: status, resolvedAt: status === "resolved" ? new Date().toISOString() : "", statusUpdatedAt: new Date().toISOString() };
  next.push(state);
  if (status === "resolved") exportPancakeMessageWorkbook_(next);
  savePancakeMessageStates_(next);
  return { ok: true, id: group.id, status: status, resolvedAt: state.resolvedAt };
}

// Published design rows live in one small registry at the root.  This is the
// cross-device assignment queue; the Excel files remain optional exports.
const ACTIVE_DESIGN_TASKS_FILE_NAME = "_gmcrm_thiet_ke_dang_giao.json";
const DESIGN_TASK_KINDS = ["architecture", "interior", "acceptance"];

function activeDesignTasksFile_() {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const file = findFileByName_(root, ACTIVE_DESIGN_TASKS_FILE_NAME);
  return file || root.createFile(ACTIVE_DESIGN_TASKS_FILE_NAME, "[]", MimeType.PLAIN_TEXT);
}

function readActiveDesignTasks_() {
  try {
    const value = JSON.parse(activeDesignTasksFile_().getBlob().getDataAsString() || "[]");
    return Array.isArray(value) ? value : [];
  } catch (error) { return []; }
}

function saveActiveDesignTasks_(records) {
  activeDesignTasksFile_().setContent(JSON.stringify(records.slice(-5000)));
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
  const details = workNotesPayload_(payload);
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
  const email = workNoteText_(payload.email, 240).toLowerCase();
  if (!email) throw new Error("Thiếu email nhân viên.");
  const tasks = readActiveDesignTasks_().filter(function(task) { return !task.actualDate; });
  if (email === WORK_NOTES_ADMIN_ACCOUNT) return { ok: true, tasks: tasks };
  return { ok: true, tasks: tasks.filter(function(task) { return String(task.assigneeEmail || "").toLowerCase() === email; }) };
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
  const prefix = "-" + projectId;
  const folders = documentsFolder.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    const name = folder.getName();
    if (name.length <= prefix.length || name.slice(-prefix.length) !== prefix || !documentSnapshotDate_(name)) continue;
    snapshots.push({ folder: folder, id: folder.getId(), name: name, date: documentSnapshotDate_(name) });
  }
  snapshots.sort(function(a, b) {
    const parse = function(item) { const parts = item.date.split("/"); return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0])).getTime(); };
    return parse(b) - parse(a) || b.name.localeCompare(a.name);
  });
  return snapshots;
}

function readDocumentManifest_(documentsFolder) {
  const file = findFileByName_(documentsFolder, DOCUMENT_MANIFEST_NAME);
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
  if (!customerFolder) return null;
  if (createMissing) return ensureThreeDFolders_(customerFolder);
  const root = findFolder_(customerFolder, THREE_D_FOLDER_NAME);
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
  CacheService.getScriptCache().remove(documentCachePrefix_(year, month, projectId) + "-latest");
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
  const seedKey = documentCachePrefix_(year, month, projectId) + "-seed";
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
      const documentKey = "system:" + work + ":" + file.getName();
      sources[documentKey] = { file: file, workflow: work };
    }
  });
  return sources;
}

function listDocuments_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  if (!year || month < 1 || month > 12 || !projectId) throw new Error("Thiếu thông tin Tài liệu.");
  // Listing must stay read-only. A new day is created only by the explicit
  // "Bản ngày mới" command, never when the user merely opens or switches days.
  const documentsFolder = documentsFolderForProject_(year, month, projectId, false);
  if (!documentsFolder) return { ok: true, snapshots: [], activeSnapshotId: "", files: [] };
  const snapshots = listDocumentSnapshots_(documentsFolder, projectId);
  const requestedId = String(payload.snapshotId || "");
  const snapshotIndex = Math.max(0, snapshots.findIndex(function(snapshot) { return snapshot.id === requestedId; }));
  const target = snapshots[snapshotIndex];
  const manifest = readDocumentManifest_(documentsFolder);
  const files = [];
  if (target) {
    try {
      listDriveChildrenMetadata_(target.folder.getId()).forEach(function(item) {
        if (item.mimeType === "application/vnd.google-apps.folder") return;
        if (isHiddenDocumentFile_(item.name)) return;
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
      const iterator = target.folder.getFiles();
      while (iterator.hasNext()) {
        const file = iterator.next();
        if (isHiddenDocumentFile_(file.getName())) continue;
        const modified = file.getLastUpdated();
        const meta = normalizeDocumentMeta_(manifest.files[file.getId()], file, "Chưa gắn");
        files.push({ id: file.getId(), name: file.getName(), downloadUrl: "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(file.getId()), viewUrl: driveFileViewUrl_(file.getId()), updatedAt: Utilities.formatDate(modified, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"), mimeType: file.getMimeType(), work: meta.work, updatedAtMillis: modified.getTime() });
      }
    }
  }
  files.sort(function(a, b) { return b.updatedAtMillis - a.updatedAtMillis || a.name.localeCompare(b.name); });
  return { ok: true, snapshots: snapshots.map(function(snapshot) { return { id: snapshot.id, name: snapshot.name, date: snapshot.date, locked: !!((manifest.snapshots || {})[snapshot.id] || {}).locked }; }), activeSnapshotId: target ? target.id : "", files: files };
}

function listThreeDFolderFiles_(folder) {
  if (!folder) return [];
  const files = [];
  try {
    listDriveChildrenMetadata_(folder.getId()).forEach(function(item) {
      if (item.mimeType === "application/vnd.google-apps.folder" || isHiddenDocumentFile_(item.name)) return;
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
  const structure = threeDFoldersForProject_(year, month, projectId, true);
  return {
    ok: true,
    rootUrl: structure.root.getUrl(),
    folders: structure.folders.map(function(item) {
      return { key: item.key, name: item.name, folderUrl: item.folder.getUrl(), files: listThreeDFolderFiles_(item.folder) };
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
  if (!year || month < 1 || month > 12 || !projectId) throw new Error("Thiếu thông tin Tài liệu.");
  const documentsFolder = documentsFolderForProject_(year, month, projectId, true);
  const todayName = documentSnapshotName_(projectId);
  const snapshots = listDocumentSnapshots_(documentsFolder, projectId);
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
  const snapshotId = String(payload.snapshotId || "").trim();
  const locked = payload.locked === true;
  if (!year || month < 1 || month > 12 || !projectId || !snapshotId) throw new Error("Thiếu thông tin bản Tài liệu.");
  const documentsFolder = documentsFolderForProject_(year, month, projectId, true);
  documentSnapshotForProject_(documentsFolder, projectId, snapshotId);
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
  const snapshotId = String(payload.snapshotId || "").trim();
  if (!year || month < 1 || month > 12 || !projectId || !snapshotId) throw new Error("Thiếu thông tin bản Tài liệu.");
  const documentsFolder = documentsFolderForProject_(year, month, projectId, false);
  if (!documentsFolder) throw new Error("Không tìm thấy thư mục Tài liệu của hồ sơ này.");
  const snapshot = documentSnapshotForProject_(documentsFolder, projectId, snapshotId);
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
  const fileId = String(payload.fileId || "").trim();
  const requestedSnapshotId = String(payload.snapshotId || "").trim();
  if (!year || month < 1 || month > 12 || !projectId || !fileId) throw new Error("Thiếu thông tin tệp Tài liệu.");
  const documentsFolder = documentsFolderForProject_(year, month, projectId, true);
  const manifest = readDocumentManifest_(documentsFolder);
  const file = DriveApp.getFileById(fileId);
  const snapshot = documentSnapshotForProject_(documentsFolder, projectId, requestedSnapshotId);
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
  return getOrCreateFolder_(DriveApp.getFolderById(ROOT_FOLDER_ID), "Nhân lực");
}

function loadPersonnel_() {
  const folder = personnelFolder_();
  const file = findFileByName_(folder, "Danh sách nhân lực.xlsx");
  if (!file) return { ok: true, personnel: {} };
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
      birthDate: normalizeExcelDate_(row[birthDateColumn]),
      phone: normalizePersonnelPhone_(row[phoneColumn]),
      role: String(row[roleColumn] || ""),
      permissions: permissionsColumn >= 0 ? String(row[permissionsColumn] || "").split("|").map(function(value) { return value.trim(); }).filter(Boolean) : [],
      address: String(row[addressColumn] || ""),
    });
  });
  return { ok: true, personnel: personnel };
}

function syncPersonnelWorkbook_(personnel) {
  const folder = personnelFolder_();
  const categoryLabels = {
    coordination: "Điều phối", management: "Ban quản lý", office: "Nhân viên văn phòng", site: "Nhân viên công trình",
    construction: "Nhân công xây dựng", workshop: "Nhân công xưởng", partner: "Đối tác",
  };
  const rows = [["Nhóm ID", "Nhóm", "Hoạt động", "Họ và tên", "Email", "Ngày sinh", "Số điện thoại", "Chức vụ", "Quyền", "Địa chỉ", "_ID"]];
  Object.keys(personnel || {}).forEach(function(category) {
    const members = Array.isArray(personnel[category]) ? personnel[category] : [];
    members.forEach(function(member) {
      if (!member || !String(member.name || "").trim()) return;
      const status = ["Có", "Không", "Ngưng"].indexOf(String(member.status || "")) >= 0 ? String(member.status) : "Có";
      const email = String(member.email || "").trim().toLowerCase();
      const permissions = Array.isArray(member.permissions) ? member.permissions.map(function(value) { return String(value || "").trim(); }).filter(Boolean).join("|") : "";
      rows.push([category, categoryLabels[category] || category, status, String(member.name || ""), email, String(member.birthDate || ""), normalizePersonnelPhone_(member.phone), String(member.role || ""), permissions, String(member.address || ""), String(member.id || "")]);
    });
  });
  const spreadsheet = SpreadsheetApp.create("GM-CRM nhân lực temporary");
  try {
    const sheet = spreadsheet.getSheets()[0];
    sheet.setName("Nhân lực");
    sheet.getRange(1, 1, rows.length, 11).setValues(rows).setFontFamily("Roboto").setWrap(true).setVerticalAlignment("top");
    sheet.getRange(1, 1, 1, 11).setFontWeight("bold").setBackground("#eee9e2");
    if (rows.length > 1) sheet.getRange(2, 7, rows.length - 1, 1).setNumberFormat("@");
    sheet.setFrozenRows(1);
    [115, 180, 100, 180, 220, 110, 135, 160, 260, 300, 130].forEach(function(width, index) { sheet.setColumnWidth(index + 1, width); });
    sheet.hideColumns(1, 2);
    sheet.hideColumns(11, 1);
    sheet.autoResizeRows(1, Math.max(1, sheet.getLastRow()));
    const fileName = "Danh sách nhân lực.xlsx";
    const xlsxBlob = exportXlsx_(spreadsheet.getId()).setName(fileName);
    trashFilesByName_(folder, fileName);
    const file = folder.createFile(xlsxBlob);
    return { ok: true, fileId: file.getId(), fileUrl: file.getUrl(), fileName: fileName };
  } finally {
    DriveApp.getFileById(spreadsheet.getId()).setTrashed(true);
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
      return String(item.email || "").trim().toLowerCase() === email && String(item.status || "Có") === "Có";
    });
    if (member) return member;
  }
  return null;
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
  const email = employeeAccountEmail_(payload.email);
  const account = readEmployeeAccount_(email);
  if (!employeeRosterMember_(email) || !account || !account.salt || !account.hash) return { ok: true, valid: false };
  return { ok: true, valid: employeePasswordHash_(String(payload.password || ""), account.salt) === account.hash };
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

function getCustomerFolder_(year, month, projectId, createMissing) {
  const folderCacheKey = "gmcrm-customer-folder-" + year + "-" + month + "-" + projectId;
  const cachedFolder = getCachedFolder_(folderCacheKey);
  if (cachedFolder) {
    if (createMissing) ensureProjectFolders_(cachedFolder);
    return cachedFolder;
  }
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const customers = createMissing ? getOrCreateFolder_(root, CUSTOMERS_FOLDER_NAME) : findFolder_(root, CUSTOMERS_FOLDER_NAME);
  if (!customers) return null;
  let yearFolder = createMissing ? getOrCreateFolder_(customers, String(year)) : findFolder_(customers, String(year));
  if (!yearFolder) return null;
  let monthFolder = createMissing ? getOrCreateFolder_(yearFolder, "T" + month) : findFolder_(yearFolder, "T" + month);
  if (!monthFolder) return null;
  const existingCustomerFolder = findFolder_(monthFolder, projectId);
  const customerFolder = existingCustomerFolder || (createMissing ? getOrCreateFolder_(monthFolder, projectId) : null);
  if (customerFolder) cacheFolder_(folderCacheKey, customerFolder);
  if (customerFolder && createMissing) ensureProjectFolders_(customerFolder, !existingCustomerFolder);
  return customerFolder;
}

function getCachedFolder_(key) {
  try {
    const folderId = CacheService.getScriptCache().get(key);
    return folderId ? DriveApp.getFolderById(folderId) : null;
  } catch (error) {
    CacheService.getScriptCache().remove(key);
    return null;
  }
}

function cacheFolder_(key, folder) {
  try {
    CacheService.getScriptCache().put(key, folder.getId(), 21600);
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
