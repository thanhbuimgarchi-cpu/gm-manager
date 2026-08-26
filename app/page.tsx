"use client";

import { ChangeEvent, FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { TextareaHTMLAttributes } from "react";

type AudioSegment = {
  time: string;
  text: string;
};

type AudioNoteChunk = {
  index: number;
  segments: AudioSegment[];
};

type AudioNote = {
  fileName: string;
  language: string;
  updatedAt: string;
  segments: AudioSegment[];
  chunks?: AudioNoteChunk[];
  totalChunks?: number;
  completedChunks?: number;
  status?: "processing" | "complete";
};

type AudioInsightResult = {
  language?: string;
  segments: AudioSegment[];
  apiCallsUsed?: number;
};

type AudioProcessResponse = Partial<AudioInsightResult> & {
  ok?: boolean;
  error?: string;
};

type AudioChunk = {
  file: File;
  offsetSeconds: number;
};

type GrowingTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
};

function GrowingTextarea({ value, onChange, className, ...props }: GrowingTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const resize = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.max(textarea.scrollHeight, 34)}px`;
  };

  useEffect(() => {
    if (textareaRef.current) resize(textareaRef.current);
  }, [value]);

  return <textarea {...props} ref={textareaRef} rows={1} value={value} className={`growing-textarea ${className ?? ""}`.trim()} onChange={(event) => {
    resize(event.currentTarget);
    onChange(event);
  }} />;
}

type LineListEditorProps = {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
};

function LineListEditor({ value, onChange, ariaLabel, placeholder }: LineListEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  const focusLine = (index: number) => {
    window.requestAnimationFrame(() => {
      const editors = editorRef.current?.querySelectorAll("textarea");
      editors?.[Math.max(0, Math.min(index, (editors?.length ?? 1) - 1))]?.focus();
    });
  };
  const commitLines = (nextLines: string[]) => onChange(nextLines.join("\n"));
  const replaceLine = (index: number, nextValue: string) => {
    const replacementLines = nextValue.replace(/\r\n?/g, "\n").split("\n");
    commitLines([...lines.slice(0, index), ...replacementLines, ...lines.slice(index + 1)]);
  };
  const addLine = (index: number) => {
    commitLines([...lines.slice(0, index + 1), "", ...lines.slice(index + 1)]);
    focusLine(index + 1);
  };
  const removeLine = (index: number) => {
    if (lines.length === 1) {
      commitLines([""]);
      focusLine(0);
      return;
    }
    commitLines(lines.filter((_, lineIndex) => lineIndex !== index));
    focusLine(Math.min(index, lines.length - 2));
  };

  return <div ref={editorRef} className="line-list-editor">
    {lines.map((line, index) => <div className="line-list-editor__row" key={index}>
      <GrowingTextarea
        aria-label={`${ariaLabel}, dòng ${index + 1}`}
        value={line}
        onChange={(event) => replaceLine(index, event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          addLine(index);
        }}
        placeholder={placeholder}
      />
      <div className="line-list-editor__actions">
        <button type="button" onClick={() => addLine(index)} aria-label={`Thêm dòng sau dòng ${index + 1} của ${ariaLabel}`}>＋</button>
        <button type="button" onClick={() => removeLine(index)} disabled={lines.length === 1 && !line} aria-label={`Bớt dòng ${index + 1} của ${ariaLabel}`}>−</button>
      </div>
    </div>)}
  </div>;
}

type WorkRecord = {
  id: string;
  name: string;
  houseId?: string;
  projectId: string;
  createdAt: string;
  details: Record<string, string>;
  audioNote?: AudioNote;
  isHydrated?: boolean;
  progressHydrated?: boolean;
  designProgress?: DesignProgressRow[];
  interiorDesignProgress?: DesignProgressRow[];
  warrantyProgress?: WarrantyProgressRow[];
  functionalFloors?: FunctionalFloor[];
  functionalRows?: LegacyFunctionalRow[];
};

type DesignProgressRow = {
  id: string;
  isCustom: boolean;
  content: string;
  plannedDate: string;
  actualDate: string;
  assignee: string;
  note: string;
};

type WarrantyProgressRow = {
  id: string;
  isCustom: boolean;
  content: string;
  reportedDate: string;
  completedDate: string;
  assignee: string;
  note: string;
};

type FunctionalRoom = {
  id: string;
  room: string;
  quantity: string;
  description: string;
};

type FunctionalFloor = {
  id: string;
  floor: string;
  rooms: FunctionalRoom[];
};

type LegacyFunctionalRow = FunctionalRoom & { floor: string };

type MonthFolder = {
  label: string;
  records: WorkRecord[];
};

type YearFolder = {
  year: number;
  months: MonthFolder[];
};

type CustomerLocation = {
  record: WorkRecord;
  year: number;
  month: number;
};

type DriveFolder = {
  label: string;
  icon: string;
};

type WorkflowFile = {
  id: string;
  name: string;
  downloadUrl: string;
  updatedAt: string;
  mimeType: string;
  isFolder?: boolean;
};

type DocumentFile = {
  id: string;
  name: string;
  downloadUrl: string;
  updatedAt: string;
  mimeType: string;
  work: string;
  nature: DocumentNature;
};

type DocumentNature = "Chưa gắn" | "Xuyên suốt" | "Theo ngày";

type DocumentSnapshot = {
  id: string;
  name: string;
  date: string;
  locked?: boolean;
};

type PersonnelCategory = {
  id: string;
  label: string;
  icon: string;
  description: string;
};

type PersonnelMember = {
  id: string;
  status: PersonnelStatus;
  name: string;
  birthDate: string;
  phone: string;
  role: string;
  address: string;
};

type PersonnelStatus = "Có" | "Không" | "Ngưng";

type DriveSyncConfig = {
  scriptUrl: string;
};

type DesktopNotificationBridge = {
  isWindows: boolean;
  showNotification: (payload: { title: string; body: string; url: string }) => Promise<boolean>;
};

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type DriveLoadMode = "index" | "search" | "detail";

const monthLabels = Array.from({ length: 12 }, (_, index) => `T${index + 1}`);
const AUDIO_OUTPUT_SAMPLE_RATE = 16_000;
// Keep every browser upload below 1 MB. The hosting edge can reject larger
// multipart bodies before the request reaches the application worker.
const MAX_AUDIO_CHUNK_BYTES = 700 * 1024;
const MAX_WORKFLOW_UPLOAD_BYTES = 12 * 1024 * 1024;
const DRIVE_INDEX_CACHE_MS = 15 * 60 * 1000;
const DRIVE_SEARCH_CACHE_MS = 3 * 60 * 1000;
const DRIVE_DETAIL_CACHE_MS = 30 * 60 * 1000;
const DRIVE_PROGRESS_CACHE_MS = 30 * 60 * 1000;
// File metadata changes much less often than customer forms. Keep the latest
// successful list for instant rendering, then refresh it quietly in the
// background when it is older than fifteen minutes.
const DRIVE_FILE_LIST_FRESH_MS = 15 * 60 * 1000;
const DRIVE_FILE_LIST_CACHE_MS = 24 * 60 * 60 * 1000;
const DRIVE_DOCUMENT_METADATA_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
const driveCachePrefix = "gm-manager-drive-cache-v1:";
const MAX_DIRECT_AUDIO_BYTES = 600 * 1024;
const MAX_AUDIO_CHUNK_SECONDS = Math.floor((MAX_AUDIO_CHUNK_BYTES - 44) / (AUDIO_OUTPUT_SAMPLE_RATE * 2));
const buildMonths = (): MonthFolder[] => monthLabels.map((label) => ({ label, records: [] }));
const driveSyncConfigKey = "gm-manager-apps-script";
const personnelStorageKey = "gm-manager-personnel-v1";
const personnelStatuses: PersonnelStatus[] = ["Có", "Không", "Ngưng"];
// The currently deployed Apps Script still verifies its historical token. It is
// supplied automatically for compatibility, so users only ever enter the URL.
const deployedAppsScriptCompatibilityToken = "010101";
const defaultDriveSyncConfig: DriveSyncConfig = {
  scriptUrl: "https://script.google.com/macros/s/AKfycby_JquY7zgNJGE3eDDnQ-l0BWqVdiBhaDYt0Fx4fw1PBqK6FyyZxQWigc3yCUTGdKN1/exec",
};
const windowsInstallerUrl = "https://github.com/thanhbuimgarchi-cpu/gm-manager/releases/download/desktop-latest/GM-CRM-Setup.exe";
const retiredDriveScriptUrls = new Set([
  "https://script.google.com/macros/s/AKfycbx-O6jHLrtU-4GcpoWganEIAFxISrNpZD0lYRt5YK8fxzX7nBIsCHtAMvkQ68-Dxkbr/exec",
  "https://script.google.com/macros/s/AKfycbyItbx_J_G03Q8LWtEzpROCUm-stBCDDeGXrVz2wBravN5A6CmMOM6qGdquBceBVctt/exec",
]);
const APP_VERSION = import.meta.env.VITE_APP_VERSION || "development";

function isAppsScriptUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "script.google.com" && url.pathname.startsWith("/macros/s/");
  } catch {
    return false;
  }
}

function desktopBridge() {
  return (window as Window & { gmDesktop?: DesktopNotificationBridge }).gmDesktop;
}

function isWindowsDesktop() {
  return /windows nt/i.test(navigator.userAgent);
}

type AppsScriptBridgeMessage<T> = {
  channel?: string;
  id?: string;
  result?: T;
  error?: string;
};

const appsScriptBridgeFrames = new Map<string, Promise<HTMLIFrameElement>>();

function appsScriptBridgeFrame(scriptUrl: string) {
  const existing = appsScriptBridgeFrames.get(scriptUrl);
  if (existing) return existing;
  const pending = new Promise<HTMLIFrameElement>((resolve, reject) => {
    const frame = document.createElement("iframe");
    const timer = window.setTimeout(() => {
      frame.remove();
      appsScriptBridgeFrames.delete(scriptUrl);
      reject(new Error("Google Apps Script không phản hồi."));
    }, 20_000);
    frame.title = "GM-Manager Drive bridge";
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    frame.addEventListener("load", () => {
      window.clearTimeout(timer);
      resolve(frame);
    }, { once: true });
    frame.addEventListener("error", () => {
      window.clearTimeout(timer);
      frame.remove();
      appsScriptBridgeFrames.delete(scriptUrl);
      reject(new Error("Không thể mở cầu nối Google Apps Script."));
    }, { once: true });
    const bridgeUrl = new URL(scriptUrl);
    bridgeUrl.searchParams.set("gmcrm_bridge", "1");
    frame.src = bridgeUrl.toString();
    document.body.appendChild(frame);
  });
  appsScriptBridgeFrames.set(scriptUrl, pending);
  return pending;
}

async function postViaAppsScriptBridge<T>(scriptUrl: string, payload: Record<string, unknown>): Promise<T> {
  const frame = await appsScriptBridgeFrame(scriptUrl);
  return new Promise<T>((resolve, reject) => {
    const id = `gmcrm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeoutMs = String(payload.action || "").includes("audio") ? 180_000 : 90_000;
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener("message", receive);
    };
    const receive = (event: MessageEvent<AppsScriptBridgeMessage<T>>) => {
      if (event.source !== frame.contentWindow || event.data?.channel !== "gm-manager-apps-script-response" || event.data.id !== id) return;
      cleanup();
      if (event.data.error) reject(new Error(event.data.error));
      else if (event.data.result) resolve(event.data.result);
      else reject(new Error("Google Apps Script không trả về dữ liệu."));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Google Apps Script xử lý quá lâu. Hãy thử lại."));
    }, timeoutMs);
    window.addEventListener("message", receive);
    frame.contentWindow?.postMessage({ channel: "gm-manager-apps-script", id, payload }, "*");
  });
}

async function postToAppsScript<T extends { ok?: boolean; error?: string }>(config: DriveSyncConfig, payload: Record<string, unknown>): Promise<{ response: Response; result: T }> {
  if (!isAppsScriptUrl(config.scriptUrl)) throw new Error("Hãy kết nối Google Apps Script trước khi dùng Drive.");
  const requestPayload = { ...payload, token: deployedAppsScriptCompatibilityToken };
  const readAction = ["load-consulting", "list-workflow-files", "list-documents", "load-personnel"].includes(String(payload.action || ""));
  const retryLimit = readAction ? 4 : 2;
  let lastError: unknown;
  // Use the HtmlService bridge because ContentService's googleusercontent.com
  // redirect is not consistently CORS-readable from GitHub Pages.
  for (let attempt = 0; attempt < retryLimit; attempt += 1) {
    try {
      const result = await postViaAppsScriptBridge<T>(config.scriptUrl, requestPayload);
      return { response: new Response(JSON.stringify(result), { status: 200 }), result };
    } catch (error) {
      lastError = error;
      if (attempt === retryLimit - 1) throw error;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw lastError instanceof Error ? lastError : new Error("Không thể kết nối Google Apps Script.");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
  return btoa(binary);
}

function browserAudioMimeType(file: File) {
  if (file.type.startsWith("audio/")) return file.type;
  const extension = file.name.toLowerCase().split(".").pop();
  return ({ mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", flac: "audio/flac" } as Record<string, string>)[extension ?? ""] ?? "";
}

const syncedDriveFolders: DriveFolder[] = [
  { label: "-DATA", icon: "◫" },
  { label: "Ghi chú", icon: "✎" },
  { label: "Tư vấn", icon: "⌂" },
  { label: "Thiết kế", icon: "▣" },
  { label: "Dự toán", icon: "⌁" },
  { label: "Thi công", icon: "♧" },
  { label: "Nghiệm thu", icon: "✓" },
  { label: "Bảo hành", icon: "⚙" },
  { label: "Tài liệu", icon: "▱" },
  { label: "Nhân lực", icon: "♙" },
].filter((folder) => !folder.label.startsWith("-"));

const documentWorkOptions = ["Chưa gắn", "Tư vấn", "Thiết kế", "Dự toán", "Thi công", "Nghiệm thu", "Bảo hành"] as const;
const documentNatureOptions: DocumentNature[] = ["Chưa gắn", "Xuyên suốt", "Theo ngày"];
const isHiddenDocumentFile = (fileName: string) => /(?:\.(?:bak|dwl2?|sv\$|ac\$|tmp|lck|lock)|^~\$)/i.test(fileName.trim());


const personnelCategories: PersonnelCategory[] = [
  { id: "management", label: "Ban quản lý", icon: "♛", description: "Ban giám đốc và đội ngũ quản lý GM" },
  { id: "office", label: "Nhân viên văn phòng", icon: "▤", description: "Hành chính, kế toán, kinh doanh và thiết kế" },
  { id: "site", label: "Nhân viên công trình", icon: "⌂", description: "Chỉ huy, giám sát và điều phối công trình" },
  { id: "construction", label: "Nhân công xây dựng", icon: "♧", description: "Đội thi công, thợ xây và thợ hoàn thiện" },
  { id: "workshop", label: "Nhân công xưởng", icon: "▥", description: "Sản xuất, gia công và lắp đặt nội thất" },
  { id: "partner", label: "Đối tác", icon: "◇", description: "Nhà cung cấp, thầu phụ và đơn vị phối hợp" },
];

const initialYears: YearFolder[] = [
  { year: 2024, months: buildMonths() },
  { year: 2025, months: buildMonths() },
  { year: 2026, months: buildMonths() },
];

type DetailField = {
  code: string;
  label: string;
  options?: readonly string[];
};

const detailSections: Array<{ title: string; fields: DetailField[] }> = [
  {
    title: "1. Thông tin chủ đầu tư",
    fields: [
      { code: "HVT", label: "Họ và tên" },
      { code: "NS", label: "Ngày tháng năm sinh" },
      { code: "DC", label: "Địa chỉ" },
      { code: "SDT", label: "Số điện thoại/Zalo" },
      { code: "EMA", label: "Email" },
    ],
  },
  {
    title: "2. Thông tin nhu cầu",
    fields: [
      { code: "NCT-KT", label: "Nhu cầu thiết kế kiến trúc" },
      { code: "NCT-NT", label: "Nhu cầu thiết kế nội thất" },
      { code: "NCC-KT", label: "Nhu cầu thi công kiến trúc" },
      { code: "NCC-NT", label: "Nhu cầu thi công nội thất" },
      { code: "PC-KT", label: "Phong cách kiến trúc" },
      { code: "PC-NT", label: "Phong cách nội thất" },
      { code: "QCTC", label: "Quy cách thi công", options: ["Cải tạo", "Xây mới"] },
    ],
  },
  {
    title: "3. Thông tin thửa đất",
    fields: [
      { code: "QM", label: "Quy mô", options: ["Nhà lô", "Biệt thự", "Shophouse", "Kinh doanh", "Chung cư", "Dinh thự", "Tòa nhà"] },
      { code: "VTR", label: "Vị trí công trình" },
      { code: "HNH", label: "Hướng nhà", options: ["Đông", "Tây", "Nam", "Bắc", "Đông Bắc", "Đông Nam", "Tây Bắc", "Tây Nam"] },
      { code: "DTD", label: "Diện tích đất" },
      { code: "DTX", label: "Diện tích xây dựng" },
      { code: "VTMD", label: "Vị trí so với mặt đường" },
    ],
  },
];

const demandCheckboxCodes = new Set(["NCT-KT", "NCT-NT", "NCC-KT", "NCC-NT"]);
const dateDetailCodes = new Set(["NS"]);

const systemFields: DetailField[] = [
  { code: "D", label: "Điện" },
  { code: "N", label: "Nước" },
  { code: "E", label: "Năng lượng" },
  { code: "EL", label: "Thang máy" },
  { code: "DR", label: "Cửa" },
];

const roomOptions = ["Phòng khách", "Phòng ngủ", "Phòng bếp", "Gara", "Sân trước", "Sân sau", "Giếng trời", "Phòng thay đồ", "WC", "Sân phơi", "Sân thượng", "Phòng thờ", "Thang bộ", "Thang máy", "Phòng sinh hoạt chung", "Phòng xem phim", "Phòng xông hơi", "Phòng làm việc", "Phòng học", "Khu vực kinh doanh", "Phòng kho", "Phòng ngủ master", "WC master", "Phòng giúp việc"];

const architectureDesignProgressContents = [
  "Tư vấn concept",
  "Mặt bằng công năng",
  "3D lần 1",
  "3D lần 2",
  "3D lần 3",
  "Hồ sơ bổ kỹ thuật",
  "Nghiệm thu và bàn giao",
] as const;

const interiorDesignProgressContents = [
  "Kiểm tra và khớp MBCN",
  "Tư vấn concept nội thất",
  "3D lần 1",
  "3D lần 2",
  "3D lần 3",
  "Hồ sơ bổ kỹ thuật nội thất",
  "Nghiệm thu và bàn giao",
] as const;

const warrantyProgressContents = [
  "Ngày hoàn thành thi công nội thất",
  "Ngày hoàn thành thi công kiến trúc",
  "Thời gian bảo hành",
  "Chi phí bảo hành lần 1",
  "Chi phí bảo hành lần 2",
] as const;

type DesignProgressKind = "architecture" | "interior";

const designProgressDefinitions: Record<DesignProgressKind, {
  field: "designProgress" | "interiorDesignProgress";
  fixedContents: readonly string[];
  idPrefix: string;
  title: string;
  shortTitle: string;
  demandCode: "NCT-KT" | "NCT-NT";
}> = {
  architecture: {
    field: "designProgress",
    fixedContents: architectureDesignProgressContents,
    idPrefix: "design",
    title: "Tiến độ thiết kế kiến trúc",
    shortTitle: "Kiến trúc",
    demandCode: "NCT-KT",
  },
  interior: {
    field: "interiorDesignProgress",
    fixedContents: interiorDesignProgressContents,
    idPrefix: "interior-design",
    title: "Tiến độ thiết kế nội thất",
    shortTitle: "Nội thất",
    demandCode: "NCT-NT",
  },
};

type DesignDateKey = "plannedDate" | "actualDate";
type WarrantyDateKey = "reportedDate" | "completedDate";

const isFixedDesignContent = (content: string, kind: DesignProgressKind) => designProgressDefinitions[kind].fixedContents.some((item) => item === content);
const createFixedDesignRow = (content: string, index: number, kind: DesignProgressKind): DesignProgressRow => ({
  id: `${designProgressDefinitions[kind].idPrefix}-fixed-${index}`,
  isCustom: false,
  content,
  plannedDate: "",
  actualDate: "",
  assignee: "",
  note: "",
});
const createCustomDesignRow = (kind: DesignProgressKind): DesignProgressRow => ({
  id: `${designProgressDefinitions[kind].idPrefix}-custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  isCustom: true,
  content: "",
  plannedDate: "",
  actualDate: "",
  assignee: "",
  note: "",
});
const createDesignProgress = (kind: DesignProgressKind = "architecture"): DesignProgressRow[] => designProgressDefinitions[kind].fixedContents.map((content, index) => createFixedDesignRow(content, index, kind));
const normalizeDesignProgress = (record?: WorkRecord | null, kind: DesignProgressKind = "architecture"): DesignProgressRow[] => {
  const definition = designProgressDefinitions[kind];
  const existing = (record?.[definition.field] ?? []) as DesignProgressRow[];
  if (!existing.length) return createDesignProgress(kind);

  const normalized = existing.map((row, index) => {
    const isCustom = row.isCustom ?? !isFixedDesignContent(row.content ?? "", kind);
    return {
      id: row.id || `${definition.idPrefix}-${isCustom ? "custom" : "fixed"}-legacy-${index}`,
      isCustom,
      content: row.content ?? "",
      plannedDate: normalizeImportedDate(row.plannedDate ?? ""),
      actualDate: normalizeImportedDate(row.actualDate ?? ""),
      assignee: row.assignee ?? "",
      note: row.note ?? "",
    };
  });
  const existingFixed = new Set(normalized.filter((row) => !row.isCustom).map((row) => row.content));
  const missingFixed = definition.fixedContents
    .map((content, index) => createFixedDesignRow(content, index, kind))
    .filter((row) => !existingFixed.has(row.content));
  return [...normalized, ...missingFixed];
};

const isFixedWarrantyContent = (content: string) => warrantyProgressContents.some((item) => item === content);
const createFixedWarrantyRow = (content: string, index: number): WarrantyProgressRow => ({
  id: `warranty-fixed-${index}`,
  isCustom: false,
  content,
  reportedDate: "",
  completedDate: "",
  assignee: "",
  note: "",
});
const createCustomWarrantyRow = (): WarrantyProgressRow => ({
  id: `warranty-custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  isCustom: true,
  content: "",
  reportedDate: "",
  completedDate: "",
  assignee: "",
  note: "",
});
const createWarrantyProgress = (): WarrantyProgressRow[] => warrantyProgressContents.map(createFixedWarrantyRow);
const normalizeWarrantyProgress = (record?: WorkRecord | null): WarrantyProgressRow[] => {
  const existing = record?.warrantyProgress ?? [];
  if (!existing.length) return createWarrantyProgress();
  const normalized = existing.map((row, index) => {
    const isCustom = row.isCustom ?? !isFixedWarrantyContent(row.content ?? "");
    return {
      id: row.id || `warranty-${isCustom ? "custom" : "fixed"}-legacy-${index}`,
      isCustom,
      content: row.content ?? "",
      reportedDate: normalizeImportedDate(row.reportedDate ?? ""),
      completedDate: normalizeImportedDate(row.completedDate ?? ""),
      assignee: row.assignee ?? "",
      note: row.note ?? "",
    };
  });
  const existingFixed = new Set(normalized.filter((row) => !row.isCustom).map((row) => row.content));
  return [...normalized, ...warrantyProgressContents.map(createFixedWarrantyRow).filter((row) => !existingFixed.has(row.content))];
};

const formatDesignDateInput = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
};

const normalizeImportedDate = (value: string) => {
  const trimmed = String(value ?? "").trim();
  const serial = /^([2-7]\d{4})(?:\.0+)?$/.exec(trimmed);
  if (!serial) return trimmed;
  const date = new Date(Date.UTC(1899, 11, 30) + Number(serial[1]) * 86_400_000);
  return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
};

const parseDesignDate = (value: string) => {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { date, dayNumber: Math.floor(date.getTime() / 86_400_000) };
};

const hasSequentialDesignDates = (rows: DesignProgressRow[], key: DesignDateKey) => {
  let previousDay: number | null = null;
  for (const row of rows) {
    const parsed = parseDesignDate(row[key]);
    if (!parsed) continue;
    if (previousDay !== null && parsed.dayNumber < previousDay) return false;
    previousDay = parsed.dayNumber;
  }
  return true;
};

const hasSequentialWarrantyDates = (rows: WarrantyProgressRow[], key: WarrantyDateKey) => {
  let previousDay: number | null = null;
  for (const row of rows) {
    const parsed = parseDesignDate(row[key]);
    if (!parsed) continue;
    if (previousDay !== null && parsed.dayNumber < previousDay) return false;
    previousDay = parsed.dayNumber;
  }
  return true;
};

const designDateStatus = (row: DesignProgressRow) => {
  const planned = parseDesignDate(row.plannedDate);
  const actual = parseDesignDate(row.actualDate);
  if (!planned || !actual) return "unpaired";
  if (actual.dayNumber > planned.dayNumber) return "late";
  if (actual.dayNumber < planned.dayNumber) return "early";
  return "on-time";
};

const average = (values: number[]) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;

const analyzeDesignProgress = (rows: DesignProgressRow[]) => {
  const plannedRows = rows.map((row) => ({ row, parsed: parseDesignDate(row.plannedDate) })).filter((item) => item.parsed);
  const actualRows = rows.map((row) => ({ row, parsed: parseDesignDate(row.actualDate) })).filter((item) => item.parsed);
  const paired = rows.map((row) => {
    const planned = parseDesignDate(row.plannedDate);
    const actual = parseDesignDate(row.actualDate);
    return planned && actual ? { row, variance: actual.dayNumber - planned.dayNumber } : null;
  }).filter((item): item is { row: DesignProgressRow; variance: number } => Boolean(item));
  const current = getVietnamDate();
  const today = Math.floor(Date.UTC(current.year, current.month - 1, current.day) / 86_400_000);
  const overdue = rows.filter((row) => {
    const planned = parseDesignDate(row.plannedDate);
    return planned && planned.dayNumber < today && !parseDesignDate(row.actualDate);
  });
  const late = paired.filter((item) => item.variance > 0);
  const early = paired.filter((item) => item.variance < 0);
  const onTime = paired.filter((item) => item.variance === 0);
  const averageVariance = average(paired.map((item) => item.variance));
  const worst = [...paired].sort((a, b) => b.variance - a.variance)[0];
  const midpoint = Math.max(1, Math.floor(paired.length / 2));
  const firstTrend = average(paired.slice(0, midpoint).map((item) => item.variance));
  const lastTrend = average(paired.slice(midpoint).map((item) => item.variance));
  const trendDelta = lastTrend - firstTrend;
  const nextPlanned = plannedRows
    .filter(({ row, parsed }) => parsed && parsed.dayNumber >= today && !parseDesignDate(row.actualDate))
    .sort((a, b) => (a.parsed?.dayNumber ?? 0) - (b.parsed?.dayNumber ?? 0))[0];

  const coverageLine = plannedRows.length
    ? `Đã có ngày thực tế cho ${paired.length}/${plannedRows.length} mốc có kế hoạch; ${overdue.length} mốc đã quá hạn nhưng chưa ghi nhận hoàn thành.`
    : "Chưa có ngày dự kiến; cần nhập lịch cơ sở để bắt đầu đo chênh lệch tiến độ.";
  const varianceLine = paired.length
    ? `Kết quả hiện tại: ${late.length} mốc chậm, ${onTime.length} mốc đúng hạn, ${early.length} mốc sớm; chênh lệch trung bình ${averageVariance > 0 ? `chậm ${averageVariance.toFixed(1)}` : averageVariance < 0 ? `sớm ${Math.abs(averageVariance).toFixed(1)}` : "0"} ngày.`
    : "Chưa có cặp ngày dự kiến–thực tế hoàn chỉnh để tính độ trễ trung bình.";
  const worstLine = worst
    ? worst.variance > 0
      ? `Mốc chậm nhất là “${worst.row.content || "Chưa đặt tên"}”, muộn ${worst.variance} ngày so với kế hoạch.`
      : `Chưa có mốc hoàn thành muộn; mốc có biên độ thấp nhất là “${worst.row.content || "Chưa đặt tên"}” (${Math.abs(worst.variance)} ngày sớm).`
    : "Chưa xác định được mốc chậm nhất vì dữ liệu thực tế còn thiếu.";
  const trendLine = paired.length >= 4
    ? Math.abs(trendDelta) < 1
      ? "Độ lệch ở nửa sau gần như không đổi so với nửa đầu; xu hướng tiến độ đang ổn định."
      : trendDelta > 0
        ? `Độ trễ trung bình ở nửa sau tăng ${trendDelta.toFixed(1)} ngày; xu hướng đang xấu đi và cần tìm nguyên nhân ở các mốc gần đây.`
        : `Độ trễ trung bình ở nửa sau giảm ${Math.abs(trendDelta).toFixed(1)} ngày; tiến độ đang có dấu hiệu phục hồi.`
    : "Cần ít nhất 4 mốc có đủ hai ngày để đánh giá xu hướng trễ tăng hay giảm một cách hữu ích.";
  const actionLine = overdue.length
    ? `Ưu tiên cập nhật hoặc xử lý mốc “${overdue[0].content || "Chưa đặt tên"}”; đây là mốc quá hạn chưa có ngày thực tế.`
    : nextPlanned
      ? `Mốc kế tiếp cần theo dõi là “${nextPlanned.row.content || "Chưa đặt tên"}” vào ${nextPlanned.row.plannedDate}.`
      : actualRows.length && paired.length === plannedRows.length
        ? "Các mốc có kế hoạch đã được ghi nhận; nên xác nhận nguyên nhân và hành động khắc phục cho mọi mốc màu đỏ."
        : "Hãy hoàn thiện ngày dự kiến và ngày thực tế để hệ thống đưa ra cảnh báo hành động cụ thể.";
  return [coverageLine, varianceLine, worstLine, trendLine, actionLine];
};

const formatTimelineDate = (day: number) => new Date(day * 86_400_000).toLocaleDateString("vi-VN", { timeZone: "UTC", day: "2-digit", month: "2-digit" });
const shortenTimelineLabel = (value: string, maximum = 28) => value.length > maximum ? `${value.slice(0, maximum - 1)}…` : value;

function DesignTimelineChart({ rows, dateKey, title }: { rows: DesignProgressRow[]; dateKey: DesignDateKey; title: string }) {
  const timelineRows = rows.map((row) => ({
    row,
    selected: parseDesignDate(row[dateKey]),
  }));
  const allDays = rows.flatMap((row) => [parseDesignDate(row.plannedDate)?.dayNumber, parseDesignDate(row.actualDate)?.dayNumber]).filter((day): day is number => typeof day === "number");
  const datedCount = timelineRows.filter((item) => item.selected).length;

  if (!datedCount || !allDays.length) {
    return <article className="schedule-timeline schedule-timeline--empty"><div><h3>{title}</h3><p>Nhập {dateKey === "plannedDate" ? "ngày dự kiến" : "ngày thực tế"} để hiển thị đồ thị với trục thời gian và trục công việc.</p></div></article>;
  }

  const firstDay = Math.min(...allDays);
  const lastDay = Math.max(...allDays);
  const span = Math.max(1, lastDay - firstDay);
  const dayPadding = Math.max(1, Math.round(span * 0.07));
  const minimum = firstDay - dayPadding;
  const maximum = lastDay + dayPadding;
  const totalDays = Math.max(1, maximum - minimum);
  const chartWidth = 960;
  const chartHeight = Math.max(300, timelineRows.length * 52 + 112);
  const margins = { top: 30, right: 34, bottom: 64, left: 205 };
  const plotWidth = chartWidth - margins.left - margins.right;
  const plotHeight = chartHeight - margins.top - margins.bottom;
  const xForDay = (day: number) => margins.left + ((day - minimum) / totalDays) * plotWidth;
  const yForIndex = (index: number) => timelineRows.length === 1
    ? margins.top + plotHeight / 2
    : margins.top + (index / (timelineRows.length - 1)) * plotHeight;
  const tickCount = Math.min(6, Math.max(2, span + 1));
  const tickDays = Array.from({ length: tickCount }, (_, index) => minimum + (totalDays * index) / (tickCount - 1));
  const selectedPoints = timelineRows.flatMap(({ selected }, index) => selected ? [{ x: xForDay(selected.dayNumber), y: yForIndex(index) }] : []);

  return <article className="schedule-timeline">
    <header><div><h3>{title}</h3><p>Trục ngang: thời gian · Trục dọc: công việc</p></div><span>{datedCount}/{timelineRows.length} mốc</span></header>
    <div className="schedule-timeline__canvas" role="img" aria-label={`${title}, trục ngang là thời gian và trục dọc là công việc`}>
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="xMinYMin meet">
        <text className="schedule-timeline__axis-title" x={margins.left + plotWidth / 2} y={chartHeight - 12} textAnchor="middle">Thời gian</text>
        <text className="schedule-timeline__axis-title" transform={`translate(22 ${margins.top + plotHeight / 2}) rotate(-90)`} textAnchor="middle">Công việc</text>
        {tickDays.map((day, index) => <g key={`tick-${index}`}>
          <line className="schedule-timeline__vertical-grid" x1={xForDay(day)} x2={xForDay(day)} y1={margins.top} y2={margins.top + plotHeight} />
          <text className="schedule-timeline__tick" x={xForDay(day)} y={chartHeight - 33} textAnchor="middle">{formatTimelineDate(day)}</text>
        </g>)}
        {timelineRows.map(({ row }, index) => {
          const y = yForIndex(index);
          const label = row.content || "Chưa đặt tên";
          return <g key={row.id}>
            <line className="schedule-timeline__horizontal-grid" x1={margins.left} x2={margins.left + plotWidth} y1={y} y2={y} />
            <text className="schedule-timeline__work-label" x={margins.left - 16} y={y + 3} textAnchor="end"><title>{label}</title>{shortenTimelineLabel(label)}</text>
          </g>;
        })}
        <line className="schedule-timeline__axis" x1={margins.left} x2={margins.left + plotWidth} y1={margins.top + plotHeight} y2={margins.top + plotHeight} />
        <line className="schedule-timeline__axis" x1={margins.left} x2={margins.left} y1={margins.top} y2={margins.top + plotHeight} />
        {selectedPoints.length > 1 && <polyline className={`schedule-timeline__line schedule-timeline__line--${dateKey === "plannedDate" ? "planned" : "actual"}`} points={selectedPoints.map((point) => `${point.x},${point.y}`).join(" ")} />}
        {timelineRows.map(({ row, selected }, index) => selected && <circle key={`point-${dateKey}-${row.id}`} className={`schedule-timeline__point schedule-timeline__point--${dateKey === "plannedDate" ? "planned" : designDateStatus(row)}`} cx={xForDay(selected.dayNumber)} cy={yForIndex(index)} r="5"><title>{`${row.content || "Chưa đặt tên"}: ${dateKey === "plannedDate" ? "dự kiến" : "thực tế"} ${row[dateKey]}`}</title></circle>)}
      </svg>
    </div>
    <footer>{dateKey === "plannedDate"
      ? <span><i className="is-planned" /> Ngày dự kiến</span>
      : <><span><i className="is-late" /> Chậm</span><span><i className="is-early" /> Sớm</span><span><i className="is-on-time" /> Đúng hạn</span><span><i className="is-actual" /> Chưa đủ ngày để so sánh</span></>}
    </footer>
  </article>;
}

const createFunctionalRoom = (): FunctionalRoom => ({ id: `room-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, room: "", quantity: "", description: "" });
const createFunctionalFloor = (floor = "Tầng 1"): FunctionalFloor => ({ id: `floor-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, floor, rooms: [createFunctionalRoom()] });
const isBlankRoom = (room: FunctionalRoom) => !room.room.trim() && !room.quantity.trim() && !room.description.trim();
const withReadyRoom = (rooms: FunctionalRoom[]) => {
  const emptyRoom = rooms.find(isBlankRoom);
  return [...rooms.filter((room) => !isBlankRoom(room)), emptyRoom ?? createFunctionalRoom()];
};

function writeWavLabel(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

function createWavChunk(source: AudioBuffer, startSeconds: number, endSeconds: number) {
  const startFrame = Math.floor(startSeconds * source.sampleRate);
  const endFrame = Math.min(source.length, Math.ceil(endSeconds * source.sampleRate));
  const outputFrames = Math.max(1, Math.ceil((endFrame - startFrame) * AUDIO_OUTPUT_SAMPLE_RATE / source.sampleRate));
  const output = new ArrayBuffer(44 + outputFrames * 2);
  const view = new DataView(output);
  const channels = Array.from({ length: source.numberOfChannels }, (_, index) => source.getChannelData(index));

  writeWavLabel(view, 0, "RIFF");
  view.setUint32(4, 36 + outputFrames * 2, true);
  writeWavLabel(view, 8, "WAVE");
  writeWavLabel(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, AUDIO_OUTPUT_SAMPLE_RATE, true);
  view.setUint32(28, AUDIO_OUTPUT_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeWavLabel(view, 36, "data");
  view.setUint32(40, outputFrames * 2, true);

  for (let outputFrame = 0; outputFrame < outputFrames; outputFrame += 1) {
    const sourceFrame = Math.min(endFrame - 1, startFrame + Math.floor(outputFrame * source.sampleRate / AUDIO_OUTPUT_SAMPLE_RATE));
    const sample = channels.reduce((total, channel) => total + channel[sourceFrame], 0) / channels.length;
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + outputFrame * 2, Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), true);
  }
  return new Blob([output], { type: "audio/wav" });
}

function chunkFileName(fileName: string, index: number) {
  const stem = fileName.replace(/\.[^.]+$/, "") || "ghi-am";
  return `${stem}-phan-${String(index + 1).padStart(2, "0")}.wav`;
}

async function splitAudioForProcessing(file: File): Promise<AudioChunk[]> {
  // Tiny files go through intact. Larger recordings are converted to short,
  // mono WAV chunks so each browser request stays below the hosting limit.
  if (file.size <= MAX_DIRECT_AUDIO_BYTES) return [{ file, offsetSeconds: 0 }];

  const browserWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
  const AudioContextConstructor = window.AudioContext ?? browserWindow.webkitAudioContext;
  if (!AudioContextConstructor) throw new Error("Trình duyệt này không thể tự tách file ghi âm. Hãy dùng Chrome hoặc Edge.");

  const context = new AudioContextConstructor();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const chunks: AudioChunk[] = [];
    for (let startSeconds = 0; startSeconds < buffer.duration; startSeconds += MAX_AUDIO_CHUNK_SECONDS) {
      const endSeconds = Math.min(buffer.duration, startSeconds + MAX_AUDIO_CHUNK_SECONDS);
      const wav = createWavChunk(buffer, startSeconds, endSeconds);
      chunks.push({
        file: new File([wav], chunkFileName(file.name, chunks.length), { type: "audio/wav" }),
        offsetSeconds: startSeconds,
      });
    }
    return chunks;
  } catch {
    throw new Error("Không thể tách file này. Hãy dùng MP3, WAV, M4A, AAC, OGG hoặc FLAC được phát được trên trình duyệt.");
  } finally {
    void context.close();
  }
}

function parseAudioTime(value: string) {
  const parts = value.trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
}

function formatAudioTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function normalizeAudioNoteChunks(note: AudioNote): AudioNoteChunk[] {
  if (note.chunks?.length) return [...note.chunks].sort((a, b) => a.index - b.index);
  if (!note.segments.length) return [];
  return [{ index: 0, segments: note.segments }];
}

function buildAudioNote(previous: AudioNote, chunks: AudioNoteChunk[], language?: string): AudioNote {
  const orderedChunks = [...chunks].sort((a, b) => a.index - b.index);
  const completedChunks = orderedChunks.reduce((completed, chunk) => chunk.index === completed ? completed + 1 : completed, 0);
  const totalChunks = Math.max(previous.totalChunks ?? orderedChunks.length, orderedChunks.length);
  return {
    ...previous,
    language: language || previous.language || "Tiếng Việt",
    updatedAt: new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()),
    chunks: orderedChunks,
    completedChunks,
    totalChunks,
    status: completedChunks >= totalChunks ? "complete" : "processing",
    segments: orderedChunks.flatMap((chunk) => chunk.segments),
  };
}

function quotaRetrySeconds(message: string) {
  if (!/quota|rate.?limit|resource.?exhausted/i.test(message)) return null;
  const match = /retry\s+in\s+([\d.]+)s/i.exec(message);
  return Math.max(10, Math.ceil(Number(match?.[1] || 60)) + 3);
}

async function waitForAudioQuota(seconds: number, update: (remaining: number) => void) {
  for (let remaining = seconds; remaining > 0; remaining -= 1) {
    update(remaining);
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
}

const normalizeFunctionalFloors = (record: WorkRecord): FunctionalFloor[] => {
  if (record.functionalFloors?.length) {
    return record.functionalFloors.map((floor) => ({ ...floor, rooms: withReadyRoom(floor.rooms ?? []) }));
  }

  const legacyRows = record.functionalRows ?? [];
  if (!legacyRows.length) return [createFunctionalFloor()];
  const floors = legacyRows.reduce<FunctionalFloor[]>((groups, row) => {
    const floorName = row.floor?.trim() || "Tầng 1";
    const group = groups.find((item) => item.floor === floorName);
    const room = { id: row.id, room: row.room ?? "", quantity: row.quantity ?? "", description: row.description ?? "" };
    if (group) group.rooms.push(room);
    else groups.push({ id: `floor-${row.id}`, floor: floorName, rooms: [room] });
    return groups;
  }, []);
  return floors.map((floor) => ({ ...floor, rooms: withReadyRoom(floor.rooms) }));
};

const normalizeSearchText = (value: string) => value
  .toLocaleLowerCase("vi")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replaceAll("đ", "d")
  .trim();

const getRoomSuggestions = (query: string) => {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2 || query.trim().startsWith("@")) return [];

  return roomOptions
    .map((room, index) => {
      const normalizedRoom = normalizeSearchText(room);
      const matches = normalizedRoom.includes(normalizedQuery) || normalizedQuery.split(/\s+/).every((word) => normalizedRoom.includes(word));
      const score = normalizedRoom.startsWith(normalizedQuery) ? 0 : normalizedRoom.includes(normalizedQuery) ? 1 : 2;
      return { room, index, matches, score };
    })
    .filter((result) => result.matches)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, 8)
    .map((result) => result.room);
};

function getVietnamDate() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(new Date());
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { day: value("day"), month: value("month"), year: value("year") };
}

function nameInitials(name: string) {
  const words = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[A-Za-z0-9]+/g);
  return (words?.map((word) => word.charAt(0)).join("").toUpperCase() || "KH").slice(0, 6);
}

function normalizePersonnelPhone(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const scientific = raw.replace(/\s/g, "");
  if (/^\d+(?:\.\d+)?e\+?\d+$/i.test(scientific)) {
    const numeric = Number(scientific);
    if (Number.isFinite(numeric)) {
      let digits = Math.trunc(numeric).toFixed(0);
      if (digits.length === 9 && /^[2-9]/.test(digits)) digits = `0${digits}`;
      return digits;
    }
  }
  const normalizedRaw = /^\d+\.0+$/.test(scientific) ? scientific.replace(/\.0+$/, "") : raw;
  const compact = normalizedRaw.replace(/[\s.-]/g, "");
  if (/^\+?\d+$/.test(compact)) {
    const prefix = compact.startsWith("+") ? "+" : "";
    let digits = compact.replace(/^\+/, "");
    if (!prefix && digits.length === 9 && /^[2-9]/.test(digits)) digits = `0${digits}`;
    return `${prefix}${digits}`;
  }
  return raw;
}

function normalizePersonnelMap(value: Record<string, PersonnelMember[]>) {
  return Object.fromEntries(Object.entries(value ?? {}).map(([category, members]) => [category, (Array.isArray(members) ? members : []).map((member) => ({
    ...member,
    status: personnelStatuses.includes(member.status) ? member.status : "Có",
    phone: normalizePersonnelPhone(member.phone),
  }))]));
}

function saveWorkspace(years: YearFolder[]) {
  window.localStorage.setItem("gm-manager-consulting", JSON.stringify(years));
}

function readDriveCache<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = window.localStorage.getItem(`${driveCachePrefix}${key}`);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { savedAt?: number; value?: T };
    if (!cached.savedAt || Date.now() - cached.savedAt > maxAgeMs) {
      window.localStorage.removeItem(`${driveCachePrefix}${key}`);
      return null;
    }
    return cached.value ?? null;
  } catch {
    return null;
  }
}

function writeDriveCache<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(`${driveCachePrefix}${key}`, JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    // Storage can be unavailable or full. Drive loading still works normally.
  }
}

function removeDriveCache(key: string) {
  try {
    window.localStorage.removeItem(`${driveCachePrefix}${key}`);
  } catch {
    // Cache removal is optional; the server result remains authoritative.
  }
}

function isDriveCacheFresh(key: string, maxAgeMs: number) {
  try {
    const raw = window.localStorage.getItem(`${driveCachePrefix}${key}`);
    if (!raw) return false;
    const cached = JSON.parse(raw) as { savedAt?: number };
    return Boolean(cached.savedAt && Date.now() - cached.savedAt <= maxAgeMs);
  } catch {
    return false;
  }
}

function preserveDriveRecordMetadata(driveYears: YearFolder[], localYears: YearFolder[]) {
  const localByProjectId = new Map(localYears.flatMap((year) => year.months.flatMap((month) => month.records)).map((record) => [record.projectId, record]));
  const driveByYear = new Map(driveYears.map((year) => [year.year, year]));
  const localByYear = new Map(localYears.map((year) => [year.year, year]));
  const mergedYears = Array.from(new Set([...localYears.map((year) => year.year), ...driveYears.map((year) => year.year)])).sort((a, b) => a - b);
  return mergedYears.map((yearNumber) => {
    const driveYear = driveByYear.get(yearNumber);
    const localYear = localByYear.get(yearNumber);
    return {
      year: yearNumber,
      months: monthLabels.map((label, index) => {
        const driveMonth = driveYear?.months?.find((month) => month.label === label);
        const localMonth = localYear?.months?.find((month) => month.label === label) ?? localYear?.months?.[index] ?? { label, records: [] };
        if (!driveMonth) return localMonth;
      return {
        label,
        records: (driveMonth.records ?? []).map((record) => {
          const localRecord = localByProjectId.get(record.projectId);
          return {
            ...record,
            id: record.id || `drive-${record.projectId}`,
            name: record.name || localRecord?.name || record.details?.HVT || record.projectId,
            houseId: record.houseId || localRecord?.houseId || "",
            details: record.isHydrated ? record.details ?? {} : localRecord?.details ?? record.details ?? {},
            isHydrated: record.isHydrated ?? localRecord?.isHydrated ?? false,
            designProgress: record.isHydrated ? record.designProgress ?? createDesignProgress() : localRecord?.designProgress ?? record.designProgress ?? createDesignProgress(),
            interiorDesignProgress: record.isHydrated ? record.interiorDesignProgress ?? createDesignProgress("interior") : localRecord?.interiorDesignProgress ?? record.interiorDesignProgress ?? createDesignProgress("interior"),
            warrantyProgress: record.isHydrated ? record.warrantyProgress ?? createWarrantyProgress() : localRecord?.warrantyProgress ?? record.warrantyProgress ?? createWarrantyProgress(),
          };
        }),
      };
      }),
    };
  });
}

export default function Home() {
  const now = getVietnamDate();
  const [activeFolder, setActiveFolder] = useState("Tư vấn");
  const [years, setYears] = useState<YearFolder[]>(initialYears);
  const [selectedYear, setSelectedYear] = useState(now.year);
  const [selectedMonth, setSelectedMonth] = useState(now.month);
  const [search, setSearch] = useState("");
  const [personnelSearch, setPersonnelSearch] = useState("");
  const [selectedPersonnelCategoryId, setSelectedPersonnelCategoryId] = useState<string | null>(null);
  const [personnelByCategory, setPersonnelByCategory] = useState<Record<string, PersonnelMember[]>>({});
  const [personnelAddOpen, setPersonnelAddOpen] = useState(false);
  const [editingPersonnelId, setEditingPersonnelId] = useState<string | null>(null);
  const [personnelMenuId, setPersonnelMenuId] = useState<string | null>(null);
  const [loadingPersonnel, setLoadingPersonnel] = useState(false);
  const [personnelDraft, setPersonnelDraft] = useState<Omit<PersonnelMember, "id">>({ status: "Có", name: "", birthDate: "", phone: "", role: "", address: "" });
  const [consultingSearch, setConsultingSearch] = useState("");
  const [workflowSearch, setWorkflowSearch] = useState("");
  const [selectedCustomerProjectId, setSelectedCustomerProjectId] = useState<string | null>(null);
  const [personnelView, setPersonnelView] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [modalMonth, setModalMonth] = useState(now.month);
  const [modalYear, setModalYear] = useState(now.year);
  const [customerName, setCustomerName] = useState("");
  const [houseId, setHouseId] = useState("");
  const [notice, setNotice] = useState("");
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const [mobileInstallHelp, setMobileInstallHelp] = useState<"ios" | "android" | "desktop" | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [protectedAction, setProtectedAction] = useState<{ type: "rename" | "delete"; record: WorkRecord } | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [roomSuggestionFor, setRoomSuggestionFor] = useState<string | null>(null);
  const [driveConfigOpen, setDriveConfigOpen] = useState(false);
  const [driveScriptUrl, setDriveScriptUrl] = useState(defaultDriveSyncConfig.scriptUrl);
  const [syncingRecordId, setSyncingRecordId] = useState<string | null>(null);
  const [syncingDesignId, setSyncingDesignId] = useState<string | null>(null);
  const [syncingWarrantyId, setSyncingWarrantyId] = useState<string | null>(null);
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);
  const [workflowFilesByFolder, setWorkflowFilesByFolder] = useState<Record<string, WorkflowFile[]>>({});
  const [loadingWorkflowFiles, setLoadingWorkflowFiles] = useState(false);
  const [workflowFilesError, setWorkflowFilesError] = useState("");
  const [uploadingWorkflowFiles, setUploadingWorkflowFiles] = useState(false);
  const [documentSnapshots, setDocumentSnapshots] = useState<DocumentSnapshot[]>([]);
  const [selectedDocumentSnapshotId, setSelectedDocumentSnapshotId] = useState("");
  const [expandedDocumentSnapshotId, setExpandedDocumentSnapshotId] = useState("");
  const [loadedDocumentSnapshotId, setLoadedDocumentSnapshotId] = useState("");
  const [documentFiles, setDocumentFiles] = useState<DocumentFile[]>([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [documentSnapshotActionId, setDocumentSnapshotActionId] = useState<string | null>(null);
  const [documentsError, setDocumentsError] = useState("");
  const [loadingCustomerId, setLoadingCustomerId] = useState<string | null>(null);
  const [audioProcessingId, setAudioProcessingId] = useState<string | null>(null);
  const [audioProcessingStatus, setAudioProcessingStatus] = useState("");
  const driveSyncTimer = useRef<number | null>(null);
  const designSyncTimers = useRef<Partial<Record<DesignProgressKind, number>>>({});
  const warrantySyncTimer = useRef<number | null>(null);
  const customerSearchTimer = useRef<number | null>(null);
  const driveRequestsInFlight = useRef(new Set<string>());
  const serviceWorkerRegistration = useRef<ServiceWorkerRegistration | null>(null);

  useEffect(() => {
    const currentDate = getVietnamDate();
    setSelectedYear(currentDate.year);
    setSelectedMonth(currentDate.month);
    setModalYear(currentDate.year);
    setModalMonth(currentDate.month);

    const savedWorkspace = window.localStorage.getItem("gm-manager-consulting");
    if (savedWorkspace) {
      try {
        setYears(JSON.parse(savedWorkspace) as YearFolder[]);
      } catch {
        window.localStorage.removeItem("gm-manager-consulting");
      }
    }

    const savedConfig = window.localStorage.getItem(driveSyncConfigKey);
    if (savedConfig) {
      try {
        const config = JSON.parse(savedConfig) as Partial<DriveSyncConfig>;
        const nextUrl = !config.scriptUrl || retiredDriveScriptUrls.has(config.scriptUrl) ? defaultDriveSyncConfig.scriptUrl : config.scriptUrl;
        setDriveScriptUrl(nextUrl);
        if (nextUrl !== config.scriptUrl) window.localStorage.setItem(driveSyncConfigKey, JSON.stringify({ scriptUrl: nextUrl }));
        return;
      } catch {
        window.localStorage.removeItem(driveSyncConfigKey);
      }
    }
    setDriveScriptUrl(defaultDriveSyncConfig.scriptUrl);
  }, []);

  useEffect(() => {
    try {
      const savedPersonnel = window.localStorage.getItem(personnelStorageKey);
      if (savedPersonnel) setPersonnelByCategory(normalizePersonnelMap(JSON.parse(savedPersonnel) as Record<string, PersonnelMember[]>));
    } catch {
      window.localStorage.removeItem(personnelStorageKey);
    }
  }, []);

  useEffect(() => {
    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    const updateInstallState = () => setIsAppInstalled(Boolean(desktopBridge()) || standaloneQuery.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredInstallPrompt(event as InstallPromptEvent);
    };
    const markInstalled = () => {
      setIsAppInstalled(true);
      setDeferredInstallPrompt(null);
    };
    updateInstallState();
    if ("Notification" in window) setNotificationPermission(Notification.permission);
    let reloadingForWorker = false;
    const markWorkerUpdate = () => {
      setUpdateAvailable(true);
      setNotice("GM-CRM có bản mới. Nhấn Cập nhật ngay để sử dụng.");
    };
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((registration) => {
        serviceWorkerRegistration.current = registration;
        if (registration.waiting && navigator.serviceWorker.controller) markWorkerUpdate();
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) markWorkerUpdate();
          });
        });
        void registration.update();
      }).catch(() => undefined);
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (reloadingForWorker) return;
        reloadingForWorker = true;
        window.location.reload();
      });
    }
    const checkPublishedVersion = async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}app-version.json?time=${Date.now()}`, { cache: "no-store" });
        const published = await response.json() as { version?: string };
        if (APP_VERSION !== "development" && published.version && published.version !== APP_VERSION) markWorkerUpdate();
      } catch { /* Version checks are best effort while offline. */ }
    };
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void checkPublishedVersion();
        void serviceWorkerRegistration.current?.update();
      }
    };
    void checkPublishedVersion();
    const versionTimer = window.setInterval(checkPublishedVersion, 10 * 60 * 1000);
    document.addEventListener("visibilitychange", checkWhenVisible);
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", markInstalled);
    standaloneQuery.addEventListener("change", updateInstallState);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", markInstalled);
      standaloneQuery.removeEventListener("change", updateInstallState);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      window.clearInterval(versionTimer);
    };
  }, []);

  const activeDriveFolder = syncedDriveFolders.find((folder) => folder.label === activeFolder);
  const activeYear = years.find((folder) => folder.year === selectedYear);
  const activeMonthFolder = activeYear?.months[selectedMonth - 1];
  const isDriveConnected = Boolean(driveScriptUrl.trim());
  const availableModalYears = useMemo(() => {
    const currentYear = getVietnamDate().year;
    return Array.from(new Set([...years.map((folder) => folder.year), ...Array.from({ length: 9 }, (_, index) => currentYear - 3 + index)])).sort((a, b) => a - b);
  }, [years]);
  const customerLocations = useMemo<CustomerLocation[]>(() => years.flatMap((yearFolder) => yearFolder.months.flatMap((monthFolder, monthIndex) => (
    monthFolder.records.map((record) => ({ record, year: yearFolder.year, month: monthIndex + 1 }))
  ))).sort((a, b) => b.year - a.year || b.month - a.month || a.record.name.localeCompare(b.record.name, "vi")), [years]);
  const customerSearchResults = useMemo(() => {
    const term = normalizeSearchText(search.trim());
    const periodCustomers = customerLocations.filter((location) => location.year === selectedYear && location.month === selectedMonth);
    return (term ? periodCustomers.filter(({ record }) => normalizeSearchText(`${record.name} ${record.houseId ?? ""} ${record.projectId}`).includes(term)) : periodCustomers).slice(0, 24);
  }, [customerLocations, search, selectedMonth, selectedYear]);
  const workflowSearchResults = useMemo(() => {
    const term = normalizeSearchText(workflowSearch.trim());
    if (!term) return [];
    return customerLocations.filter(({ record }) => normalizeSearchText(`${record.name} ${record.houseId ?? ""} ${record.projectId}`).includes(term)).slice(0, 8);
  }, [customerLocations, workflowSearch]);
  const selectedCustomerLocation = customerLocations.find(({ record }) => record.projectId === selectedCustomerProjectId) ?? null;
  const selectCustomer = ({ record, year, month }: CustomerLocation) => {
    setSelectedCustomerProjectId(record.projectId);
    setSelectedYear(year);
    setSelectedMonth(month);
    setActiveFolder("Tư vấn");
    setPersonnelView(false);
    setSelectedRecordId(null);
    setOpenMenuId(null);
    setSearch("");
    setConsultingSearch("");
    setWorkflowSearch("");
    setDocumentSnapshots([]);
    setSelectedDocumentSnapshotId("");
    setExpandedDocumentSnapshotId("");
    setLoadedDocumentSnapshotId("");
    setDocumentFiles([]);
    setDocumentsError("");
    void loadCustomerDetailsFromDrive({ record, year, month });
  };

  const selectCustomerForWorkflow = ({ record, year, month }: CustomerLocation) => {
    setSelectedCustomerProjectId(record.projectId);
    setSelectedYear(year);
    setSelectedMonth(month);
    setPersonnelView(false);
    setSelectedRecordId(null);
    setOpenMenuId(null);
    setSearch("");
    setConsultingSearch("");
    setWorkflowSearch("");
    setDocumentSnapshots([]);
    setSelectedDocumentSnapshotId("");
    setExpandedDocumentSnapshotId("");
    setLoadedDocumentSnapshotId("");
    setDocumentFiles([]);
    setDocumentsError("");
    void loadCustomerDetailsFromDrive({ record, year, month });
  };

  const returnToCustomerSearch = () => {
    const currentDate = getVietnamDate();
    setSelectedCustomerProjectId(null);
    setSelectedRecordId(null);
    setOpenMenuId(null);
    setActiveFolder("Tư vấn");
    setSelectedYear(currentDate.year);
    setSelectedMonth(currentDate.month);
    setSearch("");
    setConsultingSearch("");
    setWorkflowSearch("");
  };

  const installGMCRM = async () => {
    if (isAppInstalled) {
      setNotice("GM-CRM đã được cài trên thiết bị này.");
      return;
    }
    if (isWindowsDesktop()) {
      setNotice("Đang tải bộ cài GM-CRM cho Windows…");
      window.location.assign(windowsInstallerUrl);
      return;
    }
    if (deferredInstallPrompt) {
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === "accepted") setNotice("Đã cài GM-CRM lên màn hình chính.");
      setDeferredInstallPrompt(null);
      return;
    }
    const isAppleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isAppleMobile) {
      setMobileInstallHelp("ios");
      return;
    }
    const isMobile = /android|mobile/i.test(navigator.userAgent);
    setMobileInstallHelp(isMobile ? "android" : "desktop");
  };

  const updateGMCRM = () => {
    const waitingWorker = serviceWorkerRegistration.current?.waiting;
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
      return;
    }
    window.location.reload();
  };

  const sendTestNotification = async () => {
    const desktop = desktopBridge();
    if (desktop) {
      const shown = await desktop.showNotification({
        title: "GM-CRM",
        body: "Thông báo trên Windows đã được bật thành công.",
        url: `${import.meta.env.BASE_URL}`,
      });
      if (shown) {
        setNotificationPermission("granted");
        setNotice("Đã bật và gửi thông báo thử trên Windows.");
        return;
      }
    }
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setNotificationPermission("unsupported");
      setNotice("Trình duyệt này chưa hỗ trợ thông báo ứng dụng.");
      return;
    }
    let permission = Notification.permission;
    if (permission === "default") permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    if (permission !== "granted") {
      setNotice("Bạn cần cho phép thông báo trong cài đặt trình duyệt.");
      return;
    }
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification("GM-CRM", {
      body: "Thông báo trên điện thoại đã được bật thành công.",
      icon: `${import.meta.env.BASE_URL}gm-logo.png`,
      badge: `${import.meta.env.BASE_URL}gm-logo.png`,
      tag: "gm-crm-notification-test",
      data: { url: `${import.meta.env.BASE_URL}` },
    });
    setNotice("Đã gửi thông báo thử đến thiết bị này.");
  };

  const renderMobileAppActions = () => <>
    {updateAvailable && <button type="button" className="pwa-action pwa-action--update" onClick={updateGMCRM}>↻ Cập nhật ngay</button>}
    {!isAppInstalled && <button type="button" className="pwa-action" onClick={() => void installGMCRM()}>⇩ Cài ứng dụng</button>}
    <button type="button" className="pwa-action" onClick={() => void sendTestNotification()}>{notificationPermission === "granted" ? "◉ Thông báo thử" : isWindowsDesktop() ? "◌ Bật thông báo PC" : "◌ Bật thông báo"}</button>
  </>;

  const persist = (nextYears: YearFolder[]) => {
    setYears(nextYears);
    saveWorkspace(nextYears);
  };

  const persistRecord = (record: WorkRecord, year: number, month: number) => {
    writeDriveCache(`detail:${year}:${month}:${record.projectId}`, record);
    setYears((currentYears) => {
      const nextYears = currentYears.map((yearFolder) => yearFolder.year !== year ? yearFolder : {
        ...yearFolder,
        months: yearFolder.months.map((monthFolder, index) => index !== month - 1 ? monthFolder : {
          ...monthFolder,
          records: monthFolder.records.map((currentRecord) => currentRecord.projectId === record.projectId ? record : currentRecord),
        }),
      });
      saveWorkspace(nextYears);
      return nextYears;
    });
  };

  const loadWorkspaceFromDrive = async (configOverride?: DriveSyncConfig, quietly = false, options: { mode?: DriveLoadMode; year?: number; month?: number; query?: string; projectId?: string; force?: boolean } = {}) => {
    const config = configOverride ?? { scriptUrl: driveScriptUrl.trim() };
    if (!config.scriptUrl) return;
    const mode = options.mode ?? "index";
    const year = options.year ?? selectedYear;
    const month = options.month ?? selectedMonth;
    const cacheKey = `workspace:${mode}:${year}:${month}:${options.projectId ?? ""}:${normalizeSearchText(options.query ?? "")}`;
    const cacheAge = mode === "index" ? DRIVE_INDEX_CACHE_MS : mode === "search" ? DRIVE_SEARCH_CACHE_MS : 0;
    if (!options.force && cacheAge) {
      const cachedYears = readDriveCache<YearFolder[]>(cacheKey, cacheAge);
      if (cachedYears) {
        persist(preserveDriveRecordMetadata(cachedYears, years));
        return;
      }
    }
    if (driveRequestsInFlight.current.has(cacheKey)) return;
    driveRequestsInFlight.current.add(cacheKey);
    setIsLoadingDrive(true);
    try {
      const { response, result } = await postToAppsScript<{ ok?: boolean; error?: string; years?: YearFolder[] }>(config, { action: "load-consulting", mode, year, month, query: options.query, projectId: options.projectId, refresh: Boolean(options.force) });
      if (!response.ok || !result.ok || !result.years) throw new Error(result.error || "Không thể nạp dữ liệu Excel từ Drive.");
      if (cacheAge) writeDriveCache(cacheKey, result.years);
      const driveYears = preserveDriveRecordMetadata(result.years, years);
      if (driveYears.length) {
        persist(driveYears);
        if (!quietly) setNotice(mode === "search" ? "Đã tìm thêm hồ sơ phù hợp trên Drive." : `Đã nạp danh sách khách hàng T${month}/${year} từ Drive.`);
      }
    } catch (error) {
      if (!quietly) setNotice(error instanceof Error ? error.message : "Không thể nạp dữ liệu Excel từ Drive.");
    } finally {
      driveRequestsInFlight.current.delete(cacheKey);
      setIsLoadingDrive(false);
    }
  };

  useEffect(() => {
    const currentDate = getVietnamDate();
    const config = { scriptUrl: driveScriptUrl.trim() };
    if (!config.scriptUrl) return;
    const refreshWorkspace = (force = false) => {
      if (document.visibilityState === "visible") void loadWorkspaceFromDrive(config, true, { mode: "index", year: getVietnamDate().year, month: getVietnamDate().month, force });
    };
    // The cached workspace is used immediately. Drive is contacted only after
    // fifteen minutes (or from the explicit Nạp lại Drive button).
    void loadWorkspaceFromDrive(config, true, { mode: "index", year: currentDate.year, month: currentDate.month });
    const refreshTimer = window.setInterval(() => refreshWorkspace(true), DRIVE_INDEX_CACHE_MS);
    return () => window.clearInterval(refreshTimer);
  }, [driveScriptUrl]);

  const loadCustomerDetailsFromDrive = async (location: CustomerLocation) => {
    const config = { scriptUrl: driveScriptUrl.trim() };
    if (!config.scriptUrl) return;
    const cacheKey = `detail:${location.year}:${location.month}:${location.record.projectId}`;
    const cachedRecord = readDriveCache<WorkRecord>(cacheKey, DRIVE_DETAIL_CACHE_MS);
    if (cachedRecord) {
      persistRecord({ ...cachedRecord, isHydrated: true }, location.year, location.month);
      return;
    }
    setLoadingCustomerId(location.record.projectId);
    try {
      const { response, result } = await postToAppsScript<{ ok?: boolean; error?: string; record?: WorkRecord }>(config, { action: "load-consulting", mode: "detail", year: location.year, month: location.month, projectId: location.record.projectId, includeProgress: false });
      if (!response.ok || !result.ok || !result.record) throw new Error(result.error || "Không thể nạp chi tiết hồ sơ.");
      const hydratedRecord = {
        ...location.record,
        ...result.record,
        designProgress: result.record.designProgress ?? location.record.designProgress,
        interiorDesignProgress: result.record.interiorDesignProgress ?? location.record.interiorDesignProgress,
        warrantyProgress: result.record.warrantyProgress ?? location.record.warrantyProgress,
        progressHydrated: result.record.progressHydrated ?? location.record.progressHydrated ?? false,
        isHydrated: true,
      };
      writeDriveCache(cacheKey, hydratedRecord);
      persistRecord(hydratedRecord, location.year, location.month);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể nạp chi tiết hồ sơ.");
    } finally {
      setLoadingCustomerId(null);
    }
  };

  const loadCustomerProgressFromDrive = async (location: CustomerLocation) => {
    const config = { scriptUrl: driveScriptUrl.trim() };
    if (!config.scriptUrl || location.record.progressHydrated) return;
    const cacheKey = `progress:${location.year}:${location.month}:${location.record.projectId}`;
    const cached = readDriveCache<Pick<WorkRecord, "designProgress" | "interiorDesignProgress" | "warrantyProgress" | "progressHydrated">>(cacheKey, DRIVE_PROGRESS_CACHE_MS);
    if (cached) {
      persistRecord({ ...location.record, ...cached, progressHydrated: true }, location.year, location.month);
      return;
    }
    if (driveRequestsInFlight.current.has(cacheKey)) return;
    driveRequestsInFlight.current.add(cacheKey);
    try {
      const { response, result } = await postToAppsScript<{ ok?: boolean; error?: string; record?: WorkRecord }>(config, {
        action: "load-consulting",
        mode: "progress",
        year: location.year,
        month: location.month,
        projectId: location.record.projectId,
      });
      if (!response.ok || !result.ok || !result.record) throw new Error(result.error || "Không thể nạp tiến độ hồ sơ.");
      const progress = {
        designProgress: result.record.designProgress,
        interiorDesignProgress: result.record.interiorDesignProgress,
        warrantyProgress: result.record.warrantyProgress,
        progressHydrated: true,
      };
      writeDriveCache(cacheKey, progress);
      persistRecord({ ...location.record, ...progress }, location.year, location.month);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể nạp tiến độ hồ sơ.");
    } finally {
      driveRequestsInFlight.current.delete(cacheKey);
    }
  };

  const workflowFilesCacheKey = (folder: string, location = selectedCustomerLocation) => location ? `${location.year}-${location.month}-${location.record.projectId}-${folder}` : "";
  const loadWorkflowFiles = async (folder = activeFolder, quietly = true, refresh = false) => {
    if (!selectedCustomerLocation || !driveScriptUrl.trim()) return;
    const cacheKey = workflowFilesCacheKey(folder);
    const clientCacheKey = `files:${cacheKey}`;
    const cachedFiles = readDriveCache<WorkflowFile[]>(clientCacheKey, DRIVE_FILE_LIST_CACHE_MS);
    const cacheIsFresh = isDriveCacheFresh(clientCacheKey, DRIVE_FILE_LIST_FRESH_MS);
    const hasCachedFiles = cachedFiles !== null;
    if (cachedFiles && !refresh) {
      setWorkflowFilesByFolder((current) => ({ ...current, [cacheKey]: cachedFiles }));
    }
    if (cacheIsFresh && !refresh) return;
    if (driveRequestsInFlight.current.has(clientCacheKey)) return;
    driveRequestsInFlight.current.add(clientCacheKey);
    // A stale cached list remains usable while the new metadata is fetched.
    // Only show a blocking loading state when this device has no cache yet.
    setLoadingWorkflowFiles(!hasCachedFiles);
    setWorkflowFilesError("");
    try {
      const { response, result } = await postToAppsScript<{ ok?: boolean; error?: string; files?: WorkflowFile[] }>({ scriptUrl: driveScriptUrl.trim() }, {
        action: "list-workflow-files",
        year: selectedCustomerLocation.year,
        month: selectedCustomerLocation.month,
        projectId: selectedCustomerLocation.record.projectId,
        workflow: folder,
        refresh,
      });
      if (!response.ok || !result.ok || !result.files) throw new Error(result.error || "Không thể nạp danh sách tệp.");
      writeDriveCache(clientCacheKey, result.files ?? []);
      setWorkflowFilesByFolder((current) => ({ ...current, [cacheKey]: result.files ?? [] }));
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "Không thể nạp danh sách tệp.";
      const message = rawMessage.includes("Thiếu dữ liệu hồ sơ") ? "Apps Script chưa được cập nhật chức năng nạp danh sách tệp." : rawMessage;
      if (!hasCachedFiles) setWorkflowFilesError(message);
      if (!quietly) setNotice(message);
    } finally {
      driveRequestsInFlight.current.delete(clientCacheKey);
      setLoadingWorkflowFiles(false);
    }
  };

  const createWorkflowDateFolder = async () => {
    if (!selectedCustomerLocation || !driveScriptUrl.trim()) return;
    setLoadingWorkflowFiles(true);
    try {
      const { response, result } = await postToAppsScript<{ ok?: boolean; error?: string; folderName?: string }>({ scriptUrl: driveScriptUrl.trim() }, {
        action: "create-workflow-date-folder",
        year: selectedCustomerLocation.year,
        month: selectedCustomerLocation.month,
        projectId: selectedCustomerLocation.record.projectId,
        workflow: activeFolder,
      });
      if (!response.ok || !result.ok) throw new Error(result.error || "Không thể tạo thư mục mới.");
      await loadWorkflowFiles(activeFolder, true, true);
      setNotice(`Đã tạo thư mục ${result.folderName ?? "theo ngày hôm nay"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể tạo thư mục mới.");
    } finally {
      setLoadingWorkflowFiles(false);
    }
  };

  const uploadWorkflowFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (!files.length || !selectedCustomerLocation || !driveScriptUrl.trim()) {
      input.value = "";
      return;
    }
    const oversized = files.find((file) => file.size > MAX_WORKFLOW_UPLOAD_BYTES);
    if (oversized) {
      setNotice(`${oversized.name} lớn hơn 12 MB. Hãy tải tệp lớn trực tiếp bằng Google Drive.`);
      input.value = "";
      return;
    }
    setUploadingWorkflowFiles(true);
    setWorkflowFilesError("");
    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setNotice(`Đang tải ${index + 1}/${files.length}: ${file.name}`);
        const { response, result } = await postToAppsScript<{ ok?: boolean; error?: string }>({ scriptUrl: driveScriptUrl.trim() }, {
          action: "upload-workflow-file",
          year: selectedCustomerLocation.year,
          month: selectedCustomerLocation.month,
          projectId: selectedCustomerLocation.record.projectId,
          workflow: activeFolder,
          file: { fileName: file.name, mimeType: file.type || "application/octet-stream", data: bytesToBase64(new Uint8Array(await file.arrayBuffer())) },
        });
        if (!response.ok || !result.ok) throw new Error(result.error || `Không thể tải ${file.name} lên Drive.`);
      }
      await loadWorkflowFiles(activeFolder, true, true);
      setNotice(`Đã tải ${files.length} tệp lên Drive.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể tải tệp lên Drive.");
    } finally {
      setUploadingWorkflowFiles(false);
      input.value = "";
    }
  };

  // v13 intentionally starts with a clean document index. Earlier versions
  // could retain a deleted day in local cache after a background refresh.
  const documentCacheKey = (snapshotId = selectedDocumentSnapshotId, location = selectedCustomerLocation) => location ? `documents-v13:${location.year}-${location.month}-${location.record.projectId}-${snapshotId || "latest"}` : "";
  const documentMetadataOverrideKey = (snapshotId = selectedDocumentSnapshotId, location = selectedCustomerLocation) => location ? `document-metadata-v1:${location.year}-${location.month}-${location.record.projectId}-${snapshotId}` : "";
  const mergeDocumentMetadataOverrides = (files: DocumentFile[], snapshotId: string, location = selectedCustomerLocation) => {
    const cacheKey = documentMetadataOverrideKey(snapshotId, location);
    const overrides = cacheKey ? readDriveCache<Record<string, Pick<DocumentFile, "work" | "nature">>>(cacheKey, DRIVE_DOCUMENT_METADATA_CACHE_MS) ?? {} : {};
    return files.map((file) => overrides[file.id] ? { ...file, ...overrides[file.id] } : file);
  };
  const loadDocuments = async (snapshotId?: string, refresh = false) => {
    if (!selectedCustomerLocation || !driveScriptUrl.trim()) return;
    const requestedSnapshotId = snapshotId || "";
    const cacheKey = documentCacheKey(requestedSnapshotId);
    const cached = readDriveCache<{ snapshots: DocumentSnapshot[]; activeSnapshotId: string; files: DocumentFile[] }>(cacheKey, DRIVE_FILE_LIST_CACHE_MS);
    const fresh = isDriveCacheFresh(cacheKey, DRIVE_FILE_LIST_FRESH_MS);
    if (cached && !refresh) {
      setDocumentSnapshots(cached.snapshots);
      setDocumentFiles(mergeDocumentMetadataOverrides(cached.files, requestedSnapshotId || cached.activeSnapshotId));
      const activeId = requestedSnapshotId || cached.activeSnapshotId;
      setSelectedDocumentSnapshotId(activeId);
      setLoadedDocumentSnapshotId(activeId);
      setExpandedDocumentSnapshotId((current) => current || activeId);
    }
    if (fresh && !refresh) return;
    setLoadingDocuments(true);
    setDocumentsError("");
    try {
      const { response, result } = await postToAppsScript<{ ok?: boolean; error?: string; snapshots?: DocumentSnapshot[]; activeSnapshotId?: string; files?: DocumentFile[] }>({ scriptUrl: driveScriptUrl.trim() }, {
        action: "list-documents",
        year: selectedCustomerLocation.year,
        month: selectedCustomerLocation.month,
        projectId: selectedCustomerLocation.record.projectId,
        snapshotId: requestedSnapshotId || undefined,
        refresh,
      });
      if (!response.ok || !result.ok || !result.files || !result.snapshots) throw new Error(result.error || "Không thể nạp Tài liệu.");
      const activeId = requestedSnapshotId || result.activeSnapshotId || "";
      const next = { snapshots: result.snapshots, activeSnapshotId: result.activeSnapshotId ?? "", files: mergeDocumentMetadataOverrides(result.files, activeId) };
      writeDriveCache(cacheKey, next);
      if (activeId && cacheKey !== documentCacheKey(activeId)) writeDriveCache(documentCacheKey(activeId), { ...next, activeSnapshotId: activeId });
      setDocumentSnapshots(next.snapshots);
      setDocumentFiles(next.files);
      setSelectedDocumentSnapshotId(activeId);
      setLoadedDocumentSnapshotId(activeId);
      setExpandedDocumentSnapshotId((current) => current || activeId);
    } catch (error) {
      if (!cached) setDocumentsError(error instanceof Error ? error.message : "Không thể nạp Tài liệu.");
    } finally {
      setLoadingDocuments(false);
    }
  };

  const createDocumentSnapshot = async () => {
    if (!selectedCustomerLocation || !driveScriptUrl.trim()) return;
    setLoadingDocuments(true);
    try {
      const { response, result } = await postToAppsScript<{ ok?: boolean; error?: string; snapshot?: DocumentSnapshot; alreadyExists?: boolean }>({ scriptUrl: driveScriptUrl.trim() }, {
        action: "create-document-snapshot",
        year: selectedCustomerLocation.year,
        month: selectedCustomerLocation.month,
        projectId: selectedCustomerLocation.record.projectId,
      });
      if (!response.ok || !result.ok || !result.snapshot) throw new Error(result.error || "Không thể tạo bản Tài liệu hôm nay.");
      const nextSnapshots = [result.snapshot, ...documentSnapshots.filter((snapshot) => snapshot.id !== result.snapshot?.id)];
      setSelectedDocumentSnapshotId(result.snapshot.id);
      setExpandedDocumentSnapshotId(result.snapshot.id);
      setDocumentSnapshots(nextSnapshots);
      if (result.alreadyExists) {
        const cached = readDriveCache<{ snapshots: DocumentSnapshot[]; activeSnapshotId: string; files: DocumentFile[] }>(documentCacheKey(result.snapshot.id), DRIVE_FILE_LIST_CACHE_MS);
        if (cached) {
          setDocumentFiles(mergeDocumentMetadataOverrides(cached.files, result.snapshot.id));
          setLoadedDocumentSnapshotId(result.snapshot.id);
        } else {
          setDocumentFiles([]);
          setLoadedDocumentSnapshotId("");
        }
        setNotice(`Bản ngày ${result.snapshot.date} đã có.`);
      } else {
        const next = { snapshots: nextSnapshots, activeSnapshotId: result.snapshot.id, files: [] as DocumentFile[] };
        setDocumentFiles([]);
        setLoadedDocumentSnapshotId(result.snapshot.id);
        writeDriveCache(documentCacheKey(result.snapshot.id), next);
        writeDriveCache(documentCacheKey(""), next);
        setNotice(`Đã tạo bản ngày ${result.snapshot.date}.`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể tạo bản Tài liệu hôm nay.");
    } finally {
      setLoadingDocuments(false);
    }
  };

  const updateDocumentMetadata = async (fileId: string, patch: Partial<Pick<DocumentFile, "work" | "nature">>) => {
    if (!selectedCustomerLocation || !driveScriptUrl.trim() || !selectedDocumentSnapshotId) return;
    const before = documentFiles;
    const nextFiles = documentFiles.map((file) => file.id === fileId ? { ...file, ...patch } : file);
    const changedFile = nextFiles.find((file) => file.id === fileId);
    if (!changedFile) return;
    const metadataCacheKey = documentMetadataOverrideKey(selectedDocumentSnapshotId);
    const currentOverrides = readDriveCache<Record<string, Pick<DocumentFile, "work" | "nature">>>(metadataCacheKey, DRIVE_DOCUMENT_METADATA_CACHE_MS) ?? {};
    writeDriveCache(metadataCacheKey, { ...currentOverrides, [fileId]: { work: changedFile.work, nature: changedFile.nature } });
    setDocumentFiles(nextFiles);
    try {
      const { response, result } = await postToAppsScript<{ ok?: boolean; error?: string }>({ scriptUrl: driveScriptUrl.trim() }, {
        action: "update-document-metadata",
        year: selectedCustomerLocation.year,
        month: selectedCustomerLocation.month,
        projectId: selectedCustomerLocation.record.projectId,
        snapshotId: selectedDocumentSnapshotId,
        fileId,
        work: changedFile.work,
        nature: changedFile.nature,
      });
      if (!response.ok || !result.ok) throw new Error(result.error || "Không thể cập nhật phân loại tệp.");
      writeDriveCache(documentCacheKey(), { snapshots: documentSnapshots, activeSnapshotId: selectedDocumentSnapshotId, files: nextFiles });
    } catch (error) {
      setDocumentFiles(before);
      setNotice(error instanceof Error ? error.message : "Không thể cập nhật phân loại tệp.");
    }
  };

  const updateDocumentSnapshotLock = async (snapshot: DocumentSnapshot, locked: boolean, passcode = "") => {
    if (!selectedCustomerLocation || !driveScriptUrl.trim()) return;
    setDocumentSnapshotActionId(snapshot.id);
    try {
      const { response, result } = await postToAppsScript<{ ok?: boolean; error?: string }>({ scriptUrl: driveScriptUrl.trim() }, {
        action: "set-document-snapshot-lock",
        year: selectedCustomerLocation.year,
        month: selectedCustomerLocation.month,
        projectId: selectedCustomerLocation.record.projectId,
        snapshotId: snapshot.id,
        locked,
        passcode,
      });
      if (!response.ok || !result.ok) throw new Error(result.error || "Không thể cập nhật khóa bản ngày.");
      const nextSnapshots = documentSnapshots.map((item) => item.id === snapshot.id ? { ...item, locked } : item);
      setDocumentSnapshots(nextSnapshots);
      writeDriveCache(documentCacheKey(), { snapshots: nextSnapshots, activeSnapshotId: selectedDocumentSnapshotId, files: documentFiles });
      setNotice(locked ? `Đã khóa bản ngày ${snapshot.date}.` : `Đã mở khóa bản ngày ${snapshot.date}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể cập nhật khóa bản ngày.");
    } finally {
      setDocumentSnapshotActionId(null);
    }
  };

  const toggleDocumentSnapshotLock = (snapshot: DocumentSnapshot) => {
    if (!snapshot.locked) {
      void updateDocumentSnapshotLock(snapshot, true);
      return;
    }
    const passcode = window.prompt(`Nhập mã để mở khóa bản ngày ${snapshot.date}:`);
    if (passcode === null) return;
    void updateDocumentSnapshotLock(snapshot, false, passcode);
  };

  const deleteDocumentSnapshot = async (snapshot: DocumentSnapshot) => {
    if (!selectedCustomerLocation || !driveScriptUrl.trim() || snapshot.locked) return;
    if (!window.confirm(`Xóa bản Tài liệu ngày ${snapshot.date}? Các tệp Theo ngày nằm trong bản này cũng sẽ bị xóa.`)) return;
    setDocumentSnapshotActionId(snapshot.id);
    try {
      const { response, result } = await postToAppsScript<{ ok?: boolean; error?: string }>({ scriptUrl: driveScriptUrl.trim() }, {
        action: "delete-document-snapshot",
        year: selectedCustomerLocation.year,
        month: selectedCustomerLocation.month,
        projectId: selectedCustomerLocation.record.projectId,
        snapshotId: snapshot.id,
      });
      if (!response.ok || !result.ok) throw new Error(result.error || "Không thể xóa bản ngày.");
      const nextSnapshots = documentSnapshots.filter((item) => item.id !== snapshot.id);
      const nextSelectedId = selectedDocumentSnapshotId === snapshot.id ? (nextSnapshots[0]?.id ?? "") : selectedDocumentSnapshotId;
      const nextCached = nextSelectedId ? readDriveCache<{ snapshots: DocumentSnapshot[]; activeSnapshotId: string; files: DocumentFile[] }>(documentCacheKey(nextSelectedId), DRIVE_FILE_LIST_CACHE_MS) : null;
      const nextFiles = nextCached ? mergeDocumentMetadataOverrides(nextCached.files, nextSelectedId) : [];
      removeDriveCache(documentCacheKey(snapshot.id));
      removeDriveCache(documentMetadataOverrideKey(snapshot.id));
      writeDriveCache(documentCacheKey(""), { snapshots: nextSnapshots, activeSnapshotId: nextSelectedId, files: nextFiles });
      setDocumentSnapshots(nextSnapshots);
      setSelectedDocumentSnapshotId(nextSelectedId);
      setDocumentFiles(nextFiles);
      setLoadedDocumentSnapshotId(nextCached ? nextSelectedId : "");
      setDocumentsError("");
      if (expandedDocumentSnapshotId === snapshot.id) setExpandedDocumentSnapshotId("");
      setNotice(`Đã xóa bản ngày ${snapshot.date}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể xóa bản ngày.");
    } finally {
      setDocumentSnapshotActionId(null);
    }
  };

  useEffect(() => {
    if (activeFolder === "Tài liệu" && selectedCustomerLocation) void loadDocuments();
  }, [activeFolder, selectedCustomerProjectId, selectedYear, selectedMonth, driveScriptUrl]);

  useEffect(() => {
    if (!selectedCustomerLocation || (activeFolder !== "Thiết kế" && activeFolder !== "Bảo hành")) return;
    void loadCustomerProgressFromDrive(selectedCustomerLocation);
  }, [activeFolder, selectedCustomerProjectId, selectedYear, selectedMonth, driveScriptUrl, selectedCustomerLocation?.record.progressHydrated]);

  const searchCustomersOnDrive = (value: string) => {
    const query = value.trim();
    if (customerSearchTimer.current) window.clearTimeout(customerSearchTimer.current);
    if (query.length < 2) return;
    const isProjectOrHouseCode = /^GM\d/i.test(query) || (/^[A-Za-z0-9-]+$/.test(query) && !query.includes(" "));
    customerSearchTimer.current = window.setTimeout(() => {
      customerSearchTimer.current = null;
      void loadWorkspaceFromDrive(undefined, true, { mode: "search", query });
    }, isProjectOrHouseCode ? 100 : 420);
  };

  const openAddDialog = () => {
    const currentDate = getVietnamDate();
    setModalMonth(currentDate.month);
    setModalYear(currentDate.year);
    setCustomerName("");
    setHouseId("");
    setAddOpen(true);
  };

  const addCustomer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = customerName.trim();
    const normalizedHouseId = houseId.trim();
    const targetYear = years.find((folder) => folder.year === modalYear);
    if (!name) return;
    if (!targetYear) {
      setNotice(`Chưa có thư mục năm ${modalYear}. Hãy tạo thư mục năm này trên Drive trước.`);
      return;
    }

    const created = getVietnamDate();
    const projectId = `GM${String(created.day).padStart(2, "0")}${String(created.month).padStart(2, "0")}${created.year}${nameInitials(name)}`;
    const record: WorkRecord = {
      id: `${Date.now()}-${projectId}`,
      name,
      houseId: normalizedHouseId,
      projectId,
      createdAt: `${String(created.day).padStart(2, "0")}/${String(created.month).padStart(2, "0")}/${created.year}`,
      details: {},
      isHydrated: true,
      designProgress: createDesignProgress(),
      interiorDesignProgress: createDesignProgress("interior"),
      warrantyProgress: createWarrantyProgress(),
      functionalFloors: [createFunctionalFloor()],
    };
    const nextYears = years.map((yearFolder) => yearFolder.year !== modalYear ? yearFolder : {
      ...yearFolder,
      months: yearFolder.months.map((monthFolder, index) => index !== modalMonth - 1 ? monthFolder : { ...monthFolder, records: [record, ...monthFolder.records] }),
    });
    persist(nextYears);
    void syncRecordToDrive(record, modalYear, modalMonth);
    setSelectedYear(modalYear);
    setSelectedMonth(modalMonth);
    setSelectedCustomerProjectId(projectId);
    setPersonnelView(false);
    setActiveFolder("Tư vấn");
    setAddOpen(false);
    setNotice(`Đã tạo thư mục ${projectId} trong T${modalMonth}/${modalYear}`);
  };

  const deleteRecord = (id: string) => {
    const deletedRecord = activeMonthFolder?.records.find((record) => record.id === id);
    const nextYears = years.map((yearFolder) => yearFolder.year !== selectedYear ? yearFolder : {
      ...yearFolder,
      months: yearFolder.months.map((monthFolder, index) => index !== selectedMonth - 1 ? monthFolder : { ...monthFolder, records: monthFolder.records.filter((record) => record.id !== id) }),
    });
    persist(nextYears);
    if (deletedRecord?.projectId === selectedCustomerProjectId) returnToCustomerSearch();
    setNotice("Đã xóa dữ liệu — danh sách được cập nhật ngay");
  };

  const activeCustomerRecord = selectedCustomerLocation?.record ?? null;
  const selectedRecord = activeCustomerRecord;
  const architectureDesignProgressRows = normalizeDesignProgress(activeCustomerRecord, "architecture");
  const interiorDesignProgressRows = normalizeDesignProgress(activeCustomerRecord, "interior");
  const warrantyProgressRows = normalizeWarrantyProgress(activeCustomerRecord);
  const designScheduleAnalysis = analyzeDesignProgress(architectureDesignProgressRows);
  const interiorDesignScheduleAnalysis = analyzeDesignProgress(interiorDesignProgressRows);
  const isDemandSelected = (code: string) => Boolean(activeCustomerRecord?.details?.[code]?.trim());
  const progressRowsFor = (kind: DesignProgressKind) => kind === "architecture" ? architectureDesignProgressRows : interiorDesignProgressRows;
  const progressAnalysisFor = (kind: DesignProgressKind) => kind === "architecture" ? designScheduleAnalysis : interiorDesignScheduleAnalysis;

  const commitDesignProgressRows = (kind: DesignProgressKind, nextRows: DesignProgressRow[]) => {
    if (!activeCustomerRecord || !selectedCustomerLocation) return;
    const field = designProgressDefinitions[kind].field;
    const updatedRecord = { ...activeCustomerRecord, [field]: nextRows };
    persistRecord(updatedRecord, selectedCustomerLocation.year, selectedCustomerLocation.month);
    queueDesignProgressSync(updatedRecord, selectedCustomerLocation.year, selectedCustomerLocation.month, kind);
  };

  const commitWarrantyProgressRows = (nextRows: WarrantyProgressRow[]) => {
    if (!activeCustomerRecord || !selectedCustomerLocation) return;
    const updatedRecord = { ...activeCustomerRecord, warrantyProgress: nextRows };
    persistRecord(updatedRecord, selectedCustomerLocation.year, selectedCustomerLocation.month);
    queueWarrantySync(updatedRecord, selectedCustomerLocation.year, selectedCustomerLocation.month);
  };

  const updateDesignProgress = (kind: DesignProgressKind, rowIndex: number, key: "content" | DesignDateKey | "assignee" | "note", value: string) => {
    const currentRows = progressRowsFor(kind);
    let nextValue = value;
    if (key === "plannedDate" || key === "actualDate") {
      nextValue = formatDesignDateInput(value);
      if (nextValue.length === 10 && !parseDesignDate(nextValue)) {
        setNotice("Ngày không hợp lệ. Hãy nhập theo dạng ngày/tháng/năm, ví dụ 11/11/1999.");
        return;
      }
    }
    const nextRows = currentRows.map((row, index) => index === rowIndex ? { ...row, [key]: nextValue } : row);
    if ((key === "plannedDate" || key === "actualDate") && nextValue.length === 10 && !hasSequentialDesignDates(nextRows, key)) {
      setNotice(`${key === "plannedDate" ? "Ngày dự kiến" : "Ngày thực tế"} phải tăng dần theo thứ tự từ trên xuống.`);
      return;
    }
    commitDesignProgressRows(kind, nextRows);
  };

  const addDesignProgressRow = (kind: DesignProgressKind) => commitDesignProgressRows(kind, [...progressRowsFor(kind), createCustomDesignRow(kind)]);

  const deleteDesignProgressRow = (kind: DesignProgressKind, rowIndex: number) => {
    const rows = progressRowsFor(kind);
    const row = rows[rowIndex];
    if (!row?.isCustom) return;
    commitDesignProgressRows(kind, rows.filter((_, index) => index !== rowIndex));
  };

  const moveDesignProgressRow = (kind: DesignProgressKind, rowIndex: number, direction: -1 | 1) => {
    const rows = progressRowsFor(kind);
    const destination = rowIndex + direction;
    if (destination < 0 || destination >= rows.length) return;
    const nextRows = [...rows];
    [nextRows[rowIndex], nextRows[destination]] = [nextRows[destination], nextRows[rowIndex]];
    if (!hasSequentialDesignDates(nextRows, "plannedDate") || !hasSequentialDesignDates(nextRows, "actualDate")) {
      setNotice("Không thể đổi vị trí vì sẽ làm thứ tự ngày bị lùi. Hãy điều chỉnh ngày trước.");
      return;
    }
    commitDesignProgressRows(kind, nextRows);
  };

  const updateWarrantyProgress = (rowIndex: number, key: "content" | WarrantyDateKey | "assignee" | "note", value: string) => {
    let nextValue = value;
    if (key === "reportedDate" || key === "completedDate") {
      nextValue = formatDesignDateInput(value);
      if (nextValue.length === 10 && !parseDesignDate(nextValue)) {
        setNotice("Ngày không hợp lệ. Hãy nhập theo dạng ngày/tháng/năm, ví dụ 11/11/1999.");
        return;
      }
    }
    const nextRows = warrantyProgressRows.map((row, index) => index === rowIndex ? { ...row, [key]: nextValue } : row);
    if ((key === "reportedDate" || key === "completedDate") && nextValue.length === 10 && !hasSequentialWarrantyDates(nextRows, key)) {
      setNotice(`${key === "reportedDate" ? "Ngày báo" : "Ngày hoàn thành"} phải tăng dần theo thứ tự từ trên xuống.`);
      return;
    }
    commitWarrantyProgressRows(nextRows);
  };

  const addWarrantyProgressRow = () => commitWarrantyProgressRows([...warrantyProgressRows, createCustomWarrantyRow()]);

  const deleteWarrantyProgressRow = (rowIndex: number) => {
    if (!warrantyProgressRows[rowIndex]?.isCustom) return;
    commitWarrantyProgressRows(warrantyProgressRows.filter((_, index) => index !== rowIndex));
  };

  const moveWarrantyProgressRow = (rowIndex: number, direction: -1 | 1) => {
    const destination = rowIndex + direction;
    if (destination < 0 || destination >= warrantyProgressRows.length) return;
    const nextRows = [...warrantyProgressRows];
    [nextRows[rowIndex], nextRows[destination]] = [nextRows[destination], nextRows[rowIndex]];
    if (!hasSequentialWarrantyDates(nextRows, "reportedDate") || !hasSequentialWarrantyDates(nextRows, "completedDate")) {
      setNotice("Không thể đổi vị trí vì sẽ làm thứ tự ngày bị lùi. Hãy điều chỉnh ngày trước.");
      return;
    }
    commitWarrantyProgressRows(nextRows);
  };

  const startProtectedAction = (type: "rename" | "delete", record: WorkRecord) => {
    setOpenMenuId(null);
    setProtectedAction({ type, record });
    if (type === "rename") setRenameValue(record.name);
  };

  const confirmDeleteRecord = () => {
    if (!protectedAction || protectedAction.type !== "delete") return;
    deleteRecord(protectedAction.record.id);
    setNotice(`Đã xóa ${protectedAction.record.projectId}`);
    setProtectedAction(null);
  };

  const renameRecord = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!protectedAction || !renameValue.trim()) return;
    const updatedRecord = { ...protectedAction.record, name: renameValue.trim() };
    const nextYears = years.map((yearFolder) => yearFolder.year !== selectedYear ? yearFolder : {
      ...yearFolder,
      months: yearFolder.months.map((monthFolder, index) => index !== selectedMonth - 1 ? monthFolder : {
        ...monthFolder,
        records: monthFolder.records.map((record) => record.id === protectedAction.record.id ? updatedRecord : record),
      }),
    });
    persist(nextYears);
    queueDriveSync(updatedRecord);
    setProtectedAction(null);
    setNotice("Đã đổi tên hồ sơ");
  };

  const updateRecordDetail = (key: string, value: string) => {
    if (!selectedRecord) return;
    const nextValue = dateDetailCodes.has(key) ? formatDesignDateInput(value) : value;
    if (dateDetailCodes.has(key) && nextValue.length === 10 && !parseDesignDate(nextValue)) {
      setNotice("Ngày không hợp lệ. Hãy nhập theo dạng ngày/tháng/năm, ví dụ 11/11/1999.");
      return;
    }
    const updatedRecord = { ...selectedRecord, details: { ...(selectedRecord.details ?? {}), [key]: nextValue } };
    const nextYears = years.map((yearFolder) => yearFolder.year !== selectedYear ? yearFolder : {
      ...yearFolder,
      months: yearFolder.months.map((monthFolder, index) => index !== selectedMonth - 1 ? monthFolder : {
        ...monthFolder,
        records: monthFolder.records.map((record) => record.id === selectedRecord.id ? updatedRecord : record),
      }),
    });
    persist(nextYears);
    queueDriveSync(updatedRecord);
    if (nextValue && key === "NCT-KT") queueDesignProgressSync(updatedRecord, selectedYear, selectedMonth, "architecture");
    if (nextValue && key === "NCT-NT") queueDesignProgressSync(updatedRecord, selectedYear, selectedMonth, "interior");
  };

  const updateRecordName = (value: string) => {
    if (!selectedRecord) return;
    const updatedRecord = { ...selectedRecord, name: value };
    const nextYears = years.map((yearFolder) => yearFolder.year !== selectedYear ? yearFolder : {
      ...yearFolder,
      months: yearFolder.months.map((monthFolder, index) => index !== selectedMonth - 1 ? monthFolder : {
        ...monthFolder,
        records: monthFolder.records.map((record) => record.id === selectedRecord.id ? updatedRecord : record),
      }),
    });
    persist(nextYears);
    queueDriveSync(updatedRecord);
  };

  const processAudioCheckpoint = async (startingRecord: WorkRecord, year: number, month: number) => {
    if (!startingRecord.audioNote) throw new Error("Chưa có tiến độ ghi âm để tiếp tục.");
    const config = { scriptUrl: driveScriptUrl.trim() };
    let workingRecord = startingRecord;
    let workingChunks = normalizeAudioNoteChunks(startingRecord.audioNote);
    const totalChunks = startingRecord.audioNote.totalChunks ?? workingChunks.length;
    let startIndex = startingRecord.audioNote.completedChunks ?? 0;
    while (workingChunks.some((chunk) => chunk.index === startIndex)) startIndex += 1;

    for (let index = startIndex; index < totalChunks; index += 1) {
      setAudioProcessingStatus(`Đang xử lý đoạn ${index + 1}/${totalChunks}…`);
      let result: AudioProcessResponse | null = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const directResponse = await postToAppsScript<AudioProcessResponse>(config, { action: "process-audio-chunk", year, month, projectId: startingRecord.projectId, chunkIndex: index, totalChunks });
        const response = directResponse.response;
        result = directResponse.result;
        if (response.ok && result?.ok && result.segments) break;
        const errorMessage = result?.error || "Không thể xử lý file ghi âm.";
        const retrySeconds = quotaRetrySeconds(errorMessage);
        if (!retrySeconds || attempt === 4) throw new Error(retrySeconds ? "Gemini miễn phí đang hết lượt tạm thời. Tiến độ đã được lưu; hãy bấm tiếp tục sau vài phút." : errorMessage);
        await waitForAudioQuota(retrySeconds, (remaining) => setAudioProcessingStatus(`Gemini đang giới hạn lượt miễn phí · tiếp tục sau ${remaining} giây`));
        setAudioProcessingStatus(`Đang thử lại đoạn ${index + 1}/${totalChunks}…`);
      }
      if (!result?.segments) throw new Error("Không thể xử lý file ghi âm.");

      const offsetSeconds = index * MAX_AUDIO_CHUNK_SECONDS;
      const processedChunk: AudioNoteChunk = {
        index,
        segments: result.segments.map((segment) => ({
          time: formatAudioTime(offsetSeconds + parseAudioTime(segment.time)),
          text: segment.text,
        })),
      };
      workingChunks = [...workingChunks.filter((chunk) => chunk.index !== index), processedChunk];
      const audioNote = buildAudioNote(workingRecord.audioNote!, workingChunks, result.language);
      workingRecord = { ...workingRecord, audioNote };
      persistRecord(workingRecord, year, month);
      setAudioProcessingStatus(`Đang ghi đoạn ${index + 1}/${totalChunks} vào Excel…`);
      await syncRecordToDrive(workingRecord, year, month, config);

      if (index < totalChunks - 1) {
        const pauseSeconds = result.apiCallsUsed === 1 ? 15 : 65;
        await waitForAudioQuota(pauseSeconds, (remaining) => setAudioProcessingStatus(`Đã lưu đoạn ${index + 1}/${totalChunks} vào Excel · tiếp tục sau ${remaining} giây`));
      }
    }
    return workingRecord;
  };

  const resumeAudioProcessing = async (record: WorkRecord) => {
    setAudioProcessingId(record.id);
    try {
      const completedRecord = await processAudioCheckpoint(record, selectedYear, selectedMonth);
      const total = completedRecord.audioNote?.totalChunks ?? 0;
      setNotice(`Đã xử lý và lưu đủ ${total}/${total} đoạn vào Excel.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể tiếp tục xử lý file ghi âm.");
    } finally {
      setAudioProcessingId(null);
      setAudioProcessingStatus("");
    }
  };

  const importAudioNote = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || !selectedRecord) {
      input.value = "";
      return;
    }
    const supportedAudio = file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name);
    if (!supportedAudio) {
      setNotice("Chỉ hỗ trợ file MP3, WAV, M4A, AAC, OGG hoặc FLAC.");
      input.value = "";
      return;
    }

    const config = { scriptUrl: driveScriptUrl.trim() };
    const record = selectedRecord;
    setAudioProcessingId(record.id);
    setAudioProcessingStatus("Đang chuẩn bị bản ghi…");
    try {
      const chunks = await splitAudioForProcessing(file);
      for (let index = 0; index < chunks.length; index += 1) {
        setAudioProcessingStatus(`Đang lưu file ghi âm ${index + 1}/${chunks.length} vào Drive…`);
        const chunkFile = chunks[index].file;
        const mimeType = browserAudioMimeType(chunkFile);
        if (!mimeType) throw new Error("Không xác định được định dạng đoạn ghi âm.");
        const directResponse = await postToAppsScript<{ ok?: boolean; error?: string }>(config, {
          action: "store-audio-chunk",
          year: selectedYear,
          month: selectedMonth,
          projectId: record.projectId,
          chunkIndex: index,
          totalChunks: chunks.length,
          originalFileName: file.name,
          audio: { fileName: chunkFile.name, mimeType, data: bytesToBase64(new Uint8Array(await chunkFile.arrayBuffer())) },
        });
        const response = directResponse.response;
        const result = directResponse.result;
        if (!response.ok || !result.ok) throw new Error(result.error || "Không thể lưu file ghi âm vào Drive.");
      }

      const audioNote: AudioNote = {
        fileName: file.name,
        language: "Tiếng Việt",
        updatedAt: new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()),
        segments: [],
        chunks: [],
        totalChunks: chunks.length,
        completedChunks: 0,
        status: "processing",
      };
      const checkpointRecord = { ...record, audioNote };
      persistRecord(checkpointRecord, selectedYear, selectedMonth);
      await syncRecordToDrive(checkpointRecord, selectedYear, selectedMonth, config);
      const completedRecord = await processAudioCheckpoint(checkpointRecord, selectedYear, selectedMonth);
      const total = completedRecord.audioNote?.totalChunks ?? chunks.length;
      setNotice(`Đã xử lý và lưu đủ ${total}/${total} đoạn vào Excel.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể xử lý file ghi âm. Tiến độ đã hoàn thành vẫn được giữ lại.");
    } finally {
      setAudioProcessingId(null);
      setAudioProcessingStatus("");
      input.value = "";
    }
  };

  const deleteAudioNote = async (record: WorkRecord) => {
    if (!record.audioNote || audioProcessingId) return;
    if (!window.confirm(`Xóa toàn bộ file ghi âm và nội dung đã chuyển thành văn bản của ${record.projectId}?`)) return;
    const config = { scriptUrl: driveScriptUrl.trim() };
    if (!isAppsScriptUrl(config.scriptUrl)) {
      setDriveConfigOpen(true);
      return;
    }
    setAudioProcessingId(record.id);
    setAudioProcessingStatus("Đang xóa ghi âm…");
    try {
      const { response, result } = await postToAppsScript<{ ok?: boolean; error?: string; deletedCount?: number }>(config, {
        action: "delete-audio-note",
        year: selectedYear,
        month: selectedMonth,
        projectId: record.projectId,
      });
      if (!response.ok || !result.ok) throw new Error(result.error || "Không thể xóa file ghi âm trên Drive.");
      const updatedRecord = { ...record };
      delete updatedRecord.audioNote;
      persistRecord(updatedRecord, selectedYear, selectedMonth);
      setAudioProcessingStatus("Đang xóa nội dung ghi âm khỏi Excel…");
      await syncRecordToDrive(updatedRecord, selectedYear, selectedMonth, config);
      setNotice(`Đã xóa ${result.deletedCount ?? 0} file ghi âm. Bạn có thể Add ghi âm mới.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể xóa ghi âm.");
    } finally {
      setAudioProcessingId(null);
      setAudioProcessingStatus("");
    }
  };

  const functionalFloors = selectedRecord ? normalizeFunctionalFloors(selectedRecord) : [createFunctionalFloor()];

  const updateFunctionalFloors = (nextFloors: FunctionalFloor[]) => {
    if (!selectedRecord) return;
    const updatedRecord = { ...selectedRecord, functionalFloors: nextFloors, functionalRows: undefined };
    const nextYears = years.map((yearFolder) => yearFolder.year !== selectedYear ? yearFolder : {
      ...yearFolder,
      months: yearFolder.months.map((monthFolder, index) => index !== selectedMonth - 1 ? monthFolder : {
        ...monthFolder,
        records: monthFolder.records.map((record) => record.id === selectedRecord.id ? updatedRecord : record),
      }),
    });
    persist(nextYears);
    queueDriveSync(updatedRecord);
  };

  const updateFunctionalFloor = (floorId: string, value: string) => {
    updateFunctionalFloors(functionalFloors.map((floor) => floor.id === floorId ? { ...floor, floor: value } : floor));
  };

  const updateFunctionalRoom = (floorId: string, roomId: string, key: keyof Omit<FunctionalRoom, "id">, value: string) => {
    updateFunctionalFloors(functionalFloors.map((floor) => floor.id !== floorId ? floor : {
      ...floor,
      rooms: withReadyRoom(floor.rooms.map((room) => room.id === roomId ? { ...room, [key]: value } : room)),
    }));
  };

  const addFunctionalFloor = () => {
    updateFunctionalFloors([...functionalFloors, createFunctionalFloor(`Tầng ${functionalFloors.length + 1}`)]);
  };

  const removeFunctionalFloor = (floorId: string) => {
    if (functionalFloors.length === 1) return;
    updateFunctionalFloors(functionalFloors.filter((floor) => floor.id !== floorId));
  };

  const validateRoom = (floorId: string, roomId: string, value: string) => {
    const input = value.trim();
    if (!input) return;
    if (input.startsWith("@")) {
      return;
    }
    const match = roomOptions.find((room) => room.toLocaleLowerCase("vi").replaceAll(" ", "") === input.toLocaleLowerCase("vi").replaceAll(" ", ""));
    updateFunctionalRoom(floorId, roomId, "room", match ?? "");
  };

  const saveDriveConfig = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const config = { scriptUrl: driveScriptUrl.trim() };
    if (!isAppsScriptUrl(config.scriptUrl)) {
      setNotice("Hãy nhập Web app URL hợp lệ từ Google Apps Script.");
      return;
    }
    window.localStorage.setItem(driveSyncConfigKey, JSON.stringify(config));
    setDriveConfigOpen(false);
    setNotice("Đã kết nối Google Apps Script trên thiết bị này");
    void loadWorkspaceFromDrive(config, true, { mode: "index", year: selectedYear, month: selectedMonth });
    if (selectedRecord) void syncRecordToDrive(selectedRecord, selectedYear, selectedMonth, config);
    if (activeCustomerRecord && isDemandSelected("NCT-KT")) void syncDesignProgressToDrive(activeCustomerRecord, selectedYear, selectedMonth, config);
    if (activeCustomerRecord && isDemandSelected("NCT-NT")) void syncDesignProgressToDrive(activeCustomerRecord, selectedYear, selectedMonth, config, "interior");
    if (activeCustomerRecord) void syncWarrantyToDrive(activeCustomerRecord, selectedYear, selectedMonth, config);
  };

  const syncRecordToDrive = async (record: WorkRecord, year = selectedYear, month = selectedMonth, configOverride?: DriveSyncConfig) => {
    const config = configOverride ?? { scriptUrl: driveScriptUrl.trim() };
    if (!config.scriptUrl) {
      setDriveConfigOpen(true);
      return;
    }
    setSyncingRecordId(record.id);
    try {
      const { response, result } = await postToAppsScript<{ ok?: boolean; error?: string; fileUrl?: string }>(config, {
        action: "sync-customer",
        year,
        month,
        record: { ...record, details: record.details ?? {}, functionalFloors: normalizeFunctionalFloors(record) },
      });
      if (!response.ok || !result.ok) throw new Error(result.error || "Không thể tạo file Excel.");
      setNotice(`Đã xuất ${record.projectId}.xlsx vào Drive`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể kết nối Drive.");
    } finally {
      setSyncingRecordId(null);
    }
  };

  const syncDesignProgressToDrive = async (record: WorkRecord, year = selectedYear, month = selectedMonth, configOverride?: DriveSyncConfig, kind: DesignProgressKind = "architecture") => {
    const config = configOverride ?? { scriptUrl: driveScriptUrl.trim() };
    if (!config.scriptUrl) {
      setDriveConfigOpen(true);
      return;
    }
    setSyncingDesignId(record.id);
    try {
      const { response, result } = await postToAppsScript<{ ok?: boolean; error?: string; fileUrl?: string }>(config, {
        action: "sync-design-progress",
        year,
        month,
        progressKind: kind,
        record: { ...record, [designProgressDefinitions[kind].field]: normalizeDesignProgress(record, kind) },
      });
      if (!response.ok || !result.ok) throw new Error(result.error || `Không thể tạo Excel ${designProgressDefinitions[kind].title.toLocaleLowerCase("vi")}.`);
      setNotice(`Đã cập nhật ${designProgressDefinitions[kind].title} ${record.projectId}.xlsx`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `Không thể đồng bộ ${designProgressDefinitions[kind].title.toLocaleLowerCase("vi")}.`);
    } finally {
      setSyncingDesignId(null);
    }
  };

  const syncWarrantyToDrive = async (record: WorkRecord, year = selectedYear, month = selectedMonth, configOverride?: DriveSyncConfig) => {
    const config = configOverride ?? { scriptUrl: driveScriptUrl.trim() };
    if (!config.scriptUrl) {
      setDriveConfigOpen(true);
      return;
    }
    setSyncingWarrantyId(record.id);
    try {
      const { response, result } = await postToAppsScript<{ ok?: boolean; error?: string; fileUrl?: string }>(config, {
        action: "sync-warranty",
        year,
        month,
        record: { ...record, warrantyProgress: normalizeWarrantyProgress(record) },
      });
      if (!response.ok || !result.ok) throw new Error(result.error || "Không thể tạo Excel Phiếu thông tin bảo hành.");
      setNotice(`Đã cập nhật Phiếu thông tin bảo hành ${record.projectId}.xlsx`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể đồng bộ Phiếu thông tin bảo hành.");
    } finally {
      setSyncingWarrantyId(null);
    }
  };

  const queueDriveSync = (record: WorkRecord, year = selectedYear, month = selectedMonth) => {
    if (!isDriveConnected) return;
    if (driveSyncTimer.current) window.clearTimeout(driveSyncTimer.current);
    driveSyncTimer.current = window.setTimeout(() => {
      driveSyncTimer.current = null;
      void syncRecordToDrive(record, year, month);
    }, 900);
  };

  const queueDesignProgressSync = (record: WorkRecord, year = selectedYear, month = selectedMonth, kind: DesignProgressKind = "architecture") => {
    if (!isDriveConnected) return;
    const timer = designSyncTimers.current[kind];
    if (timer) window.clearTimeout(timer);
    designSyncTimers.current[kind] = window.setTimeout(() => {
      delete designSyncTimers.current[kind];
      void syncDesignProgressToDrive(record, year, month, undefined, kind);
    }, 900);
  };

  const queueWarrantySync = (record: WorkRecord, year = selectedYear, month = selectedMonth) => {
    if (!isDriveConnected) return;
    if (warrantySyncTimer.current) window.clearTimeout(warrantySyncTimer.current);
    warrantySyncTimer.current = window.setTimeout(() => {
      warrantySyncTimer.current = null;
      void syncWarrantyToDrive(record, year, month);
    }, 900);
  };

  useEffect(() => () => {
    if (driveSyncTimer.current) window.clearTimeout(driveSyncTimer.current);
    Object.values(designSyncTimers.current).forEach((timer) => {
      if (timer) window.clearTimeout(timer);
    });
    if (warrantySyncTimer.current) window.clearTimeout(warrantySyncTimer.current);
    if (customerSearchTimer.current) window.clearTimeout(customerSearchTimer.current);
  }, []);

  const selectedAudioNote = selectedRecord?.audioNote;
  const audioDisplayChunks = selectedAudioNote ? normalizeAudioNoteChunks(selectedAudioNote) : [];
  const audioTotalChunks = selectedAudioNote?.totalChunks ?? audioDisplayChunks.length;
  const audioCompletedChunks = selectedAudioNote?.completedChunks ?? audioDisplayChunks.length;
  const hasPendingAudio = Boolean(selectedAudioNote && audioTotalChunks > audioCompletedChunks);
  const consultingSearchTerm = normalizeSearchText(consultingSearch);
  const visibleDetailSections = detailSections.map((section) => {
    const sectionMatches = !consultingSearchTerm || normalizeSearchText(section.title).includes(consultingSearchTerm);
    const fields = sectionMatches ? section.fields : section.fields.filter((field) => normalizeSearchText(`${field.label} ${field.code} ${selectedRecord?.details?.[field.code] ?? ""}`).includes(consultingSearchTerm));
    return { ...section, fields };
  }).filter((section) => section.fields.length > 0);
  const visibleSystemFields = systemFields.filter((field) => !consultingSearchTerm || normalizeSearchText(`Thông tin hệ thống ${field.label} ${field.code} ${selectedRecord?.details?.[field.code] ?? ""}`).includes(consultingSearchTerm));
  const consultingSearchMatchesFunctional = !consultingSearchTerm || normalizeSearchText([
    "Thông tin công năng tầng phòng số lượng mô tả",
    ...functionalFloors.flatMap((floor) => [floor.floor, ...floor.rooms.flatMap((room) => [room.room, room.quantity, room.description])]),
  ].join(" ")).includes(consultingSearchTerm);
  const consultingSearchMatchesAudio = !consultingSearchTerm || normalizeSearchText([
    "Thông tin ghi âm nội dung chuyển từ ghi âm",
    selectedAudioNote?.fileName ?? "",
    ...audioDisplayChunks.flatMap((chunk) => chunk.segments.map((segment) => segment.text)),
  ].join(" ")).includes(consultingSearchTerm);
  const hasConsultingSearchResults = visibleDetailSections.length > 0 || visibleSystemFields.length > 0 || consultingSearchMatchesFunctional || consultingSearchMatchesAudio;
  const selectedPersonnelCategory = personnelCategories.find((category) => category.id === selectedPersonnelCategoryId) ?? personnelCategories[0] ?? null;
  const selectedPersonnel = selectedPersonnelCategory ? personnelByCategory[selectedPersonnelCategory.id] ?? [] : [];
  const visiblePersonnel = selectedPersonnel.filter((member) => !personnelSearch.trim() || normalizeSearchText(`${member.name} ${member.phone} ${member.role} ${member.address}`).includes(normalizeSearchText(personnelSearch)));
  const personnelNames = useMemo(() => Array.from(new Set(Object.values(personnelByCategory).flat().map((member) => member.name.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "vi")), [personnelByCategory]);
  const syncPersonnelToDrive = async (next: Record<string, PersonnelMember[]>) => {
    if (!driveScriptUrl.trim()) return;
    try {
      const { response, result } = await postToAppsScript<{ ok?: boolean; error?: string }>({ scriptUrl: driveScriptUrl.trim() }, { action: "sync-personnel", personnel: next });
      if (!response.ok || !result.ok) throw new Error(result.error || "Không thể lưu danh sách nhân lực vào Drive.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể lưu danh sách nhân lực vào Drive.");
    }
  };
  const persistPersonnel = (next: Record<string, PersonnelMember[]>) => {
    setPersonnelByCategory(next);
    try { window.localStorage.setItem(personnelStorageKey, JSON.stringify(next)); } catch { /* Personnel remains available for this session. */ }
    void syncPersonnelToDrive(next);
  };
  const savePersonnel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedPersonnelCategory || !personnelDraft.name.trim()) return;
    const member: PersonnelMember = { id: editingPersonnelId ?? `person-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, ...personnelDraft, name: personnelDraft.name.trim(), birthDate: formatDesignDateInput(personnelDraft.birthDate), phone: normalizePersonnelPhone(personnelDraft.phone) };
    const nextMembers = editingPersonnelId ? selectedPersonnel.map((item) => item.id === editingPersonnelId ? member : item) : [...selectedPersonnel, member];
    persistPersonnel({ ...personnelByCategory, [selectedPersonnelCategory.id]: nextMembers });
    setPersonnelDraft({ status: "Có", name: "", birthDate: "", phone: "", role: "", address: "" });
    setEditingPersonnelId(null);
    setPersonnelAddOpen(false);
    setNotice(editingPersonnelId ? `Đã cập nhật ${member.name}.` : `Đã thêm ${member.name} vào ${selectedPersonnelCategory.label}.`);
  };
  const openPersonnelEditor = (member?: PersonnelMember) => {
    setEditingPersonnelId(member?.id ?? null);
    setPersonnelDraft(member ? { status: member.status ?? "Có", name: member.name, birthDate: member.birthDate, phone: normalizePersonnelPhone(member.phone), role: member.role, address: member.address } : { status: "Có", name: "", birthDate: "", phone: "", role: "", address: "" });
    setPersonnelMenuId(null);
    setPersonnelAddOpen(true);
  };
  const updatePersonnelStatus = (memberId: string, status: PersonnelStatus) => {
    if (!selectedPersonnelCategory) return;
    persistPersonnel({ ...personnelByCategory, [selectedPersonnelCategory.id]: selectedPersonnel.map((member) => member.id === memberId ? { ...member, status } : member) });
  };
  const removePersonnel = (memberId: string) => {
    if (!selectedPersonnelCategory) return;
    persistPersonnel({ ...personnelByCategory, [selectedPersonnelCategory.id]: selectedPersonnel.filter((member) => member.id !== memberId) });
    setPersonnelMenuId(null);
  };
  useEffect(() => {
    if (!personnelView || !driveScriptUrl.trim()) return;
    let cancelled = false;
    setLoadingPersonnel(true);
    void postToAppsScript<{ ok?: boolean; error?: string; personnel?: Record<string, PersonnelMember[]> }>({ scriptUrl: driveScriptUrl.trim() }, { action: "load-personnel" }).then(({ response, result }) => {
      if (!response.ok || !result.ok || cancelled) return;
      const next = normalizePersonnelMap(result.personnel ?? {});
      setPersonnelByCategory(next);
      try { window.localStorage.setItem(personnelStorageKey, JSON.stringify(next)); } catch { /* Local cache is optional. */ }
    }).catch(() => undefined).finally(() => { if (!cancelled) setLoadingPersonnel(false); });
    return () => { cancelled = true; };
  }, [personnelView, driveScriptUrl]);
  useEffect(() => {
    if (!selectedCustomerProjectId || activeFolder === "Tài liệu" || !driveScriptUrl.trim()) return;
    void loadWorkflowFiles(activeFolder, true);
  }, [activeFolder, selectedCustomerProjectId, selectedMonth, selectedYear, driveScriptUrl]);
  const currentWorkflowFiles = workflowFilesByFolder[workflowFilesCacheKey(activeFolder)] ?? [];
  const renderWorkflowFiles = () => (
    <section className="workflow-files" aria-label={`Tệp trong thư mục ${activeFolder}`}>
      <header className="workflow-files__heading">
        <div><p className="eyebrow">{activeFolder}</p><h2>Tệp trong thư mục</h2></div><div className="workflow-files__actions"><label className={`workflow-upload-button ${uploadingWorkflowFiles ? "workflow-upload-button--busy" : ""}`}>{uploadingWorkflowFiles ? "Đang tải…" : "⇧ Tải tệp lên Drive"}<input type="file" multiple disabled={uploadingWorkflowFiles} onChange={(event) => void uploadWorkflowFiles(event)} /></label><button type="button" onClick={() => void createWorkflowDateFolder()} disabled={loadingWorkflowFiles || uploadingWorkflowFiles}><b>＋</b> Thư mục ngày</button></div>
      </header>
      <div className="workflow-files__list">
        {loadingWorkflowFiles && !currentWorkflowFiles.length ? <p className="workflow-files__empty">Đang lấy danh sách tệp…</p>
          : workflowFilesError ? <p className="workflow-files__empty">Chưa thể nạp tệp: {workflowFilesError}</p>
          : currentWorkflowFiles.length ? currentWorkflowFiles.map((file) => (
            <a key={file.id} className="workflow-file" href={file.downloadUrl} {...(file.isFolder ? { target: "_blank", rel: "noreferrer" } : { download: file.name })} aria-label={`${file.isFolder ? "Mở thư mục" : "Tải tệp"} ${file.name}`}>
              <span className="workflow-file__icon">{file.isFolder ? "▰" : file.mimeType.startsWith("image/") ? "▧" : file.name.toLowerCase().endsWith(".pdf") ? "▤" : "▱"}</span>
              <span><b>{file.name}</b><small>{file.isFolder ? "Thư mục" : "Chỉnh sửa"}: {file.updatedAt}</small></span><em>{file.isFolder ? "↗" : "↓"}</em>
            </a>
          )) : null}
      </div>
    </section>
  );
  const renderDocumentLibrary = () => {
    const visibleDocumentFiles = documentFiles.filter((file) => !isHiddenDocumentFile(file.name));
    const documentGroups = ["Tư vấn", "Thiết kế", "Dự toán", "Thi công", "Nghiệm thu", "Bảo hành", "Chưa xác định"].map((title) => ({
      title,
      files: visibleDocumentFiles.filter((file) => title === "Chưa xác định" ? file.work === "Chưa gắn" : file.work === title),
    })).filter((group) => group.files.length);
    const toggleDocumentSnapshot = (snapshotId: string) => {
      if (expandedDocumentSnapshotId === snapshotId) {
        setExpandedDocumentSnapshotId("");
        return;
      }
      setExpandedDocumentSnapshotId(snapshotId);
      setSelectedDocumentSnapshotId(snapshotId);
      setDocumentsError("");
      const cached = readDriveCache<{ snapshots: DocumentSnapshot[]; activeSnapshotId: string; files: DocumentFile[] }>(documentCacheKey(snapshotId), DRIVE_FILE_LIST_CACHE_MS);
      if (cached) {
        setDocumentFiles(mergeDocumentMetadataOverrides(cached.files, snapshotId));
        setLoadedDocumentSnapshotId(snapshotId);
      } else {
        setDocumentFiles([]);
        setLoadedDocumentSnapshotId("");
      }
    };
    return <section className="document-library" aria-label="Tài liệu dự án">
      <header className="document-library__heading">
        <div><p className="eyebrow">Tài liệu</p><h1>Tài liệu dự án</h1><p>Hồ sơ mới có sẵn ngày tạo. Sang ngày mới, bấm <b>＋ Bản ngày mới</b> để tạo đúng ngày hiện tại; mỗi ngày chỉ có một bản.</p></div>
        <div className="document-library__actions"><button type="button" className="document-library__refresh" onClick={() => void loadDocuments(undefined, true)} disabled={loadingDocuments}>↻ Nạp lại</button><button type="button" className="add-button" onClick={() => void createDocumentSnapshot()} disabled={loadingDocuments}><span>＋</span> Bản ngày mới</button></div>
      </header>
      <div className="document-library__days">
        {documentSnapshots.length ? documentSnapshots.map((snapshot) => {
          const expanded = expandedDocumentSnapshotId === snapshot.id;
          const contentReady = loadedDocumentSnapshotId === snapshot.id;
          const isActing = documentSnapshotActionId === snapshot.id;
          return <article key={snapshot.id} className={`document-day ${expanded ? "document-day--expanded" : ""}`}>
            <header className="document-day__header"><button type="button" className="document-day__trigger" onClick={() => toggleDocumentSnapshot(snapshot.id)} aria-expanded={expanded}>
              <span><b>Ngày: {snapshot.date || "Chưa xác định"}</b><small>{snapshot.name}</small></span><em>{expanded ? "−" : "+"}</em>
            </button><div className="document-day__actions"><button type="button" className={snapshot.locked ? "document-day__lock document-day__lock--locked" : "document-day__lock"} onClick={() => toggleDocumentSnapshotLock(snapshot)} disabled={isActing} title={snapshot.locked ? "Mở khóa" : "Khóa để không cho xóa"} aria-label={snapshot.locked ? `Mở khóa ngày ${snapshot.date}` : `Khóa ngày ${snapshot.date}`}>{snapshot.locked ? "🔒" : "🔓"}</button><button type="button" className="document-day__delete" onClick={() => void deleteDocumentSnapshot(snapshot)} disabled={snapshot.locked || isActing} title={snapshot.locked ? "Cần mở khóa trước khi xóa" : "Xóa bản ngày"} aria-label={`Xóa ngày ${snapshot.date}`}>🗑</button></div></header>
            {expanded && <div className="document-day__content">
              {loadingDocuments && selectedDocumentSnapshotId === snapshot.id ? <p className="document-library__empty">Đang nạp tệp của ngày này…</p>
                : !contentReady ? <p className="document-library__empty">Tệp của ngày này chưa được nạp. <button type="button" className="document-library__load-day" onClick={() => void loadDocuments(snapshot.id, true)}>Nạp tệp</button></p>
                : documentsError ? <p className="document-library__empty">Chưa thể nạp Tài liệu: {documentsError}</p>
                  : documentGroups.length ? documentGroups.map((group) => <section className="document-work-group" key={group.title}><h2>{group.title}</h2><div className="document-library__table-wrap"><table className="document-library__table"><thead><tr><th>Công việc</th><th>Tính chất</th><th>Tên tệp</th><th>Ngày chỉnh sửa</th></tr></thead><tbody>{group.files.map((file) => <tr key={file.id}><td><select value={file.work} onChange={(event) => void updateDocumentMetadata(file.id, { work: event.target.value })} aria-label={`Công việc của ${file.name}`}>{documentWorkOptions.map((work) => <option key={work} value={work}>{work}</option>)}</select></td><td><select value={file.nature} onChange={(event) => void updateDocumentMetadata(file.id, { nature: event.target.value as DocumentNature })} aria-label={`Tính chất của ${file.name}`}>{documentNatureOptions.map((nature) => <option key={nature} value={nature}>{nature}</option>)}</select></td><td><a href={file.downloadUrl} download={file.name}>{file.name}</a></td><td>{file.updatedAt}</td></tr>)}</tbody></table></div></section>) : <p className="document-library__empty">Chưa có tệp trong bản ngày này.</p>}
            </div>}
          </article>;
        }) : <p className="document-library__empty">Chưa có bản Tài liệu nào.</p>}
      </div>
    </section>;
  };
  const renderWorkflowCustomerSearch = () => (
    <section className="workflow-customer-search" aria-label="Tìm khách hàng trong quy trình">
      <label className="customer-search workflow-customer-search__input">
        <span>⌕</span>
        <input value={workflowSearch} onChange={(event) => { setWorkflowSearch(event.target.value); searchCustomersOnDrive(event.target.value); }} placeholder="Search khách hàng, mã nhà hoặc ID dự án…" aria-label="Search khách hàng" />
        {workflowSearch && <button type="button" onClick={() => setWorkflowSearch("")} aria-label="Xóa nội dung Search">×</button>}
      </label>
      {workflowSearch && <div className="workflow-customer-search__results">
        {workflowSearchResults.length ? workflowSearchResults.map((location) => (
          <button type="button" key={`${location.year}-${location.month}-${location.record.projectId}`} onClick={() => selectCustomerForWorkflow(location)}>
            <span><b>{location.record.name}</b><small>{location.record.projectId}{location.record.houseId ? ` · ${location.record.houseId}` : ""}</small></span>
            <em>T{location.month} / {location.year} →</em>
          </button>
        )) : <p>Không tìm thấy khách hàng phù hợp.</p>}
      </div>}
    </section>
  );
  const renderDesignSchedule = (kind: DesignProgressKind) => {
    const definition = designProgressDefinitions[kind];
    const rows = progressRowsFor(kind);
    const analysis = progressAnalysisFor(kind);
    const enabled = isDemandSelected(definition.demandCode);
    if (!enabled) return <section className="design-schedule design-schedule--disabled">
      <div><p className="eyebrow">{definition.shortTitle}</p><h2>{definition.title}</h2><p>Chưa chọn nhu cầu {definition.shortTitle.toLocaleLowerCase("vi")} trong Phiếu thông tin khách hàng.</p></div>
      <span>Chưa kích hoạt</span>
    </section>;

    return <section className="design-schedule">
      <header className="design-schedule__heading">
        <div><p className="eyebrow">{definition.shortTitle}</p><h2>{definition.title}</h2><span>Ngày tự định dạng dd/mm/yyyy · ngày trong mỗi cột tăng dần từ trên xuống</span></div>
        <div className="export-actions"><div className="design-progress-view__status"><i className={syncingDesignId === activeCustomerRecord?.id ? "is-syncing" : ""} />{syncingDesignId === activeCustomerRecord?.id ? "Đang xuất Excel…" : "Dữ liệu đã lưu"}</div><button type="button" className="export-button" onClick={() => activeCustomerRecord && void syncDesignProgressToDrive(activeCustomerRecord, selectedYear, selectedMonth, undefined, kind)} disabled={!activeCustomerRecord || syncingDesignId === activeCustomerRecord.id}>⇩ Export Excel</button></div>
      </header>
      <div className="design-progress-table-wrap">
        <table className="design-progress-table">
          <thead><tr><th>Nội dung</th><th>Ngày dự kiến</th><th>Ngày thực tế</th><th>Người phụ trách</th><th>Ghi chú</th></tr></thead>
          <tbody>{rows.map((row, index) => (
            <tr key={row.id}>
              <td><div className="design-progress-content">
                {row.isCustom
                  ? <GrowingTextarea value={row.content} onChange={(event) => updateDesignProgress(kind, index, "content", event.target.value)} placeholder="Nhập nội dung mới" aria-label={`Nội dung dòng ${index + 1}`} />
                  : <b>{row.content}</b>}
                <span className="design-progress-content__actions">
                  <button type="button" onClick={() => moveDesignProgressRow(kind, index, -1)} disabled={index === 0} title="Lên một dòng" aria-label={`Đưa ${row.content || `dòng ${index + 1}`} lên`}>↑</button>
                  <button type="button" onClick={() => moveDesignProgressRow(kind, index, 1)} disabled={index === rows.length - 1} title="Xuống một dòng" aria-label={`Đưa ${row.content || `dòng ${index + 1}`} xuống`}>↓</button>
                  {row.isCustom && <button type="button" className="is-delete" onClick={() => deleteDesignProgressRow(kind, index)} title="Xóa dòng" aria-label={`Xóa ${row.content || `dòng ${index + 1}`}`}>×</button>}
                </span>
              </div></td>
              <td><input value={row.plannedDate} maxLength={10} onChange={(event) => updateDesignProgress(kind, index, "plannedDate", event.target.value)} placeholder="11/11/1999" inputMode="numeric" aria-label={`Ngày dự kiến ${row.content}`} /></td>
              <td><input value={row.actualDate} maxLength={10} onChange={(event) => updateDesignProgress(kind, index, "actualDate", event.target.value)} placeholder="11/11/1999" inputMode="numeric" aria-label={`Ngày thực tế ${row.content}`} /></td>
              <td><select className="personnel-assignee" value={row.assignee} onChange={(event) => updateDesignProgress(kind, index, "assignee", event.target.value)} aria-label={`Người phụ trách ${row.content}`}><option value="">Chọn người phụ trách</option>{personnelNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></td>
              <td><GrowingTextarea value={row.note} onChange={(event) => updateDesignProgress(kind, index, "note", event.target.value)} placeholder="Nhập ghi chú" aria-label={`Ghi chú ${row.content}`} /></td>
            </tr>
          ))}</tbody>
        </table>
        <button type="button" className="design-progress-add-row" onClick={() => addDesignProgressRow(kind)}><span>＋</span> Thêm dòng tiến độ</button>
      </div>
      <section className="design-progress-insights">
        <div className="design-progress-insights__heading"><div><p className="eyebrow">So sánh lịch</p><h2>Đồ thị kế hoạch và thực tế</h2></div><div className="schedule-legend"><span><i className="is-late" /> Chậm</span><span><i className="is-early" /> Sớm</span><span><i className="is-on-time" /> Bằng kế hoạch</span></div></div>
        <div className="schedule-charts">
          <DesignTimelineChart rows={rows} dateKey="plannedDate" title="Đồ thị ngày dự kiến" />
          <DesignTimelineChart rows={rows} dateKey="actualDate" title="Đồ thị ngày thực tế" />
        </div>
        <article className="schedule-analysis">
          <header><p className="eyebrow">Phân tích tự động</p><h3>5 nhận xét tiến độ</h3><span>Dựa trên chênh lệch từng mốc, không thay thế phân tích đường găng.</span></header>
          <ol>{analysis.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol>
        </article>
      </section>
      <footer className="design-progress-view__footer"><span>File: {definition.title} {activeCustomerRecord?.projectId}.xlsx</span><span>GM-Manager / Khách hàng / {selectedYear} / T{selectedMonth} / {activeCustomerRecord?.projectId} / Thiết kế</span></footer>
    </section>;
  };

  const renderWarrantySchedule = () => <section className="design-schedule warranty-schedule">
    <header className="design-schedule__heading">
      <div><p className="eyebrow">Bảo hành</p><h2>Phiếu thông tin bảo hành</h2><span>Ngày tự định dạng dd/mm/yyyy · ngày trong mỗi cột tăng dần từ trên xuống</span></div>
      <div className="export-actions"><div className="design-progress-view__status"><i className={syncingWarrantyId === activeCustomerRecord?.id ? "is-syncing" : ""} />{syncingWarrantyId === activeCustomerRecord?.id ? "Đang xuất Excel…" : "Dữ liệu đã lưu"}</div><button type="button" className="export-button" onClick={() => activeCustomerRecord && void syncWarrantyToDrive(activeCustomerRecord, selectedYear, selectedMonth)} disabled={!activeCustomerRecord || syncingWarrantyId === activeCustomerRecord.id}>⇩ Export Excel</button></div>
    </header>
    <div className="design-progress-table-wrap">
      <table className="design-progress-table warranty-progress-table">
        <thead><tr><th>Nội dung</th><th>Ngày báo</th><th>Ngày hoàn thành</th><th>Người phụ trách</th><th>Ghi chú</th></tr></thead>
        <tbody>{warrantyProgressRows.map((row, index) => (
          <tr key={row.id}>
            <td><div className="design-progress-content">
              {row.isCustom
                ? <GrowingTextarea value={row.content} onChange={(event) => updateWarrantyProgress(index, "content", event.target.value)} placeholder="Nhập nội dung mới" aria-label={`Nội dung dòng ${index + 1}`} />
                : <b>{row.content}</b>}
              <span className="design-progress-content__actions">
                <button type="button" onClick={() => moveWarrantyProgressRow(index, -1)} disabled={index === 0} title="Lên một dòng" aria-label={`Đưa ${row.content || `dòng ${index + 1}`} lên`}>↑</button>
                <button type="button" onClick={() => moveWarrantyProgressRow(index, 1)} disabled={index === warrantyProgressRows.length - 1} title="Xuống một dòng" aria-label={`Đưa ${row.content || `dòng ${index + 1}`} xuống`}>↓</button>
                {row.isCustom && <button type="button" className="is-delete" onClick={() => deleteWarrantyProgressRow(index)} title="Xóa dòng" aria-label={`Xóa ${row.content || `dòng ${index + 1}`}`}>×</button>}
              </span>
            </div></td>
            <td><input value={row.reportedDate} maxLength={10} onChange={(event) => updateWarrantyProgress(index, "reportedDate", event.target.value)} placeholder="11/11/1999" inputMode="numeric" aria-label={`Ngày báo ${row.content}`} /></td>
            <td><input value={row.completedDate} maxLength={10} onChange={(event) => updateWarrantyProgress(index, "completedDate", event.target.value)} placeholder="11/11/1999" inputMode="numeric" aria-label={`Ngày hoàn thành ${row.content}`} /></td>
            <td><select className="personnel-assignee" value={row.assignee} onChange={(event) => updateWarrantyProgress(index, "assignee", event.target.value)} aria-label={`Người phụ trách ${row.content}`}><option value="">Chọn người phụ trách</option>{personnelNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></td>
            <td><GrowingTextarea value={row.note} onChange={(event) => updateWarrantyProgress(index, "note", event.target.value)} placeholder="Nhập ghi chú" aria-label={`Ghi chú ${row.content}`} /></td>
          </tr>
        ))}</tbody>
      </table>
      <button type="button" className="design-progress-add-row" onClick={addWarrantyProgressRow}><span>＋</span> Thêm dòng bảo hành</button>
    </div>
    <footer className="design-progress-view__footer"><span>File: Phiếu thông tin bảo hành {activeCustomerRecord?.projectId}.xlsx</span><span>GM-Manager / Khách hàng / {selectedYear} / T{selectedMonth} / {activeCustomerRecord?.projectId} / Bảo hành</span></footer>
  </section>;

  return (
    <main className="crm-shell">
      {!selectedCustomerProjectId && (
        <section className="customer-gateway" aria-label={personnelView ? "Nhân lực" : "Chọn khách hàng"}>
          <header className="customer-gateway__header">
            <div className="brand customer-gateway__brand brand--with-logo"><img src={`${import.meta.env.BASE_URL}gm-logo.png`} alt="GM-manager" /><span className="brand__wordmark">GM-manager</span></div>
            <div className="customer-gateway__actions">
              {renderMobileAppActions()}
              <button className={`drive-status ${isDriveConnected ? "drive-status--connected" : ""}`} onClick={() => setDriveConfigOpen(true)}><i /> {isDriveConnected ? "Drive đã kết nối" : "Kết nối Drive"}</button>
              <button className="reload-drive" onClick={() => void loadWorkspaceFromDrive(undefined, false, { force: true })} disabled={isLoadingDrive}>{isLoadingDrive ? "Đang nạp…" : "Nạp lại Drive"}</button>
              {!personnelView && <button className="add-button" onClick={openAddDialog}><span>＋</span> Add customer</button>}
            </div>
          </header>

          {personnelView ? (
            <div className="personnel-layout">
              <aside className="personnel-sidebar">
                <p className="sidebar-label sidebar-label--top">Nhân lực</p>
                <nav className="main-nav" aria-label="Nhóm nhân lực">
                  {personnelCategories.map((category) => (
                    <button key={category.id} type="button" onClick={() => { setSelectedPersonnelCategoryId(category.id); setPersonnelSearch(""); setPersonnelAddOpen(false); setEditingPersonnelId(null); setPersonnelMenuId(null); }} className={`nav-row ${selectedPersonnelCategory?.id === category.id ? "nav-row--active" : ""}`}>
                      <span className="nav-row__icon">{category.icon}</span><span>{category.label}</span>
                    </button>
                  ))}
                </nav>
              </aside>
              <section className="personnel-workspace">
                <header className="personnel-workspace__heading personnel-workspace__heading--compact">
                  <div className="personnel-workspace__actions"><button className="add-button" onClick={() => openPersonnelEditor()}><span>＋</span> Thêm nhân lực</button><button className="personnel-back" onClick={() => { setPersonnelView(false); setSelectedPersonnelCategoryId(null); setPersonnelSearch(""); }}>← Khách hàng</button></div>
                </header>
                <label className="customer-search personnel-workspace__search">
                  <span>⌕</span>
                  <input value={personnelSearch} onChange={(event) => setPersonnelSearch(event.target.value)} placeholder={`Search trong ${selectedPersonnelCategory?.label.toLocaleLowerCase("vi")}…`} aria-label={`Search ${selectedPersonnelCategory?.label}`} autoFocus />
                </label>
                <div className="personnel-category-detail">
                  {personnelAddOpen && <form className="personnel-add-form" onSubmit={savePersonnel}>
                    <label>Hoạt động<select value={personnelDraft.status} onChange={(event) => setPersonnelDraft({ ...personnelDraft, status: event.target.value as PersonnelStatus })}>{personnelStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
                    <label>Họ và tên<input value={personnelDraft.name} onChange={(event) => setPersonnelDraft({ ...personnelDraft, name: event.target.value })} autoFocus required /></label>
                    <label>Ngày sinh<input value={personnelDraft.birthDate} maxLength={10} inputMode="numeric" placeholder="11/11/1999" onChange={(event) => setPersonnelDraft({ ...personnelDraft, birthDate: formatDesignDateInput(event.target.value) })} /></label>
                    <label>Số điện thoại<input value={personnelDraft.phone} inputMode="tel" onChange={(event) => setPersonnelDraft({ ...personnelDraft, phone: event.target.value })} /></label>
                    <label>Chức vụ<input value={personnelDraft.role} onChange={(event) => setPersonnelDraft({ ...personnelDraft, role: event.target.value })} /></label>
                    <label>Địa chỉ<input value={personnelDraft.address} onChange={(event) => setPersonnelDraft({ ...personnelDraft, address: event.target.value })} /></label>
                    <div><button type="button" className="personnel-back" onClick={() => { setPersonnelAddOpen(false); setEditingPersonnelId(null); }}>Hủy</button><button className="add-button" type="submit">{editingPersonnelId ? "Lưu thay đổi" : "Lưu nhân lực"}</button></div>
                  </form>}
                  {visiblePersonnel.length ? <div className="personnel-table-wrap"><table className="personnel-table"><thead><tr><th>Hoạt động</th><th>Họ và tên</th><th>Ngày sinh</th><th>Số điện thoại</th><th>Chức vụ</th><th>Địa chỉ</th><th /></tr></thead><tbody>{visiblePersonnel.map((member) => <tr key={member.id}><td><div className={`personnel-status personnel-status--${member.status === "Có" ? "active" : member.status === "Không" ? "inactive" : "paused"}`}><span className="personnel-status__figure" aria-hidden="true" /><select value={member.status ?? "Có"} onChange={(event) => updatePersonnelStatus(member.id, event.target.value as PersonnelStatus)} aria-label={`Hoạt động của ${member.name}`}>{personnelStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></div></td><td><b>{member.name}</b></td><td>{member.birthDate || "—"}</td><td>{normalizePersonnelPhone(member.phone) || "—"}</td><td>{member.role || "—"}</td><td>{member.address || "—"}</td><td className="personnel-row-actions"><button type="button" className="personnel-more" onClick={() => setPersonnelMenuId(personnelMenuId === member.id ? null : member.id)} aria-label={`Tùy chọn ${member.name}`}>…</button>{personnelMenuId === member.id && <div className="personnel-row-menu"><button type="button" onClick={() => openPersonnelEditor(member)}>Thay đổi</button><button type="button" className="personnel-row-menu__delete" onClick={() => removePersonnel(member.id)}>Xóa</button></div>}</td></tr>)}</tbody></table></div> : !personnelAddOpen && <div className="customer-search-empty"><span>{selectedPersonnelCategory?.icon}</span><p>{loadingPersonnel ? "Đang nạp danh sách nhân lực…" : <>Chưa có dữ liệu trong nhóm <b>{selectedPersonnelCategory?.label}</b>.</>}</p></div>}
                </div>
              </section>
            </div>
          ) : (
            <div className="customer-gateway__body">
              <div className="personnel-entry customer-entry">
                <span className="personnel-entry__icon customer-entry__icon">▰</span>
                <span><b>Khách hàng</b><small>Chọn hồ sơ trước khi làm việc</small></span>
                <em>{customerSearchResults.length} hồ sơ</em>
              </div>
              <label className="customer-search">
                <span>⌕</span>
                <input autoFocus value={search} onChange={(event) => { setSearch(event.target.value); searchCustomersOnDrive(event.target.value); }} placeholder="Tìm tên, mã nhà hoặc ID dự án…" aria-label="Tìm khách hàng" />
              </label>

              <div className="customer-period" aria-label="Chọn thời gian khách hàng">
                <label>Tháng<select value={selectedMonth} onChange={(event) => setSelectedMonth(Number(event.target.value))}>{monthLabels.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label>
                <label>Năm<select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>{availableModalYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
                <span>Đang hiện hồ sơ trong <b>T{selectedMonth} / {selectedYear}</b></span>
              </div>

              <div className="customer-search-results" aria-live="polite">
                {customerSearchResults.length ? customerSearchResults.map((location) => (
                  <button className="customer-result" key={`${location.year}-${location.month}-${location.record.id}`} onClick={() => selectCustomer(location)}>
                    <span className="customer-result__folder">▰</span>
                    <span className="customer-result__identity"><b>{location.record.name}</b><small>{location.record.projectId}{location.record.houseId ? ` · ${location.record.houseId}` : ""}</small></span>
                    <span className="customer-result__date">T{location.month} / {location.year}</span>
                    <span className="customer-result__arrow">→</span>
                  </button>
                )) : (
                  <div className="customer-search-empty"><span>∅</span><p>{search.trim() ? `Không tìm thấy khách hàng phù hợp trong T${selectedMonth}/${selectedYear}.` : `Chưa có khách hàng trong T${selectedMonth}/${selectedYear}.`}</p><button onClick={openAddDialog}>Tạo khách hàng mới</button></div>
                )}
              </div>

              <button className="personnel-entry" onClick={() => { setPersonnelView(true); setSelectedPersonnelCategoryId(personnelCategories[0]?.id ?? null); setPersonnelSearch(""); }}>
                <span className="personnel-entry__icon">♙</span>
                <span><b>Nhân lực</b><small>Mở khu vực quản lý nhân sự riêng</small></span>
                <em>→</em>
              </button>
            </div>
          )}
          {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}
        </section>
      )}

      <aside className="sidebar">
        <div className="brand brand--with-logo"><img src={`${import.meta.env.BASE_URL}gm-logo.png`} alt="GM-manager" /><span className="brand__wordmark">GM-manager</span></div>
        <p className="sidebar-label sidebar-label--top">Quy trình công việc</p>
        <nav className="main-nav" aria-label="Quy trình GM-manager">
          {syncedDriveFolders.filter((folder) => folder.label !== "Nhân lực").map((folder) => (
            <button key={folder.label} onClick={() => setActiveFolder(folder.label)} className={`nav-row ${activeFolder === folder.label ? "nav-row--active" : ""}`}>
              <span className="nav-row__icon">{folder.icon}</span>
              <span>{folder.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="customer-context" onClick={returnToCustomerSearch}>
            <span className="customer-context__back">←</span>
            <span><small>Khách hàng đang chọn</small><b>{selectedCustomerLocation?.record.name ?? "Chọn lại khách hàng"}</b><em>{selectedCustomerLocation?.record.projectId}{selectedCustomerLocation?.record.houseId ? ` · ${selectedCustomerLocation.record.houseId}` : ""}</em></span>
          </button>
          <div className="topbar__actions">{renderMobileAppActions()}<button className={`drive-status ${isDriveConnected ? "drive-status--connected" : ""}`} onClick={() => setDriveConfigOpen(true)}><i /> {isDriveConnected ? "Drive đã kết nối" : "Kết nối Drive"}</button><button className="reload-drive" onClick={() => void loadWorkspaceFromDrive(undefined, false, { force: true })} disabled={isLoadingDrive}>{isLoadingDrive ? "Đang nạp…" : "Nạp lại Drive"}</button></div>
        </header>

        {activeFolder === "Tư vấn" ? (
          <section className="consulting-view">
            <label className="customer-search consulting-search">
              <span>⌕</span>
              <input value={consultingSearch} onChange={(event) => setConsultingSearch(event.target.value)} placeholder="Search trong Phiếu thông tin khách hàng…" aria-label="Search Phiếu thông tin khách hàng" />
              {consultingSearch && <button type="button" onClick={() => setConsultingSearch("")} aria-label="Xóa nội dung Search">×</button>}
            </label>

            {selectedRecord && <section className="record-detail record-detail--inline">
              <header className="record-detail__heading">
                <div className="record-detail__identity"><p className="eyebrow">Tư vấn · Phiếu thông tin khách hàng</p><h2>{selectedRecord.projectId}</h2><GrowingTextarea className="record-detail__name-input" value={selectedRecord.name} onChange={(event) => updateRecordName(event.target.value)} placeholder="Nhập tên khách hàng" aria-label="Tên khách hàng" /><span>{selectedRecord.houseId ? `Mã nhà: ${selectedRecord.houseId} · ` : ""}Khởi tạo {selectedRecord.createdAt}</span></div>
                  <div className="consulting-profile-actions">
                  <div className="export-actions"><div className="design-progress-view__status"><i className={syncingRecordId === selectedRecord.id || loadingCustomerId === selectedRecord.projectId ? "is-syncing" : ""} />{loadingCustomerId === selectedRecord.projectId ? "Đang nạp chi tiết hồ sơ…" : syncingRecordId === selectedRecord.id ? "Đang xuất Excel…" : "Dữ liệu đã lưu"}</div><button type="button" className="export-button" onClick={() => void syncRecordToDrive(selectedRecord, selectedYear, selectedMonth)} disabled={syncingRecordId === selectedRecord.id || loadingCustomerId === selectedRecord.projectId}>⇩ Export Excel</button></div>
                  <div className="project-actions">
                    <button className="more-button" onClick={() => setOpenMenuId(openMenuId === selectedRecord.id ? null : selectedRecord.id)} aria-label={`Tùy chọn ${selectedRecord.projectId}`}>…</button>
                    {openMenuId === selectedRecord.id && <div className="project-menu">
                      <button onClick={() => startProtectedAction("rename", selectedRecord)}>Rename</button>
                      <button className="project-menu__delete" onClick={() => startProtectedAction("delete", selectedRecord)}>Delete</button>
                    </div>}
                  </div>
                </div>
              </header>
              <div className="detail-scroll">
                {loadingCustomerId === selectedRecord.projectId && <div className="customer-detail-loading">Đang nạp Excel chi tiết của {selectedRecord.projectId}…</div>}
                {!hasConsultingSearchResults && <div className="consulting-search-empty"><span>∅</span><p>Không tìm thấy nội dung phù hợp với “{consultingSearch}”.</p></div>}
                {visibleDetailSections.length > 0 && <table className="information-table">
                  <thead><tr><th>Nội dung</th><th>Kết quả thu thập</th></tr></thead>
                  <tbody>{visibleDetailSections.map((section) => <Fragment key={section.title}>
                    <tr className="information-table__section"><th colSpan={2}>{section.title}</th></tr>
                    {section.fields.map((field) => <tr key={field.code}>
                      <td>{field.label} <span className="field-code">({field.code})</span></td>
                      <td>{demandCheckboxCodes.has(field.code) ? <label className="demand-checkbox"><input type="checkbox" checked={Boolean(selectedRecord.details?.[field.code]?.trim())} onChange={(event) => updateRecordDetail(field.code, event.target.checked ? "Có" : "")} /><span>Chọn nhu cầu này</span></label> : dateDetailCodes.has(field.code) ? <input aria-label={field.label} value={selectedRecord.details?.[field.code] ?? ""} maxLength={10} inputMode="numeric" onChange={(event) => updateRecordDetail(field.code, event.target.value)} placeholder="11/11/1999" /> : field.options ? <select aria-label={field.label} value={selectedRecord.details?.[field.code] ?? ""} onChange={(event) => updateRecordDetail(field.code, event.target.value)}>
                        <option value="">Chọn giá trị</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select> : <GrowingTextarea aria-label={field.label} value={selectedRecord.details?.[field.code] ?? ""} onChange={(event) => updateRecordDetail(field.code, event.target.value)} placeholder="Nhập kết quả thu thập" />}</td>
                    </tr>)}
                  </Fragment>)}</tbody>
                </table>}

                {consultingSearchMatchesFunctional && <section className="dynamic-information">
                  <h3>4. Thông tin công năng</h3>
                  <p>Gõ tối thiểu 2 ký tự để xem gợi ý gần đúng, hoặc bắt đầu bằng <b>@</b> để nhập phòng mới.</p>
                  <table className="functional-table">
                    <thead><tr><th>Tầng</th><th>Công năng</th><th>Số lượng</th><th>Mô tả chi tiết</th></tr></thead>
                    <tbody>{functionalFloors.flatMap((floor) => floor.rooms.map((room, roomIndex) => <tr key={room.id}>
                      {roomIndex === 0 && <td rowSpan={floor.rooms.length} className="functional-floor"><div className="floor-cell">
                        <input value={floor.floor} onChange={(event) => updateFunctionalFloor(floor.id, event.target.value)} aria-label="Tên tầng" />
                        <span><button type="button" onClick={addFunctionalFloor} aria-label="Thêm tầng">+</button><button type="button" onClick={() => removeFunctionalFloor(floor.id)} disabled={functionalFloors.length === 1} aria-label="Xóa tầng">−</button></span>
                      </div></td>}
                      <td><div className="room-autocomplete">
                        <GrowingTextarea className="room-autocomplete__input" value={room.room} onChange={(event) => { updateFunctionalRoom(floor.id, room.id, "room", event.target.value); setRoomSuggestionFor(room.id); }} onBlur={(event) => { window.setTimeout(() => setRoomSuggestionFor(null), 120); validateRoom(floor.id, room.id, event.target.value); }} onKeyDown={(event) => { if (event.key === "Escape") setRoomSuggestionFor(null); }} placeholder="Gõ để tìm hoặc @Phòng mới" aria-autocomplete="list" aria-expanded={roomSuggestionFor === room.id && getRoomSuggestions(room.room).length > 0} />
                        {roomSuggestionFor === room.id && getRoomSuggestions(room.room).length > 0 && <div className="room-suggestions" role="listbox" aria-label="Gợi ý công năng">{getRoomSuggestions(room.room).map((suggestion) => <button key={suggestion} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => { updateFunctionalRoom(floor.id, room.id, "room", suggestion); setRoomSuggestionFor(null); }}>{suggestion}</button>)}</div>}
                      </div></td>
                      <td><input inputMode="numeric" value={room.quantity} onChange={(event) => updateFunctionalRoom(floor.id, room.id, "quantity", event.target.value)} placeholder="0" /></td>
                      <td><GrowingTextarea className="functional-description" value={room.description} onChange={(event) => updateFunctionalRoom(floor.id, room.id, "description", event.target.value)} placeholder="Nhập mô tả" /></td>
                    </tr>))}</tbody>
                  </table>
                </section>}

                {visibleSystemFields.length > 0 && <section className="dynamic-information system-information">
                  <h3>5. Thông tin hệ thống</h3>
                  <table className="information-table"><thead><tr><th>Nội dung</th><th>Kết quả thu thập</th></tr></thead><tbody>{visibleSystemFields.map((field) => <tr key={field.code}><td>{field.label} <span className="field-code">({field.code})</span></td><td><LineListEditor ariaLabel={field.label} value={selectedRecord.details?.[field.code] ?? ""} onChange={(value) => updateRecordDetail(field.code, value)} placeholder="Nhập kết quả thu thập" /></td></tr>)}</tbody></table>
                </section>}

                {consultingSearchMatchesAudio && <section className="dynamic-information system-information audio-information">
                  <div className="audio-information__heading"><div><h3>6. Thông tin ghi âm</h3><p>File được lưu trong thư mục khách hàng. Mỗi đoạn xong sẽ ghi ngay vào Excel; nếu dừng giữa chừng, lần sau tiếp tục từ đoạn chưa làm.</p></div>
                    <div className="audio-information__actions">{audioProcessingId === selectedRecord.id ? <button type="button" className="audio-import-button audio-import-button--busy" disabled>{audioProcessingStatus || "Đang xử lý…"}</button> : hasPendingAudio ? <button type="button" className="audio-import-button audio-resume-button" onClick={() => void resumeAudioProcessing(selectedRecord)}>Tiếp tục từ đoạn {audioCompletedChunks + 1}/{audioTotalChunks}</button> : <label className="audio-import-button"><input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" onChange={importAudioNote} />{selectedAudioNote ? "Add ghi âm mới" : "Add ghi âm"}</label>}{selectedAudioNote && audioProcessingId !== selectedRecord.id && <button type="button" className="audio-delete-button" onClick={() => void deleteAudioNote(selectedRecord)}>Xóa ghi âm</button>}</div>
                  </div>
                  {selectedAudioNote && <div className="audio-note">
                    <p className="audio-note__meta">{selectedAudioNote.fileName} · {selectedAudioNote.language} · Đã hoàn thành {audioCompletedChunks}/{audioTotalChunks} đoạn · {selectedAudioNote.updatedAt}</p>
                    {audioDisplayChunks.length ? audioDisplayChunks.map((chunk) => <section className="audio-chunk" key={chunk.index}><h4>Đoạn {chunk.index + 1}/{audioTotalChunks}</h4><div className="audio-chunk__transcript"><strong>Nội dung chuyển từ ghi âm</strong>{chunk.segments.map((segment, index) => <p key={`${segment.time}-${index}`}><b>{segment.time}</b>{segment.text}</p>)}</div></section>) : <p className="audio-note__empty">File ghi âm đã lưu vào Drive. Chưa có đoạn nào được xử lý.</p>}
                  </div>}
                </section>}
              </div>
              <footer className="record-detail__footer"><span>{syncingRecordId === selectedRecord.id ? "Đang xuất Excel vào Drive…" : "Xuất Excel khi cần bằng nút Export Excel"}</span><span>GM-Manager / Khách hàng / {selectedYear} / T{selectedMonth} / {selectedRecord.projectId} / Tư vấn</span></footer>
            </section>}
          </section>
        ) : activeFolder === "Thiết kế" ? (
          <section className="design-workspace">
            {renderWorkflowCustomerSearch()}
            <section className="design-progress-view design-progress-view--bare">
              <div className="design-schedules">
                {renderDesignSchedule("architecture")}
                {renderDesignSchedule("interior")}
              </div>
            </section>
          </section>
        ) : activeFolder === "Bảo hành" ? (
          <section className="design-workspace warranty-workspace">
            {renderWorkflowCustomerSearch()}
            <section className="design-progress-view design-progress-view--bare">
              {renderWarrantySchedule()}
            </section>
          </section>
        ) : activeFolder === "Tài liệu" ? (
          <section className="document-workspace">
            {renderDocumentLibrary()}
          </section>
        ) : (
          <section className="workflow-page">
            {renderWorkflowCustomerSearch()}
            <section className="coming-soon">
              <span>{activeDriveFolder?.icon}</span><p className="eyebrow">GM-manager</p><h1>{activeFolder}</h1>
              <p>Khu vực {activeFolder} của <b>{selectedCustomerLocation?.record.name}</b> · {selectedCustomerLocation?.record.projectId}. Dữ liệu sẽ nằm trong thư mục <b>{activeFolder}</b> bên trong đúng hồ sơ khách hàng này.</p>
            </section>
          </section>
        )}
        {activeFolder !== "Tài liệu" && selectedCustomerLocation && renderWorkflowFiles()}
        {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}
      </section>

      {addOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setAddOpen(false)}>
          <form className="add-dialog" onSubmit={addCustomer} onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="dialog-close" onClick={() => setAddOpen(false)} aria-label="Đóng">×</button>
            <p className="eyebrow">Tạo thư mục dự án</p><h2>Add customer</h2>
            <label>Tháng<select value={modalMonth} onChange={(event) => setModalMonth(Number(event.target.value))}>{monthLabels.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></label>
            <label>Năm<select value={modalYear} onChange={(event) => setModalYear(Number(event.target.value))}>{availableModalYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
            <label>Tên khách hàng<input autoFocus value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Ví dụ: Lê Thanh K" /></label>
            <label>Mã nhà <span className="field-code">(IDH)</span><input value={houseId} onChange={(event) => setHouseId(event.target.value)} placeholder="Ví dụ: BT-08" /></label>
            <p className="id-preview">ID dự kiến: <b>GM{String(getVietnamDate().day).padStart(2, "0")}{String(getVietnamDate().month).padStart(2, "0")}{getVietnamDate().year}{customerName ? nameInitials(customerName) : "..."}</b></p>
            <button className="add-button" type="submit">Tạo thư mục</button>
          </form>
        </div>
      )}

      {driveConfigOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setDriveConfigOpen(false)}>
          <form className="add-dialog drive-config-dialog" onSubmit={saveDriveConfig} onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="dialog-close" onClick={() => setDriveConfigOpen(false)} aria-label="Đóng">×</button>
            <p className="eyebrow">Google Apps Script</p><h2>Kết nối Drive</h2>
            <p className="drive-config-dialog__hint">Chỉ cần dán Web app URL. GM-CRM sẽ nhớ kết nối trên thiết bị này.</p>
            <a className="script-link" href="gm-crm-drive-script.js" target="_blank" rel="noreferrer">Xem mã Apps Script đang tự động cập nhật ↗</a>
            <label>Web app URL<input value={driveScriptUrl} onChange={(event) => setDriveScriptUrl(event.target.value)} placeholder="https://script.google.com/macros/s/.../exec" autoFocus /></label>
            <button className="add-button" type="submit">Lưu kết nối</button>
          </form>
        </div>
      )}

      {mobileInstallHelp && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setMobileInstallHelp(null)}>
          <section className="security-dialog install-help-dialog" role="dialog" aria-label="Cài GM-CRM" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="dialog-close" onClick={() => setMobileInstallHelp(null)} aria-label="Đóng">×</button>
            <p className="eyebrow">{mobileInstallHelp === "ios" ? "iPhone / iPad" : mobileInstallHelp === "android" ? "Android" : "Máy tính Windows / macOS"}</p><h2>Cài GM-CRM</h2>
            {mobileInstallHelp === "ios" ? <ol><li>Mở trang này bằng <b>Safari</b>.</li><li>Nhấn nút <b>Chia sẻ</b> ở thanh dưới.</li><li>Chọn <b>Thêm vào Màn hình chính</b>, rồi nhấn Thêm.</li></ol> : mobileInstallHelp === "android" ? <ol><li>Mở trang bằng <b>Chrome</b>.</li><li>Nhấn dấu <b>⋮</b> ở góc trên.</li><li>Chọn <b>Cài đặt ứng dụng</b> hoặc <b>Thêm vào màn hình chính</b>.</li></ol> : <ol><li>Mở trang bằng <b>Chrome</b> hoặc <b>Microsoft Edge</b>.</li><li>Nhấn biểu tượng <b>Cài đặt ứng dụng</b> ở bên phải thanh địa chỉ; nếu chưa thấy, mở menu <b>⋮</b>.</li><li>Chọn <b>Cài đặt GM-CRM</b> rồi xác nhận Cài đặt.</li></ol>}
            <p>{mobileInstallHelp === "desktop" ? "Trên Windows, nút Cài ứng dụng sẽ tải bộ cài GM-CRM dạng .exe." : "Icon GM sẽ xuất hiện trên màn hình chính như một ứng dụng."}</p>
          </section>
        </div>
      )}

      {protectedAction && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setProtectedAction(null)}>
          {protectedAction.type === "delete" ? (
            <div className="security-dialog" role="dialog" aria-label="Xác nhận xóa" onMouseDown={(event) => event.stopPropagation()}>
              <button type="button" className="dialog-close" onClick={() => setProtectedAction(null)} aria-label="Đóng">×</button>
              <p className="eyebrow">{protectedAction.record.projectId}</p>
              <h2>Xóa hồ sơ?</h2>
              <p>Thao tác này sẽ xóa hồ sơ khỏi danh sách hiện tại.</p>
              <div className="dialog-actions"><button type="button" onClick={() => setProtectedAction(null)}>Hủy</button><button className="add-button" type="button" onClick={confirmDeleteRecord}>Xóa hồ sơ</button></div>
            </div>
          ) : (
            <form className="security-dialog" onSubmit={renameRecord} onMouseDown={(event) => event.stopPropagation()}>
              <button type="button" className="dialog-close" onClick={() => setProtectedAction(null)} aria-label="Đóng">×</button>
              <p className="eyebrow">{protectedAction.record.projectId}</p>
              <h2>Rename hồ sơ</h2>
              <label>Tên khách hàng<input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} autoFocus /></label>
              <button className="add-button" type="submit">Lưu tên mới</button>
            </form>
          )}
        </div>
      )}

      {selectedRecordId && selectedRecord && (
        <div className="detail-backdrop" role="presentation" onMouseDown={() => setSelectedRecordId(null)}>
          <section className="record-detail" onMouseDown={(event) => event.stopPropagation()}>
            <header className="record-detail__heading">
              <div className="record-detail__identity"><p className="eyebrow">Hồ sơ dự án</p><h2>{selectedRecord.projectId}</h2><GrowingTextarea className="record-detail__name-input" value={selectedRecord.name} onChange={(event) => updateRecordName(event.target.value)} placeholder="Nhập tên khách hàng" aria-label="Tên khách hàng" /></div>
              <button className="dialog-close" onClick={() => setSelectedRecordId(null)} aria-label="Đóng">×</button>
            </header>
            <div className="detail-scroll">
              <table className="information-table">
                <thead><tr><th>Nội dung</th><th>Kết quả thu thập</th></tr></thead>
                <tbody>
                  {detailSections.map((section) => (
                    <Fragment key={section.title}>
                      <tr className="information-table__section"><th colSpan={2}>{section.title}</th></tr>
                      {section.fields.map((field) => (
                        <tr key={field.code}>
                          <td>{field.label} <span className="field-code">({field.code})</span></td>
                          <td>{dateDetailCodes.has(field.code) ? (
                            <input aria-label={field.label} value={selectedRecord.details?.[field.code] ?? ""} maxLength={10} inputMode="numeric" onChange={(event) => updateRecordDetail(field.code, event.target.value)} placeholder="11/11/1999" />
                          ) : field.options ? (
                            <select aria-label={field.label} value={selectedRecord.details?.[field.code] ?? ""} onChange={(event) => updateRecordDetail(field.code, event.target.value)}>
                              <option value="">Chọn giá trị</option>
                              {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                            </select>
                          ) : <GrowingTextarea aria-label={field.label} value={selectedRecord.details?.[field.code] ?? ""} onChange={(event) => updateRecordDetail(field.code, event.target.value)} placeholder="Nhập kết quả thu thập" />}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>

              <section className="dynamic-information">
                <h3>4. Thông tin công năng</h3>
                <p>Gõ tối thiểu 2 ký tự để xem gợi ý gần đúng, hoặc bắt đầu bằng <b>@</b> để nhập phòng mới.</p>
                <table className="functional-table">
                  <thead><tr><th>Tầng</th><th>Công năng</th><th>Số lượng</th><th>Mô tả chi tiết</th></tr></thead>
                  <tbody>
                    {functionalFloors.flatMap((floor) => floor.rooms.map((room, roomIndex) => (
                      <tr key={room.id}>
                        {roomIndex === 0 && (
                          <td rowSpan={floor.rooms.length} className="functional-floor">
                            <div className="floor-cell">
                              <input value={floor.floor} onChange={(event) => updateFunctionalFloor(floor.id, event.target.value)} aria-label="Tên tầng" />
                              <span><button type="button" onClick={addFunctionalFloor} aria-label="Thêm tầng">+</button><button type="button" onClick={() => removeFunctionalFloor(floor.id)} disabled={functionalFloors.length === 1} aria-label="Xóa tầng">−</button></span>
                            </div>
                          </td>
                        )}
                        <td>
                          <div className="room-autocomplete">
                            <GrowingTextarea
                              className="room-autocomplete__input"
                              value={room.room}
                              onChange={(event) => { updateFunctionalRoom(floor.id, room.id, "room", event.target.value); setRoomSuggestionFor(room.id); }}
                              onBlur={(event) => { window.setTimeout(() => setRoomSuggestionFor(null), 120); validateRoom(floor.id, room.id, event.target.value); }}
                              onKeyDown={(event) => { if (event.key === "Escape") setRoomSuggestionFor(null); }}
                              placeholder="Gõ để tìm hoặc @Phòng mới"
                              aria-autocomplete="list"
                              aria-expanded={roomSuggestionFor === room.id && getRoomSuggestions(room.room).length > 0}
                            />
                            {roomSuggestionFor === room.id && getRoomSuggestions(room.room).length > 0 && (
                              <div className="room-suggestions" role="listbox" aria-label="Gợi ý công năng">
                                {getRoomSuggestions(room.room).map((suggestion) => (
                                  <button key={suggestion} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => { updateFunctionalRoom(floor.id, room.id, "room", suggestion); setRoomSuggestionFor(null); }}>
                                    {suggestion}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td><input inputMode="numeric" value={room.quantity} onChange={(event) => updateFunctionalRoom(floor.id, room.id, "quantity", event.target.value)} placeholder="0" /></td>
                        <td><GrowingTextarea className="functional-description" value={room.description} onChange={(event) => updateFunctionalRoom(floor.id, room.id, "description", event.target.value)} placeholder="Nhập mô tả" /></td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </section>

              <section className="dynamic-information system-information">
                <h3>5. Thông tin hệ thống</h3>
                <table className="information-table">
                  <thead><tr><th>Nội dung</th><th>Kết quả thu thập</th></tr></thead>
                  <tbody>{systemFields.map((field) => (
                    <tr key={field.code}><td>{field.label} <span className="field-code">({field.code})</span></td><td><LineListEditor ariaLabel={field.label} value={selectedRecord.details?.[field.code] ?? ""} onChange={(value) => updateRecordDetail(field.code, value)} placeholder="Nhập kết quả thu thập" /></td></tr>
                  ))}</tbody>
                </table>
              </section>

              <section className="dynamic-information system-information audio-information">
                <div className="audio-information__heading">
                  <div>
                    <h3>6. Thông tin ghi âm</h3>
                    <p>File được lưu trong thư mục khách hàng. Mỗi đoạn xong sẽ ghi ngay vào Excel; nếu dừng giữa chừng, lần sau tiếp tục từ đoạn chưa làm.</p>
                  </div>
                  <div className="audio-information__actions">
                    {audioProcessingId === selectedRecord.id ? (
                      <button type="button" className="audio-import-button audio-import-button--busy" disabled>{audioProcessingStatus || "Đang xử lý…"}</button>
                    ) : hasPendingAudio ? (
                      <button type="button" className="audio-import-button audio-resume-button" onClick={() => void resumeAudioProcessing(selectedRecord)}>
                        Tiếp tục từ đoạn {audioCompletedChunks + 1}/{audioTotalChunks}
                      </button>
                    ) : (
                      <label className="audio-import-button">
                        <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" onChange={importAudioNote} />
                        {selectedAudioNote ? "Add ghi âm mới" : "Add ghi âm"}
                      </label>
                    )}
                    {selectedAudioNote && audioProcessingId !== selectedRecord.id && <button type="button" className="audio-delete-button" onClick={() => void deleteAudioNote(selectedRecord)}>Xóa ghi âm</button>}
                  </div>
                </div>
                {selectedAudioNote && (
                  <div className="audio-note">
                    <p className="audio-note__meta">{selectedAudioNote.fileName} · {selectedAudioNote.language} · Đã hoàn thành {audioCompletedChunks}/{audioTotalChunks} đoạn · {selectedAudioNote.updatedAt}</p>
                    {audioDisplayChunks.length ? audioDisplayChunks.map((chunk) => (
                      <section className="audio-chunk" key={chunk.index}>
                        <h4>Đoạn {chunk.index + 1}/{audioTotalChunks}</h4>
                        <div className="audio-chunk__transcript">
                          <strong>Nội dung chuyển từ ghi âm</strong>
                          {chunk.segments.map((segment, index) => <p key={`${segment.time}-${index}`}><b>{segment.time}</b>{segment.text}</p>)}
                        </div>
                      </section>
                    )) : <p className="audio-note__empty">File ghi âm đã lưu vào Drive. Chưa có đoạn nào được xử lý.</p>}
                  </div>
                )}
              </section>
            </div>
            <footer className="record-detail__footer"><span>{syncingRecordId === selectedRecord.id ? "Đang cập nhật Excel vào Drive…" : isDriveConnected ? "Tự động đồng bộ Excel sau mỗi thay đổi" : "Kết nối Drive để tự động đồng bộ Excel"}</span><button className="add-button" onClick={() => setSelectedRecordId(null)}>Hoàn tất</button></footer>
          </section>
        </div>
      )}
    </main>
  );
}
