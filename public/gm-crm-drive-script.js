/**
 * GM-CRM → Google Drive
 *
 * 1. Thay WEB_SYNC_TOKEN bằng một mã bí mật riêng.
 * 2. Dán toàn bộ tệp này vào script.google.com rồi triển khai dưới dạng Web app.
 * 3. Web app phải chạy bằng tài khoản sở hữu GM-Manager.
 */

const ROOT_FOLDER_ID = "1Z8Vj55v7LFgXEaCuusd25NC77RcQKmX4";
const WEB_SYNC_TOKEN = "THAY_MA_BI_MAT_CUA_BAN";
const EXCEL_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function doPost(event) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const payload = JSON.parse(event.postData.contents || "{}");
    if (payload.token !== WEB_SYNC_TOKEN) throw new Error("Mã đồng bộ không đúng.");
    if (!payload.record || !payload.year || !payload.month) throw new Error("Thiếu dữ liệu hồ sơ.");

    const result = exportCustomerWorkbook_(payload.record, Number(payload.year), Number(payload.month));
    return json_({ ok: true, ...result });
  } catch (error) {
    return json_({ ok: false, error: error && error.message ? error.message : "Không thể xuất Excel." });
  } finally {
    lock.releaseLock();
  }
}

function exportCustomerWorkbook_(record, year, month) {
  const root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  const consulting = getOrCreateFolder_(root, "Tư vấn");
  const yearFolder = getOrCreateFolder_(consulting, String(year));
  const monthFolder = getOrCreateFolder_(yearFolder, "T" + month);
  const customerFolder = getOrCreateFolder_(monthFolder, record.projectId);
  const fileName = "Phiếu thông tin khách hàng " + record.projectId + ".xlsx";

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
    ["1. Chủ đầu tư", ["Mã", "Nội dung", "Kết quả thu thập"], [
      ["HVT", "Họ và tên"], ["NS", "Ngày tháng năm sinh"], ["DC", "Địa chỉ"], ["SDT", "Số điện thoại/Zalo"], ["EMA", "Email"],
    ]],
    ["2. Nhu cầu", ["Mã", "Nội dung", "Kết quả thu thập"], [
      ["NCT-KT", "Nhu cầu thiết kế kiến trúc"], ["NCT-NT", "Nhu cầu thiết kế nội thất"], ["NCC-KT", "Nhu cầu thi công kiến trúc"], ["NCC-NT", "Nhu cầu thi công nội thất"], ["PC-KT", "Phong cách kiến trúc"], ["PC-NT", "Phong cách nội thất"], ["QCTC", "Quy cách thi công"],
    ]],
    ["3. Thửa đất", ["Mã", "Nội dung", "Kết quả thu thập"], [
      ["QM", "Quy mô"], ["VTR", "Vị trí công trình"], ["HNH", "Hướng nhà"], ["DTD", "Diện tích đất"], ["DTX", "Diện tích xây dựng"], ["VTMD", "Vị trí so với mặt đường"],
    ]],
    ["4. Công năng", ["Tầng", "Công năng", "Số lượng", "Mô tả chi tiết"], null],
    ["5. Hệ thống", ["Mã", "Nội dung", "Kết quả thu thập"], [
      ["D", "Điện"], ["N", "Nước"], ["E", "Năng lượng"], ["EL", "Thang máy"], ["DR", "Cửa"],
    ]],
  ];

  sheetDefinitions.forEach(function(definition, index) {
    const name = definition[0];
    const headers = definition[1];
    const fieldRows = definition[2];
    const sheet = index === 0 ? spreadsheet.getSheets()[0] : spreadsheet.insertSheet();
    sheet.setName(name);
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setBackground("#eee9e2");

    if (name === "4. Công năng") {
      const rows = [];
      (record.functionalFloors || []).forEach(function(floor) {
        (floor.rooms || []).forEach(function(room) {
          if (room.room || room.quantity || room.description) rows.push([floor.floor || "Tầng 1", room.room || "", room.quantity || "", room.description || ""]);
        });
      });
      if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    } else {
      const rows = fieldRows.map(function(field) {
        return [field[0], field[1], (record.details && record.details[field[0]]) || ""];
      });
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    }
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
  });
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

function trashFilesByName_(folder, name) {
  const matches = folder.getFilesByName(name);
  while (matches.hasNext()) matches.next().setTrashed(true);
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
