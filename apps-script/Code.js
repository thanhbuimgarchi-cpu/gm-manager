/**
 * GM-CRM -> Google Drive
 *
 * Production source is managed in Git and deployed automatically by the
 * "Deploy Google Apps Script" GitHub Actions workflow. The workflow updates
 * the existing Web App deployment, so its /exec URL stays unchanged.
 *
 * One-time setup: run the Web App as the Google account that owns GM-Manager
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
    "<!doctype html><html><head><meta charset=\"utf-8\"><title>GM-Manager Drive Bridge</title></head><body>",
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
    .setTitle("GM-Manager Drive Bridge")
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
    const description = String(payload.description || "GM-Manager automatic deployment").replace(/[^\w .:-]/g, "").slice(0, 100);
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
    if (payload.action === "list-documents") return json_(listDocuments_(payload));
    if (payload.action === "load-personnel") return json_(loadPersonnel_(payload));
    if (payload.action === "load-consulting") return json_(loadConsultingWorkspace_(payload));
    if (payload.action === "customer-portal-share") return json_(customerPortalShare_(payload));

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      if (payload.action === "create-workflow-date-folder") return json_(createWorkflowDateFolder_(payload));
      if (payload.action === "upload-workflow-file") return json_(uploadWorkflowFile_(payload));
      if (payload.action === "sync-personnel") return json_(syncPersonnelWorkbook_(payload.personnel || {}));
      if (payload.action === "sync-work-notes") return json_(syncWorkNotes_(payload));
      if (payload.action === "complete-work-note") return json_(completeWorkNote_(payload));
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
    ? ["Ki\u1ec3m tra v\u00e0 kh\u1edbp MBCN", "T\u01b0 v\u1ea5n concept n\u1ed9i th\u1ea5t", "3D l\u1ea7n 1", "3D l\u1ea7n 2", "3D l\u1ea7n 3", "H\u1ed3 s\u01a1 b\u1ed5 k\u1ef9 thu\u1eadt n\u1ed9i th\u1ea5t", "Nghi\u1ec7m thu v\u00e0 b\u00e0n giao"]
    : ["T\u01b0 v\u1ea5n concept", "M\u1eb7t b\u1eb1ng c\u00f4ng n\u0103ng", "3D l\u1ea7n 1", "3D l\u1ea7n 2", "3D l\u1ea7n 3", "H\u1ed3 s\u01a1 b\u1ed5 k\u1ef9 thu\u1eadt", "Nghi\u1ec7m thu v\u00e0 b\u00e0n giao"];
  const prefix = progressKind === "interior" ? "interior-design" : "design";
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
  const fileName = "Ti\u1ebfn \u0111\u1ed9 thi\u1ebft k\u1ebf " + (isInterior ? "n\u1ed9i th\u1ea5t " : "ki\u1ebfn tr\u00fac ") + record.projectId + ".xlsx";
  const spreadsheet = SpreadsheetApp.create("GM-CRM " + (isInterior ? "interior " : "architecture ") + "design progress temporary " + record.projectId);
  try {
    const sheet = spreadsheet.getSheets()[0];
    sheet.setName("Ti\u1ebfn \u0111\u1ed9");
    const rows = (isInterior ? record.interiorDesignProgress || [] : record.designProgress || []).map(function(row) {
      return [String(row.content || ""), String(row.plannedDate || ""), String(row.actualDate || ""), String(row.assignee || ""), String(row.note || ""), String(row.id || ""), row.isCustom ? "true" : "false"];
    });
    const values = [["N\u1ed9i dung", "Ng\u00e0y d\u1ef1 ki\u1ebfn", "Ng\u00e0y th\u1ef1c t\u1ebf", "Ng\u01b0\u1eddi ph\u1ee5 tr\u00e1ch", "Ghi ch\u00fa", "_ID", "_T\u00f9y ch\u1ec9nh"]].concat(rows);
    sheet.getRange(1, 1, values.length, 7).setValues(values).setVerticalAlignment("top").setWrap(true).setFontFamily("Roboto");
    sheet.getRange(1, 1, 1, 7).setFontWeight("bold").setBackground("#eeeae5").setFontColor("#4f4b45");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 220);
    sheet.setColumnWidth(2, 125);
    sheet.setColumnWidth(3, 125);
    sheet.setColumnWidth(4, 160);
    sheet.setColumnWidth(5, 420);
    sheet.hideColumns(6, 2);
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
      ["NCT-KT", "Nhu c\u1ea7u thi\u1ebft k\u1ebf ki\u1ebfn tr\u00fac"], ["NCT-NT", "Nhu c\u1ea7u thi\u1ebft k\u1ebf n\u1ed9i th\u1ea5t"], ["NCC-KT", "Nhu c\u1ea7u thi c\u00f4ng ki\u1ebfn tr\u00fac"], ["NCC-NT", "Nhu c\u1ea7u thi c\u00f4ng n\u1ed9i th\u1ea5t"], ["PC-KT", "Phong c\u00e1ch ki\u1ebfn tr\u00fac"], ["PC-NT", "Phong c\u00e1ch n\u1ed9i th\u1ea5t"], ["QCTC", "Quy c\u00e1ch thi c\u00f4ng"],
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
      files.push({ id: folder.getId(), name: folder.getName(), downloadUrl: folder.getUrl(), updatedAt: Utilities.formatDate(folderUpdated, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"), mimeType: "application/vnd.google-apps.folder", isFolder: true, updatedAtMillis: folderUpdated.getTime() });
    }
    const iterator = workflowFolder.getFiles();
    while (iterator.hasNext()) {
      const file = iterator.next();
      if (file.getName() === WORK_NOTES_FILE_NAME) continue;
      if (isSpecialWorkflowWorkbook_(file.getName())) continue;
      const fileUpdated = file.getLastUpdated();
      files.push({ id: file.getId(), name: file.getName(), downloadUrl: "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(file.getId()), updatedAt: Utilities.formatDate(fileUpdated, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"), mimeType: file.getMimeType(), updatedAtMillis: fileUpdated.getTime() });
    }
  }
  files.sort(function(a, b) { return b.updatedAtMillis - a.updatedAtMillis; });
  const result = { ok: true, files: files.map(function(file) {
    return { id: file.id, name: file.name, downloadUrl: file.downloadUrl, updatedAt: file.updatedAt, mimeType: file.mimeType, isFolder: Boolean(file.isFolder) };
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
const WORK_NOTE_PRIORITIES = ["Gấp", "Cần lập tức", "Bình thường"];
const WORK_NOTE_TYPES = ["Thiết kế", "Tư vấn", "Bảo hành", "Nghiệm thu", "Thi công", "Dự toán"];
const WORK_NOTE_STATUSES = ["Đỏ", "Cam", "Xanh", "Đen"];

function workNotesCacheKey_(details) {
  return "gmcrm-work-notes-" + details.year + "-" + details.month + "-" + details.projectId;
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
    const acceptedAt = workNoteText_(note && note.acceptedAt, 40);
    return {
      id: workNoteText_(note && note.id, 100) || "work-note-" + index + "-" + new Date().getTime(),
      priority: WORK_NOTE_PRIORITIES.indexOf(priority) >= 0 ? priority : "Bình thường",
      workType: WORK_NOTE_TYPES.indexOf(workType) >= 0 ? workType : "Tư vấn",
      assignee: workNoteText_(note && note.assignee, 160),
      content: workNoteText_(note && note.content, 4000),
      dueDate: dueDate,
      actualDate: actualDate,
      acceptedAt: acceptedAt,
      // A newly created note stays black until the future assignee-acceptance
      // flow explicitly records acceptedAt.
      status: acceptedAt && WORK_NOTE_STATUSES.indexOf(status) >= 0 && status !== "Đen" ? status : "Đen",
    };
  });
}

function loadWorkNotes_(payload) {
  const details = workNotesPayload_(payload);
  const cacheKey = workNotesCacheKey_(details);
  const cached = readCachedJson_(cacheKey);
  if (cached) return { ok: true, notes: normalizeWorkNotes_(cached), source: "cache" };
  const folder = workNotesFolder_(details.year, details.month, details.projectId, false);
  if (!folder) return { ok: true, notes: [] };
  const file = findFileByName_(folder, WORK_NOTES_FILE_NAME);
  if (!file) return { ok: true, notes: [] };
  try {
    const notes = normalizeWorkNotes_(JSON.parse(file.getBlob().getDataAsString() || "[]"));
    cacheJson_(cacheKey, notes, 21600);
    return { ok: true, notes: notes, source: "drive" };
  } catch (error) {
    throw new Error("Không thể đọc dữ liệu ghi chú công việc.");
  }
}

function syncWorkNotes_(payload) {
  const details = workNotesPayload_(payload);
  const folder = workNotesFolder_(details.year, details.month, details.projectId, true);
  const notes = normalizeWorkNotes_(payload.notes);
  cacheJson_(workNotesCacheKey_(details), notes, 21600);
  const content = JSON.stringify(notes);
  const file = findFileByName_(folder, WORK_NOTES_FILE_NAME);
  if (file) file.setContent(content);
  else folder.createFile(WORK_NOTES_FILE_NAME, content, MimeType.PLAIN_TEXT);
  return { ok: true, savedCount: notes.length };
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
  CacheService.getScriptCache().remove(workNotesCacheKey_(details));
  return { ok: true, savedCount: records.length, folderUrl: folder.getUrl() };
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
        files.push({ id: file.getId(), name: file.getName(), downloadUrl: "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(file.getId()), updatedAt: Utilities.formatDate(modified, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"), mimeType: file.getMimeType(), work: meta.work, updatedAtMillis: modified.getTime() });
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
      files.push({ id: file.getId(), name: file.getName(), downloadUrl: "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(file.getId()), updatedAt: Utilities.formatDate(modified, "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"), mimeType: file.getMimeType(), updatedAtMillis: modified.getTime() });
    }
  }
  files.sort(function(a, b) { return b.updatedAtMillis - a.updatedAtMillis || a.name.localeCompare(b.name); });
  return files.map(function(file) { return { id: file.id, name: file.name, downloadUrl: file.downloadUrl, updatedAt: file.updatedAt, mimeType: file.mimeType }; });
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
  rows.slice(1).forEach(function(row, index) {
    const category = String(row[categoryColumn] || "").trim();
    const name = String(row[nameColumn] || "").trim();
    if (!category || !name) return;
    if (!personnel[category]) personnel[category] = [];
    personnel[category].push({
      id: String(row[idColumn] || ("drive-person-" + category + "-" + index)),
      status: statusColumn >= 0 && ["Có", "Không", "Ngưng"].indexOf(String(row[statusColumn] || "")) >= 0 ? String(row[statusColumn]) : "Có",
      name: name,
      birthDate: normalizeExcelDate_(row[birthDateColumn]),
      phone: normalizePersonnelPhone_(row[phoneColumn]),
      role: String(row[roleColumn] || ""),
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
  const rows = [["Nhóm ID", "Nhóm", "Hoạt động", "Họ và tên", "Ngày sinh", "Số điện thoại", "Chức vụ", "Địa chỉ", "_ID"]];
  Object.keys(personnel || {}).forEach(function(category) {
    const members = Array.isArray(personnel[category]) ? personnel[category] : [];
    members.forEach(function(member) {
      if (!member || !String(member.name || "").trim()) return;
      const status = ["Có", "Không", "Ngưng"].indexOf(String(member.status || "")) >= 0 ? String(member.status) : "Có";
      rows.push([category, categoryLabels[category] || category, status, String(member.name || ""), String(member.birthDate || ""), normalizePersonnelPhone_(member.phone), String(member.role || ""), String(member.address || ""), String(member.id || "")]);
    });
  });
  const spreadsheet = SpreadsheetApp.create("GM-CRM nhân lực temporary");
  try {
    const sheet = spreadsheet.getSheets()[0];
    sheet.setName("Nhân lực");
    sheet.getRange(1, 1, rows.length, 9).setValues(rows).setFontFamily("Roboto").setWrap(true).setVerticalAlignment("top");
    sheet.getRange(1, 1, 1, 9).setFontWeight("bold").setBackground("#eee9e2");
    if (rows.length > 1) sheet.getRange(2, 6, rows.length - 1, 1).setNumberFormat("@");
    sheet.setFrozenRows(1);
    [115, 180, 100, 180, 110, 135, 160, 300, 130].forEach(function(width, index) { sheet.setColumnWidth(index + 1, width); });
    sheet.hideColumns(1, 2);
    sheet.hideColumns(9, 1);
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
