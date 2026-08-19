/**
 * GM-CRM -> Google Drive
 *
 * 1. Paste this entire file into script.google.com and deploy it as a Web app.
 * 2. Run the Web app as the Google account that owns GM-Manager.
 * 3. In Project Settings > Script properties, add GEMINI_API_KEY from Google AI Studio.
 * 4. Paste the Web app URL into GM-CRM; no synchronization code is needed.
 */

const ROOT_FOLDER_ID = "1Z8Vj55v7LFgXEaCuusd25NC77RcQKmX4";
const CUSTOMERS_FOLDER_NAME = "Kh\u00e1ch h\u00e0ng";
const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents || "{}");
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
    if (payload.action === "create-workflow-date-folder") return json_(createWorkflowDateFolder_(payload));
    if (payload.action === "list-workflow-files") return json_(listWorkflowFiles_(payload));
    if (payload.action === "load-personnel") return json_(loadPersonnel_(payload));
    if (payload.action === "load-consulting") return json_(loadConsultingWorkspace_(payload));

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      if (payload.action === "sync-personnel") return json_(syncPersonnelWorkbook_(payload.personnel || {}));
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
  const record = recordFromWorkbook_(workbook, projectId, customerFolder);
  record.isHydrated = true;
  return { ok: true, year: year, month: month, record: record };
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

function recordFromWorkbook_(file, projectId, customerFolder) {
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
    projectId: metadata.projectId || projectId,
    createdAt: createdAt,
    details: details,
    functionalFloors: Object.keys(floorsByName).map(function(name) { return floorsByName[name]; }),
  };
  record.designProgress = readDesignProgress_(customerFolder, projectId, "architecture");
  record.interiorDesignProgress = readDesignProgress_(customerFolder, projectId, "interior");
  record.warrantyProgress = readWarrantyProgress_(customerFolder, projectId);
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
      sheet.getRange(2, 1, 9, 2).setValues([
        ["projectId", record.projectId || ""], ["name", record.name || ""], ["houseId", record.houseId || ""], ["createdAt", record.createdAt || ""],
        ["audioLanguage", note.language || ""], ["audioFileName", note.fileName || ""], ["audioTotalChunks", note.totalChunks || ""],
        ["audioCompletedChunks", note.completedChunks || ""], ["audioStatus", note.status || ""],
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
  const matches = parent.getFoldersByName(name);
  return matches.hasNext() ? matches.next() : parent.createFolder(name);
}

function listWorkflowFiles_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  const workflow = String(payload.workflow || "").trim();
  const allowedWorkflows = ["T\u01b0 v\u1ea5n", "Thi\u1ebft k\u1ebf", "D\u1ef1 to\u00e1n", "Thi c\u00f4ng", "Nghi\u1ec7m thu", "B\u1ea3o h\u00e0nh"];
  if (!year || !month || !projectId || allowedWorkflows.indexOf(workflow) === -1) throw new Error("Thi\u1ebfu th\u00f4ng tin th\u01b0 m\u1ee5c c\u1ea7n n\u1ea1p.");

  const cacheKey = "gmcrm-files-" + year + "-" + month + "-" + projectId + "-" + Utilities.base64EncodeWebSafe(workflow);
  const cached = payload.refresh ? null : readCachedJson_(cacheKey);
  if (cached) return cached;

  const customerFolder = getCustomerFolder_(year, month, projectId, false);
  if (!customerFolder) return { ok: true, files: [] };
  const workflowFolder = findFolder_(customerFolder, workflow);
  if (!workflowFolder) return { ok: true, files: [] };

  const files = [];
  const folders = workflowFolder.getFolders();
  while (folders.hasNext()) {
    const folder = folders.next();
    if (folder.getName().indexOf("-") === 0) continue;
    files.push({
      id: folder.getId(),
      name: folder.getName(),
      downloadUrl: folder.getUrl(),
      updatedAt: Utilities.formatDate(folder.getLastUpdated(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"),
      mimeType: "application/vnd.google-apps.folder",
      isFolder: true,
      updatedAtMillis: folder.getLastUpdated().getTime(),
    });
  }
  const iterator = workflowFolder.getFiles();
  while (iterator.hasNext()) {
    const file = iterator.next();
    if (isSpecialWorkflowWorkbook_(file.getName())) continue;
    files.push({
      id: file.getId(),
      name: file.getName(),
      downloadUrl: "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(file.getId()),
      updatedAt: Utilities.formatDate(file.getLastUpdated(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"),
      mimeType: file.getMimeType(),
      updatedAtMillis: file.getLastUpdated().getTime(),
    });
  }
  files.sort(function(a, b) { return b.updatedAtMillis - a.updatedAtMillis; });
  const result = { ok: true, files: files.map(function(file) {
    return { id: file.id, name: file.name, downloadUrl: file.downloadUrl, updatedAt: file.updatedAt, mimeType: file.mimeType, isFolder: Boolean(file.isFolder) };
  }) };
  cacheJson_(cacheKey, result, 180);
  return result;
}

function createWorkflowDateFolder_(payload) {
  const year = Number(payload.year);
  const month = Number(payload.month);
  const projectId = String(payload.projectId || "").trim();
  const workflow = String(payload.workflow || "").trim();
  const allowedWorkflows = ["Tư vấn", "Thiết kế", "Dự toán", "Thi công", "Nghiệm thu", "Bảo hành"];
  if (!year || !month || !projectId || allowedWorkflows.indexOf(workflow) === -1) throw new Error("Thiếu thông tin thư mục cần tạo.");
  const customerFolder = getCustomerFolder_(year, month, projectId, true);
  const workflowFolder = getOrCreateFolder_(customerFolder, workflow);
  const folderName = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd-MM-yyyy");
  const folder = getOrCreateFolder_(workflowFolder, folderName);
  CacheService.getScriptCache().remove("gmcrm-files-" + year + "-" + month + "-" + projectId + "-" + Utilities.base64EncodeWebSafe(workflow));
  return { ok: true, folderId: folder.getId(), folderName: folderName, folderUrl: folder.getUrl() };
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
  rows.slice(1).forEach(function(row, index) {
    const category = String(row[0] || "").trim();
    const name = String(row[2] || "").trim();
    if (!category || !name) return;
    if (!personnel[category]) personnel[category] = [];
    personnel[category].push({
      id: String(row[7] || ("drive-person-" + category + "-" + index)),
      name: name,
      birthDate: normalizeExcelDate_(row[3]),
      phone: String(row[4] || ""),
      role: String(row[5] || ""),
      address: String(row[6] || ""),
    });
  });
  return { ok: true, personnel: personnel };
}

function syncPersonnelWorkbook_(personnel) {
  const folder = personnelFolder_();
  const categoryLabels = {
    management: "Ban quản lý", office: "Nhân viên văn phòng", site: "Nhân viên công trình",
    construction: "Nhân công xây dựng", workshop: "Nhân công xưởng", partner: "Đối tác",
  };
  const rows = [["Nhóm ID", "Nhóm", "Họ và tên", "Ngày sinh", "Số điện thoại", "Chức vụ", "Địa chỉ", "_ID"]];
  Object.keys(personnel || {}).forEach(function(category) {
    const members = Array.isArray(personnel[category]) ? personnel[category] : [];
    members.forEach(function(member) {
      if (!member || !String(member.name || "").trim()) return;
      rows.push([category, categoryLabels[category] || category, String(member.name || ""), String(member.birthDate || ""), String(member.phone || ""), String(member.role || ""), String(member.address || ""), String(member.id || "")]);
    });
  });
  const spreadsheet = SpreadsheetApp.create("GM-CRM nhân lực temporary");
  try {
    const sheet = spreadsheet.getSheets()[0];
    sheet.setName("Nhân lực");
    sheet.getRange(1, 1, rows.length, 8).setValues(rows).setFontFamily("Roboto").setWrap(true).setVerticalAlignment("top");
    sheet.getRange(1, 1, 1, 8).setFontWeight("bold").setBackground("#eee9e2");
    sheet.setFrozenRows(1);
    [115, 180, 180, 110, 135, 160, 300, 130].forEach(function(width, index) { sheet.setColumnWidth(index + 1, width); });
    sheet.hideColumns(1, 2);
    sheet.hideColumns(8, 1);
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
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const customers = createMissing ? getOrCreateFolder_(root, CUSTOMERS_FOLDER_NAME) : findFolder_(root, CUSTOMERS_FOLDER_NAME);
  if (!customers) return null;
  let yearFolder = createMissing ? getOrCreateFolder_(customers, String(year)) : findFolder_(customers, String(year));
  if (!yearFolder) return null;
  let monthFolder = createMissing ? getOrCreateFolder_(yearFolder, "T" + month) : findFolder_(yearFolder, "T" + month);
  if (!monthFolder) return null;
  const customerFolder = createMissing ? getOrCreateFolder_(monthFolder, projectId) : findFolder_(monthFolder, projectId);
  if (customerFolder && createMissing) ensureProjectFolders_(customerFolder);
  return customerFolder;
}

function ensureProjectFolders_(customerFolder) {
  const consulting = getOrCreateFolder_(customerFolder, "T\u01b0 v\u1ea5n");
  ["Thi c\u00f4ng", "Thi\u1ebft k\u1ebf", "Nghi\u1ec7m thu", "B\u1ea3o h\u00e0nh", "D\u1ef1 to\u00e1n"].forEach(function(name) {
    getOrCreateFolder_(customerFolder, name);
  });
  const dataFolder = getOrCreateFolder_(consulting, "DataID");
  getOrCreateFolder_(dataFolder, "Ghi \u00e2m");
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

function findFolder_(parent, name) {
  const matches = parent.getFoldersByName(name);
  return matches.hasNext() ? matches.next() : null;
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
