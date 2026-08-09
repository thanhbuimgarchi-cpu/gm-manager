/**
 * GM-CRM → Google Drive
 *
 * 1. Thay WEB_SYNC_TOKEN bằng một mã bí mật riêng.
 * 2. Dán toàn bộ tệp này vào script.google.com rồi triển khai dưới dạng Web app.
 * 3. Web app phải chạy bằng tài khoản sở hữu GM-Manager.
 * 4. Trong Project Settings > Script properties, thêm GEMINI_API_KEY bằng khóa từ Google AI Studio.
 */

const ROOT_FOLDER_ID = "1Z8Vj55v7LFgXEaCuusd25NC77RcQKmX4";
// Token is intentionally pre-set to the value configured in GM-CRM.
const WEB_SYNC_TOKEN = "010101";
const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents || "{}");
    if (payload.token !== WEB_SYNC_TOKEN) throw new Error("M\u00e3 \u0111\u1ed3ng b\u1ed9 kh\u00f4ng \u0111\u00fang.");
    if (payload.action === "audio-insight") return json_(processAudioInsight_(payload));
    if (payload.action === "load-consulting") return json_(loadConsultingWorkspace_());

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      if (!payload.record || !payload.year || !payload.month) throw new Error("Thi\u1ebfu d\u1eef li\u1ec7u h\u1ed3 s\u01a1.");

      const result = exportCustomerWorkbook_(payload.record, Number(payload.year), Number(payload.month));
      return json_({ ok: true, ...result });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    return json_({ ok: false, error: error && error.message ? error.message : "Kh\u00f4ng th\u1ec3 xu\u1ea5t Excel." });
  }
}

function processAudioInsight_(payload) {
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
  const pointsSchema = { type: "OBJECT", properties: { points: { type: "ARRAY", items: { type: "STRING" } } }, required: ["points"] };
  const transcriptResult = generateGeminiJson_(apiKey, [{
    role: "user",
    parts: [
      { inline_data: { mime_type: audio.mimeType, data: audio.data } },
      { text: "Chuy\u1ec3n to\u00e0n b\u1ed9 l\u1eddi n\u00f3i trong ghi \u00e2m th\u00e0nh v\u0103n b\u1ea3n ch\u00ednh x\u00e1c. Chia theo c\u00e1c \u0111o\u1ea1n \u00fd ngh\u0129a, m\u1ed7i \u0111o\u1ea1n 1\u20133 c\u00e2u, c\u00f3 m\u1ed1c th\u1eddi gian MM:SS n\u1ebfu nh\u1eadn bi\u1ebft \u0111\u01b0\u1ee3c. Gi\u1eef nguy\u00ean ng\u00f4n ng\u1eef; kh\u00f4ng t\u1ef1 th\u00eam th\u00f4ng tin." },
    ],
  }], transcriptSchema);

  const segments = (transcriptResult.segments || []).filter(function(segment) {
    return segment && typeof segment.text === "string" && segment.text.trim();
  }).map(function(segment) {
    return { time: typeof segment.time === "string" ? segment.time : "~", text: segment.text.trim() };
  });
  if (!segments.length) throw new Error("Kh\u00f4ng nh\u1eadn di\u1ec7n \u0111\u01b0\u1ee3c l\u1eddi n\u00f3i trong file ghi \u00e2m.");

  const transcript = segments.map(function(segment) { return "[" + segment.time + "] " + segment.text; }).join("\n");
  const chunks = splitTranscript_(transcript);
  if (chunks.length > 20) throw new Error("B\u1ea3n ghi qu\u00e1 d\u00e0i \u0111\u1ec3 t\u00f3m t\u1eaft m\u1ed9t l\u1ea7n. H\u00e3y chia file ghi \u00e2m th\u00e0nh c\u00e1c ph\u1ea7n ng\u1eafn h\u01a1n.");

  const partialPoints = [];
  chunks.forEach(function(chunk, index) {
    const summary = generateGeminiJson_(apiKey, [{ role: "user", parts: [{ text: "T\u00f3m t\u1eaft ph\u1ea7n " + (index + 1) + "/" + chunks.length + " d\u01b0\u1edbi \u0111\u00e2y th\u00e0nh t\u1ed1i \u0111a 4 \u00fd ch\u00ednh ng\u1eafn, ch\u1ec9 gi\u1eef quy\u1ebft \u0111\u1ecbnh, nhu c\u1ea7u, s\u1ed1 li\u1ec7u, vi\u1ec7c c\u1ea7n l\u00e0m v\u00e0 r\u1ee7i ro. Kh\u00f4ng l\u1eb7p l\u1ea1i, kh\u00f4ng th\u00eam nh\u1eadn \u0111\u1ecbnh ngo\u00e0i v\u0103n b\u1ea3n.\n\n" + chunk }] }], pointsSchema);
    (summary.points || []).forEach(function(point) { if (typeof point === "string" && point.trim()) partialPoints.push(point.trim()); });
  });

  const finalSummary = generateGeminiJson_(apiKey, [{ role: "user", parts: [{ text: "G\u1ed9p c\u00e1c \u00fd d\u01b0\u1edbi \u0111\u00e2y th\u00e0nh t\u1ed1i \u0111a 10 \u00fd ch\u00ednh cho h\u1ed3 s\u01a1 kh\u00e1ch h\u00e0ng. B\u1ecf \u00fd tr\u00f9ng, \u01b0u ti\u00ean th\u00f4ng tin c\u00f3 th\u1ec3 h\u00e0nh \u0111\u1ed9ng. Vi\u1ebft ti\u1ebfng Vi\u1ec7t ng\u1eafn g\u1ecdn.\n\n" + partialPoints.map(function(point) { return "- " + point; }).join("\n") }] }], pointsSchema);
  return {
    ok: true,
    language: transcriptResult.language || "Ti\u1ebfng Vi\u1ec7t",
    segments: segments,
    keyPoints: (finalSummary.points || []).filter(function(point) { return typeof point === "string" && point.trim(); }).map(function(point) { return point.trim(); }),
  };
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

function loadConsultingWorkspace_() {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const consulting = findFolder_(root, "T\u01b0 v\u1ea5n");
  if (!consulting) return { ok: true, years: [] };

  const years = [];
  const yearFolders = consulting.getFolders();
  while (yearFolders.hasNext()) {
    const yearFolder = yearFolders.next();
    const yearName = yearFolder.getName();
    if (yearName.indexOf("-") === 0 || !/^\d{4}$/.test(yearName)) continue;
    const months = Array.from({ length: 12 }, function(_, index) { return { label: "T" + (index + 1), records: [] }; });
    const monthFolders = yearFolder.getFolders();
    while (monthFolders.hasNext()) {
      const monthFolder = monthFolders.next();
      const match = /^T(1[0-2]|[1-9])$/.exec(monthFolder.getName());
      if (monthFolder.getName().indexOf("-") === 0 || !match) continue;
      const customerFolders = monthFolder.getFolders();
      while (customerFolders.hasNext()) {
        const customerFolder = customerFolders.next();
        const projectId = customerFolder.getName();
        if (projectId.indexOf("-") === 0) continue;
        const workbook = latestWorkbook_(customerFolder);
        if (!workbook) continue;
        months[Number(match[1]) - 1].records.push(recordFromWorkbook_(workbook, projectId));
      }
    }
    years.push({ year: Number(yearName), months: months });
  }
  years.sort(function(a, b) { return a.year - b.year; });
  return { ok: true, years: years };
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

function recordFromWorkbook_(file, projectId) {
  const sheets = readXlsxSheets_(file);
  const metadata = keyValueRows_(sheets["0. GM-CRM"] || []);
  const details = {};
  ["1. Ch\u1ee7 \u0111\u1ea7u t\u01b0", "2. Nhu c\u1ea7u", "3. Th\u1eeda \u0111\u1ea5t", "5. H\u1ec7 th\u1ed1ng"].forEach(function(name) {
    (sheets[name] || []).slice(1).forEach(function(row) {
      const code = String(row[0] || "").trim();
      if (code) details[code] = String(row[2] || "");
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

  const segments = [];
  const keyPoints = [];
  (sheets["6. Th\u00f4ng tin ghi \u00e2m"] || []).slice(1).forEach(function(row) {
    const time = String(row[0] || "");
    const text = String(row[1] || "");
    const point = String(row[2] || "");
    if (text) segments.push({ time: time || "~", text: text });
    if (point) keyPoints.push(point);
  });

  const dateMatch = /^GM(\d{2})(\d{2})(\d{4})/.exec(projectId);
  const createdAt = metadata.createdAt || (dateMatch ? dateMatch[1] + "/" + dateMatch[2] + "/" + dateMatch[3] : "");
  const record = {
    id: "drive-" + projectId,
    name: metadata.name || details.HVT || projectId,
    houseId: metadata.houseId || "",
    projectId: metadata.projectId || projectId,
    createdAt: createdAt,
    details: details,
    functionalFloors: Object.keys(floorsByName).map(function(name) { return floorsByName[name]; }),
  };
  if (segments.length || keyPoints.length) {
    record.audioNote = {
      fileName: "Ghi \u00e2m trong " + file.getName(),
      language: metadata.audioLanguage || "Ti\u1ebfng Vi\u1ec7t",
      updatedAt: Utilities.formatDate(file.getLastUpdated(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm"),
      segments: segments,
      keyPoints: keyPoints,
    };
  }
  return record;
}

function readXlsxSheets_(file) {
  const entries = {};
  Utilities.unzip(file.getBlob()).forEach(function(blob) { entries[blob.getName()] = blob.getDataAsString("UTF-8"); });
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
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const consulting = getOrCreateFolder_(root, "T\u01b0 v\u1ea5n");
  const yearFolder = getOrCreateFolder_(consulting, String(year));
  const monthFolder = getOrCreateFolder_(yearFolder, "T" + month);
  const customerFolder = getOrCreateFolder_(monthFolder, record.projectId);
  const fileName = "Phi\u1ebfu th\u00f4ng tin kh\u00e1ch h\u00e0ng " + record.projectId + ".xlsx";

  const spreadsheet = SpreadsheetApp.create("GM-CRM temporary " + record.projectId);
  try {
    writeWorkbook_(spreadsheet, record);
    const xlsxBlob = exportXlsx_(spreadsheet.getId()).setName(fileName);
    trashFilesByName_(customerFolder, fileName);
    const xlsxFile = customerFolder.createFile(xlsxBlob);
    return {
      fileId: xlsxFile.getId(),
      fileUrl: xlsxFile.getUrl(),
      folderUrl: customerFolder.getUrl(),
      fileName: fileName,
    };
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
    ["6. Th\u00f4ng tin ghi \u00e2m", ["M\u1ed1c th\u1eddi gian", "N\u1ed9i dung \u0111\u00e3 chuy\u1ec3n", "\u00dd ch\u00ednh"], null],
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
      sheet.getRange(2, 1, 5, 2).setValues([
        ["projectId", record.projectId || ""], ["name", record.name || ""], ["houseId", record.houseId || ""], ["createdAt", record.createdAt || ""], ["audioLanguage", (record.audioNote && record.audioNote.language) || ""],
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
      const segments = note.segments || [];
      const points = note.keyPoints || [];
      const rows = [];
      const count = Math.max(segments.length, points.length);
      for (let rowIndex = 0; rowIndex < count; rowIndex++) {
        const segment = segments[rowIndex] || {};
        rows.push([segment.time || "", segment.text || "", points[rowIndex] || ""]);
      }
      if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    } else {
      const rows = fieldRows.map(function(field) {
        return [field[0], field[1], (record.details && record.details[field[0]]) || ""];
      });
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
    sheet.getDataRange().setFontFamily("Roboto").setWrap(true);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
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

function findFolder_(parent, name) {
  const matches = parent.getFoldersByName(name);
  return matches.hasNext() ? matches.next() : null;
}

function trashFilesByName_(folder, name) {
  const matches = folder.getFilesByName(name);
  while (matches.hasNext()) matches.next().setTrashed(true);
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
