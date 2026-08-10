"use client";

import { ChangeEvent, FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { TextareaHTMLAttributes } from "react";

type AudioSegment = {
  time: string;
  text: string;
};

type AudioNote = {
  fileName: string;
  language: string;
  updatedAt: string;
  segments: AudioSegment[];
  keyPoints: string[];
};

type AudioInsightResult = {
  language?: string;
  segments: AudioSegment[];
  keyPoints: string[];
  apiCallsUsed?: number;
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

type WorkRecord = {
  id: string;
  name: string;
  houseId?: string;
  projectId: string;
  createdAt: string;
  details: Record<string, string>;
  audioNote?: AudioNote;
  functionalFloors?: FunctionalFloor[];
  functionalRows?: LegacyFunctionalRow[];
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

type DriveFolder = {
  label: string;
  icon: string;
  url: string;
};

type DriveSyncConfig = {
  scriptUrl: string;
  token: string;
};

const monthLabels = Array.from({ length: 12 }, (_, index) => `T${index + 1}`);
const AUDIO_OUTPUT_SAMPLE_RATE = 16_000;
// Keep every browser upload below 1 MB. The hosting edge can reject larger
// multipart bodies before the request reaches the application worker.
const MAX_AUDIO_CHUNK_BYTES = 700 * 1024;
const MAX_DIRECT_AUDIO_BYTES = 600 * 1024;
const MAX_AUDIO_CHUNK_SECONDS = Math.floor((MAX_AUDIO_CHUNK_BYTES - 44) / (AUDIO_OUTPUT_SAMPLE_RATE * 2));
const buildMonths = (): MonthFolder[] => monthLabels.map((label) => ({ label, records: [] }));
const driveSyncConfigKey = "gm-manager-apps-script";
const defaultDriveSyncConfig: DriveSyncConfig = {
  scriptUrl: "https://script.google.com/macros/s/AKfycbx-O6jHLrtU-4GcpoWganEIAFxISrNpZD0lYRt5YK8fxzX7nBIsCHtAMvkQ68-Dxkbr/exec",
  token: "010101",
};

const syncedDriveFolders: DriveFolder[] = [
  { label: "-DATA", icon: "◫", url: "https://drive.google.com/drive/folders/1KtXRW5p5tuY4qLC8q0hOG5dcKtnCfCu-" },
  { label: "Tư vấn", icon: "⌂", url: "https://drive.google.com/drive/folders/1Yab8uHBsD52C2MYsfAf3gMB5J6QCyqDt" },
  { label: "Thiết kế", icon: "▣", url: "https://drive.google.com/drive/folders/1DZ9x1xvDFj2C_1tgPw9hxXGWwxbgO7q5" },
  { label: "Dự toán", icon: "⌁", url: "https://drive.google.com/drive/folders/1loJbkEr_FT8iWf0Q4yFPKf6z4GmDJd9B" },
  { label: "Thi công", icon: "♧", url: "https://drive.google.com/drive/folders/1l8QbIOmsjUPxk7WSQP0rhvp9__I7fwyc" },
  { label: "Nghiệm thu", icon: "✓", url: "https://drive.google.com/drive/folders/1UtILAuZidLcluaheQDxGt4XXeUUa5rOr" },
  { label: "Bảo hành", icon: "⚙", url: "https://drive.google.com/drive/folders/1xPYkwM5i6tO9F_O5aPAAVKbtKecj6_U_" },
  { label: "Nhân lực", icon: "♙", url: "https://drive.google.com/drive/folders/1tQEoQPp38kinet7FzjVFF0-k6O7YJqcN" },
].filter((folder) => !folder.label.startsWith("-"));

const initialYears: YearFolder[] = [
  { year: 2024, months: buildMonths() },
  { year: 2025, months: buildMonths() },
  { year: 2026, months: buildMonths() },
];

const team = [
  ["SP", "Sandra Perry", "Product Manager", "lavender"],
  ["AC", "Antony Cardenas", "Sales Manager", "sand"],
  ["JC", "Jamal Connolly", "Growth Marketer", "rose"],
  ["CC", "Cara Cerr", "SEO Specialist", "sage"],
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

const systemFields: DetailField[] = [
  { code: "D", label: "Điện" },
  { code: "N", label: "Nước" },
  { code: "E", label: "Năng lượng" },
  { code: "EL", label: "Thang máy" },
  { code: "DR", label: "Cửa" },
];

const roomOptions = ["Phòng khách", "Phòng ngủ", "Phòng bếp", "Gara", "Sân trước", "Sân sau", "Giếng trời", "Phòng thay đồ", "WC", "Sân phơi", "Sân thượng", "Phòng thờ", "Thang bộ", "Thang máy", "Phòng sinh hoạt chung", "Phòng xem phim", "Phòng xông hơi", "Phòng làm việc", "Phòng học", "Khu vực kinh doanh", "Phòng kho", "Phòng ngủ master", "WC master", "Phòng giúp việc"];

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

function combineKeyPoints(results: AudioInsightResult[]) {
  const lists = results.map((result) => result.keyPoints);
  const seen = new Set<string>();
  const combined: string[] = [];
  for (let pointIndex = 0; combined.length < 12; pointIndex += 1) {
    let added = false;
    lists.forEach((points) => {
      const point = points[pointIndex]?.trim();
      const key = point?.toLocaleLowerCase("vi").replaceAll(/\s+/g, " ");
      if (point && key && !seen.has(key) && combined.length < 12) {
        seen.add(key);
        combined.push(point);
        added = true;
      }
    });
    if (!added) break;
  }
  return combined;
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

function saveWorkspace(years: YearFolder[]) {
  window.localStorage.setItem("gm-manager-consulting", JSON.stringify(years));
}

function preserveDriveRecordMetadata(driveYears: YearFolder[], localYears: YearFolder[]) {
  const localByProjectId = new Map(localYears.flatMap((year) => year.months.flatMap((month) => month.records)).map((record) => [record.projectId, record]));
  return driveYears.map((year) => ({
    ...year,
    months: monthLabels.map((label, index) => {
      const driveMonth = year.months?.find((month) => month.label === label) ?? year.months?.[index] ?? { label, records: [] };
      return {
        label,
        records: (driveMonth.records ?? []).map((record) => {
          const localRecord = localByProjectId.get(record.projectId);
          return {
            ...record,
            id: record.id || `drive-${record.projectId}`,
            name: record.name || localRecord?.name || record.details?.HVT || record.projectId,
            houseId: record.houseId || localRecord?.houseId || "",
            details: record.details ?? {},
          };
        }),
      };
    }),
  }));
}

export default function Home() {
  const now = getVietnamDate();
  const [activeFolder, setActiveFolder] = useState("Tư vấn");
  const [years, setYears] = useState<YearFolder[]>(initialYears);
  const [selectedYear, setSelectedYear] = useState(now.year);
  const [selectedMonth, setSelectedMonth] = useState(now.month);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [modalMonth, setModalMonth] = useState(now.month);
  const [modalYear, setModalYear] = useState(now.year);
  const [customerName, setCustomerName] = useState("");
  const [houseId, setHouseId] = useState("");
  const [notice, setNotice] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const [protectedAction, setProtectedAction] = useState<{ type: "rename" | "delete"; record: WorkRecord } | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [renameUnlocked, setRenameUnlocked] = useState(false);
  const [roomSuggestionFor, setRoomSuggestionFor] = useState<string | null>(null);
  const [driveConfigOpen, setDriveConfigOpen] = useState(false);
  const [driveScriptUrl, setDriveScriptUrl] = useState(defaultDriveSyncConfig.scriptUrl);
  const [driveSyncToken, setDriveSyncToken] = useState(defaultDriveSyncConfig.token);
  const [syncingRecordId, setSyncingRecordId] = useState<string | null>(null);
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);
  const [audioProcessingId, setAudioProcessingId] = useState<string | null>(null);
  const [audioProcessingStatus, setAudioProcessingStatus] = useState("");
  const driveSyncTimer = useRef<number | null>(null);

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

    // This public installation always uses the verified GM-CRM endpoint.
    // Replacing a stale value also fixes old tabs that saved an earlier deployment URL.
    setDriveScriptUrl(defaultDriveSyncConfig.scriptUrl);
    setDriveSyncToken(defaultDriveSyncConfig.token);
    window.localStorage.setItem(driveSyncConfigKey, JSON.stringify(defaultDriveSyncConfig));
  }, []);

  const activeDriveFolder = syncedDriveFolders.find((folder) => folder.label === activeFolder);
  const activeYear = years.find((folder) => folder.year === selectedYear);
  const activeMonthFolder = activeYear?.months[selectedMonth - 1];
  const isDriveConnected = Boolean(driveScriptUrl.trim() && driveSyncToken.trim());
  const availableModalYears = useMemo(() => {
    const currentYear = getVietnamDate().year;
    return Array.from(new Set([...years.map((folder) => folder.year), ...Array.from({ length: 9 }, (_, index) => currentYear - 3 + index)])).sort((a, b) => a - b);
  }, [years]);
  const visibleRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    const records = activeMonthFolder?.records ?? [];
    return term ? records.filter((record) => `${record.name} ${record.houseId ?? ""} ${record.projectId}`.toLowerCase().includes(term)) : records;
  }, [activeMonthFolder, search]);

  const persist = (nextYears: YearFolder[]) => {
    setYears(nextYears);
    saveWorkspace(nextYears);
  };

  const loadWorkspaceFromDrive = async (configOverride?: DriveSyncConfig, quietly = false) => {
    const config = configOverride ?? { scriptUrl: driveScriptUrl.trim(), token: driveSyncToken.trim() };
    if (!config.scriptUrl || !config.token) return;
    setIsLoadingDrive(true);
    try {
      const response = await fetch("/api/drive-load", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const result = await response.json() as { ok?: boolean; error?: string; years?: YearFolder[] };
      if (!response.ok || !result.ok || !result.years) throw new Error(result.error || "Không thể nạp dữ liệu Excel từ Drive.");
      const driveYears = preserveDriveRecordMetadata(result.years, years);
      if (driveYears.length) {
        persist(driveYears);
        if (!quietly) setNotice("Đã nạp lại hồ sơ từ Excel trên Drive.");
      }
    } catch (error) {
      if (!quietly) setNotice(error instanceof Error ? error.message : "Không thể nạp dữ liệu Excel từ Drive.");
    } finally {
      setIsLoadingDrive(false);
    }
  };

  useEffect(() => {
    void loadWorkspaceFromDrive(defaultDriveSyncConfig, true);
  }, []);

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
    setAddOpen(false);
    setNotice(`Đã tạo thư mục ${projectId} trong T${modalMonth}/${modalYear}`);
  };

  const deleteRecord = (id: string) => {
    const nextYears = years.map((yearFolder) => yearFolder.year !== selectedYear ? yearFolder : {
      ...yearFolder,
      months: yearFolder.months.map((monthFolder, index) => index !== selectedMonth - 1 ? monthFolder : { ...monthFolder, records: monthFolder.records.filter((record) => record.id !== id) }),
    });
    persist(nextYears);
    setNotice("Đã xóa dữ liệu — danh sách được cập nhật ngay");
  };

  const selectedRecord = activeMonthFolder?.records.find((record) => record.id === selectedRecordId) ?? null;

  const startProtectedAction = (type: "rename" | "delete", record: WorkRecord) => {
    setOpenMenuId(null);
    setProtectedAction({ type, record });
    setAccessCode("");
    setRenameValue(record.name);
    setRenameUnlocked(false);
  };

  const confirmAccessCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!protectedAction) return;
    if (accessCode !== "010101") {
      setNotice("Khóa không đúng");
      return;
    }
    if (protectedAction.type === "delete") {
      deleteRecord(protectedAction.record.id);
      setProtectedAction(null);
      setNotice(`Đã xóa ${protectedAction.record.projectId}`);
      return;
    }
    setRenameUnlocked(true);
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
    const updatedRecord = { ...selectedRecord, details: { ...(selectedRecord.details ?? {}), [key]: value } };
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
    const config = defaultDriveSyncConfig;

    const recordId = selectedRecord.id;
    setAudioProcessingId(recordId);
    setAudioProcessingStatus("Đang chuẩn bị bản ghi…");
    try {
      const chunks = await splitAudioForProcessing(file);
      const results: AudioInsightResult[] = [];
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        setAudioProcessingStatus(`Đang xử lý đoạn ${index + 1}/${chunks.length}…`);
        const formData = new FormData();
        formData.append("audio", chunk.file);
        formData.append("scriptUrl", config.scriptUrl);
        formData.append("token", config.token);
        let result: { ok?: boolean; error?: string; language?: string; segments?: AudioSegment[]; keyPoints?: string[]; apiCallsUsed?: number } | null = null;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const response = await fetch("/api/audio-insight", { method: "POST", body: formData });
          const responseText = await response.text();
          try {
            result = JSON.parse(responseText) as typeof result;
          } catch {
            if (response.status === 413 || /payload too large/i.test(responseText)) {
              throw new Error("Không thể gửi một đoạn ghi âm lên máy chủ. Hãy thử lại sau.");
            }
            throw new Error("Không thể đọc phản hồi khi xử lý file ghi âm. Hãy thử lại sau.");
          }
          if (response.ok && result?.ok && result.segments) break;
          const errorMessage = result?.error || "Không thể xử lý file ghi âm.";
          const retrySeconds = quotaRetrySeconds(errorMessage);
          if (!retrySeconds || attempt === 4) throw new Error(retrySeconds ? "Gemini miễn phí đang hết lượt tạm thời. Hãy thử lại sau vài phút." : errorMessage);
          await waitForAudioQuota(retrySeconds, (remaining) => setAudioProcessingStatus(`Gemini đang giới hạn lượt miễn phí · tiếp tục sau ${remaining} giây`));
          setAudioProcessingStatus(`Đang thử lại đoạn ${index + 1}/${chunks.length}…`);
        }
        if (!result?.segments) throw new Error("Không thể xử lý file ghi âm.");
        results.push({ language: result.language, segments: result.segments, keyPoints: result.keyPoints ?? [], apiCallsUsed: result.apiCallsUsed });
        if (index < chunks.length - 1) {
          const pauseSeconds = result.apiCallsUsed === 1 ? 15 : 65;
          await waitForAudioQuota(pauseSeconds, (remaining) => setAudioProcessingStatus(`Đã xong đoạn ${index + 1}/${chunks.length} · đoạn tiếp theo sau ${remaining} giây`));
        }
      }

      const segments = results.flatMap((result, index) => result.segments.map((segment) => ({
        time: formatAudioTime(chunks[index].offsetSeconds + parseAudioTime(segment.time)),
        text: segment.text,
      })));
      const keyPoints = combineKeyPoints(results);

      const audioNote: AudioNote = {
        fileName: file.name,
        language: results.find((result) => result.language)?.language || "Tiếng Việt",
        updatedAt: new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()),
        segments,
        keyPoints,
      };
      const updatedRecord = { ...selectedRecord, audioNote };
      const nextYears = years.map((yearFolder) => yearFolder.year !== selectedYear ? yearFolder : {
        ...yearFolder,
        months: yearFolder.months.map((monthFolder, index) => index !== selectedMonth - 1 ? monthFolder : {
          ...monthFolder,
          records: monthFolder.records.map((record) => record.id === recordId ? updatedRecord : record),
        }),
      });
      persist(nextYears);
      queueDriveSync(updatedRecord);
      setNotice(chunks.length > 1 ? `Đã xử lý ${chunks.length} đoạn ghi âm, tổng hợp văn bản và ý chính.` : "Đã chuyển ghi âm thành văn bản và lưu ý chính.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể xử lý file ghi âm.");
    } finally {
      setAudioProcessingId(null);
      setAudioProcessingStatus("");
      input.value = "";
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
    const config = { scriptUrl: driveScriptUrl.trim(), token: driveSyncToken.trim() };
    if (!config.scriptUrl.startsWith("https://script.google.com/macros/s/") || !config.token) {
      setNotice("Hãy nhập Web app URL và mã đồng bộ từ Google Apps Script.");
      return;
    }
    window.localStorage.setItem(driveSyncConfigKey, JSON.stringify(config));
    setDriveConfigOpen(false);
    setNotice("Đã kết nối Google Apps Script trên thiết bị này");
    if (selectedRecord) void syncRecordToDrive(selectedRecord, selectedYear, selectedMonth, config);
  };

  const syncRecordToDrive = async (record: WorkRecord, year = selectedYear, month = selectedMonth, configOverride?: DriveSyncConfig) => {
    const config = configOverride ?? { scriptUrl: driveScriptUrl.trim(), token: driveSyncToken.trim() };
    if (!config.scriptUrl || !config.token) {
      setDriveConfigOpen(true);
      return;
    }
    setSyncingRecordId(record.id);
    try {
      const response = await fetch("/api/drive-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scriptUrl: config.scriptUrl,
          token: config.token,
          year,
          month,
          record: { ...record, details: record.details ?? {}, functionalFloors: normalizeFunctionalFloors(record) },
        }),
      });
      const result = await response.json() as { ok?: boolean; error?: string; fileUrl?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Không thể tạo file Excel.");
      setNotice(`Đã xuất ${record.projectId}.xlsx vào Drive`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể kết nối Drive.");
    } finally {
      setSyncingRecordId(null);
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

  useEffect(() => () => {
    if (driveSyncTimer.current) window.clearTimeout(driveSyncTimer.current);
  }, []);

  return (
    <main className="crm-shell">
      <aside className="sidebar">
        <div className="brand">GM<span>-CRM</span></div>
        <p className="sidebar-label sidebar-label--top">Quy trình công việc</p>
        <nav className="main-nav" aria-label="Quy trình GM-manager">
          {syncedDriveFolders.map((folder) => (
            <button key={folder.label} onClick={() => setActiveFolder(folder.label)} className={`nav-row ${activeFolder === folder.label ? "nav-row--active" : ""}`}>
              <span className="nav-row__icon">{folder.icon}</span>
              <span>{folder.label}</span>
              <span className="nav-row__drive">↗</span>
            </button>
          ))}
        </nav>

        <section className="members">
          <div className="members__heading"><p className="sidebar-label">Members</p><button aria-label="Invite member" className="plain-plus">+</button></div>
          {team.map(([initials, name, role, color]) => (
            <div className="member" key={name}>
              <span className={`avatar avatar--${color}`}>{initials}</span>
              <span><b>{name}</b><small>{role}</small></span>
            </div>
          ))}
          <div className="member member--you"><span className="avatar avatar--you">IR</span><span><b>Ilona Rollins</b><small>CRM Specialist</small></span><span className="logout">↪</span></div>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <label className="search-box"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer..." aria-label="Search customer" /></label>
          <div className="topbar__actions"><button className={`drive-status ${isDriveConnected ? "drive-status--connected" : ""}`} onClick={() => setDriveConfigOpen(true)}><i /> {isDriveConnected ? "Drive đã kết nối" : "Kết nối Drive"}</button><button className="reload-drive" onClick={() => void loadWorkspaceFromDrive()} disabled={isLoadingDrive}>{isLoadingDrive ? "Đang nạp…" : "Nạp lại Drive"}</button><button className="add-button" onClick={openAddDialog}><span>＋</span> Add customer</button></div>
        </header>

        {activeFolder === "Tư vấn" ? (
          <section className="consulting-view">
            <div className="calendar-bar">
              <label>Tháng
                <select value={selectedMonth} onChange={(event) => setSelectedMonth(Number(event.target.value))}>
                  {monthLabels.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
                </select>
              </label>
              <label>Năm
                <select value={selectedYear} onChange={(event) => setSelectedYear(Number(event.target.value))}>
                  {years.map((folder) => <option key={folder.year} value={folder.year}>{folder.year}</option>)}
                </select>
              </label>
              <span className="calendar-bar__hint">Thư mục đang xem: <b>{activeMonthFolder?.label} / {selectedYear}</b></span>
              <a href={activeDriveFolder?.url} target="_blank" rel="noreferrer" className="drive-link">Mở thư mục Drive ↗</a>
            </div>

            <section className="month-workspace">
              <header className="month-workspace__heading">
                <div><p className="eyebrow">Tư vấn</p><h1>Thư mục {activeMonthFolder?.label} / {selectedYear}</h1></div>
                <span>{visibleRecords.length} thư mục dự án</span>
              </header>
              <div className="record-grid">
                {visibleRecords.length ? visibleRecords.map((record) => (
                  <article className="project-folder" key={record.id} onClick={() => setSelectedRecordId(record.id)}>
                    <span className="project-folder__icon">▰</span>
                    <div><b>{record.projectId}</b><small>{record.name}{record.houseId && <span className="house-id"> · {record.houseId}</span>}</small><em>Khởi tạo {record.createdAt}</em></div>
                    <div className="project-actions">
                      <button className="more-button" onClick={(event) => { event.stopPropagation(); setOpenMenuId(openMenuId === record.id ? null : record.id); }} aria-label={`Tùy chọn ${record.projectId}`}>…</button>
                      {openMenuId === record.id && (
                        <div className="project-menu" onClick={(event) => event.stopPropagation()}>
                          <button onClick={() => startProtectedAction("rename", record)}>Rename</button>
                          <button className="project-menu__delete" onClick={() => startProtectedAction("delete", record)}>Delete</button>
                        </div>
                      )}
                    </div>
                  </article>
                )) : <div className="empty-records"><span>▱</span><h2>Chưa có thư mục dự án</h2><p>Nhấn Add customer để tạo hồ sơ trong tháng đang chọn.</p><button onClick={openAddDialog}>Thêm hồ sơ đầu tiên</button></div>}
              </div>
            </section>
          </section>
        ) : (
          <section className="coming-soon">
            <span>{activeDriveFolder?.icon}</span><p className="eyebrow">GM-manager</p><h1>{activeFolder}</h1>
            <p>Khu vực này đã được liên kết với thư mục cùng tên trong GM-manager.</p><a href={activeDriveFolder?.url} target="_blank" rel="noreferrer" className="add-button">Mở trên Drive ↗</a>
          </section>
        )}
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
            <p className="drive-config-dialog__hint">GM-CRM đã được gán sẵn Web app GM-Manager. Bạn không cần đăng nhập hay nhập lại khi mở web.</p>
            <a className="script-link" href="/gm-crm-drive-script.js" target="_blank" rel="noreferrer">Mở mã Google Apps Script ↗</a>
            <label>Web app URL<input value={driveScriptUrl} onChange={(event) => setDriveScriptUrl(event.target.value)} placeholder="https://script.google.com/macros/s/.../exec" autoFocus /></label>
            <label>Mã đồng bộ<input type="password" value={driveSyncToken} onChange={(event) => setDriveSyncToken(event.target.value)} placeholder="Mã bạn đã đặt trong Script" /></label>
            <button className="add-button" type="submit">Lưu kết nối</button>
          </form>
        </div>
      )}

      {protectedAction && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setProtectedAction(null)}>
          {!renameUnlocked ? (
            <form className="security-dialog" onSubmit={confirmAccessCode} onMouseDown={(event) => event.stopPropagation()}>
              <button type="button" className="dialog-close" onClick={() => setProtectedAction(null)} aria-label="Đóng">×</button>
              <p className="eyebrow">{protectedAction.type === "delete" ? "Delete" : "Rename"} · {protectedAction.record.projectId}</p>
              <h2>Nhập khóa bảo vệ</h2>
              <label>Khóa truy cập<input type="password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} autoFocus placeholder="••••••" /></label>
              <button className="add-button" type="submit">Xác nhận</button>
            </form>
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

      {selectedRecord && (
        <div className="detail-backdrop" role="presentation" onMouseDown={() => setSelectedRecordId(null)}>
          <section className="record-detail" onMouseDown={(event) => event.stopPropagation()}>
            <header className="record-detail__heading">
              <div><p className="eyebrow">Hồ sơ dự án</p><h2>{selectedRecord.projectId}</h2><span>{selectedRecord.name}</span></div>
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
                          <td>{field.options ? (
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
                    <tr key={field.code}><td>{field.label} <span className="field-code">({field.code})</span></td><td><GrowingTextarea aria-label={field.label} value={selectedRecord.details?.[field.code] ?? ""} onChange={(event) => updateRecordDetail(field.code, event.target.value)} placeholder="Nhập kết quả thu thập" /></td></tr>
                  ))}</tbody>
                </table>
              </section>

              <section className="dynamic-information system-information audio-information">
                <div className="audio-information__heading">
                  <div>
                    <h3>6. Thông tin ghi âm</h3>
                    <p>Nhập MP3, WAV, M4A, AAC, OGG hoặc FLAC. Bản ghi dài sẽ tự tách thành các đoạn nhỏ, xử lý lần lượt rồi tổng hợp văn bản và ý chính.</p>
                  </div>
                  <label className={`audio-import-button ${audioProcessingId === selectedRecord.id ? "audio-import-button--busy" : ""}`}>
                    <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" onChange={importAudioNote} disabled={audioProcessingId === selectedRecord.id} />
                    {audioProcessingId === selectedRecord.id ? audioProcessingStatus || "Đang xử lý…" : "Import ghi âm"}
                  </label>
                </div>
                {selectedRecord.audioNote && (
                  <div className="audio-note">
                    <p className="audio-note__meta">{selectedRecord.audioNote.fileName} · {selectedRecord.audioNote.language} · {selectedRecord.audioNote.updatedAt}</p>
                    <h4>Ý chính</h4>
                    {selectedRecord.audioNote.keyPoints.length > 0 ? (
                      <ul>{selectedRecord.audioNote.keyPoints.map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}</ul>
                    ) : <p className="audio-note__empty">Chưa rút được ý chính từ bản ghi âm này.</p>}
                    {selectedRecord.audioNote.segments.length > 0 && (
                      <details>
                        <summary>Văn bản đã chuyển ({selectedRecord.audioNote.segments.length} đoạn)</summary>
                        <div className="audio-transcript">
                          {selectedRecord.audioNote.segments.map((segment, index) => <p key={`${segment.time}-${index}`}><b>{segment.time}</b>{segment.text}</p>)}
                        </div>
                      </details>
                    )}
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
