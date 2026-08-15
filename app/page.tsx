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
  keyPoints: string[];
};

type AudioNote = {
  fileName: string;
  language: string;
  updatedAt: string;
  segments: AudioSegment[];
  keyPoints: string[];
  chunks?: AudioNoteChunk[];
  totalChunks?: number;
  completedChunks?: number;
  status?: "processing" | "complete";
};

type AudioInsightResult = {
  language?: string;
  segments: AudioSegment[];
  keyPoints: string[];
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

type WorkRecord = {
  id: string;
  name: string;
  houseId?: string;
  projectId: string;
  createdAt: string;
  details: Record<string, string>;
  audioNote?: AudioNote;
  designProgress?: DesignProgressRow[];
  functionalFloors?: FunctionalFloor[];
  functionalRows?: LegacyFunctionalRow[];
};

type DesignProgressRow = {
  id: string;
  isCustom: boolean;
  content: string;
  plannedDate: string;
  actualDate: string;
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
  { label: "Tư vấn", icon: "⌂", url: "https://drive.google.com/drive/folders/16ItUFlDizo1xfyJEAnXeHWbsot2r_Wep" },
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

const designProgressContents = [
  "Tư vấn concept",
  "Mặt bằng công năng",
  "3D lần 1",
  "3D lần 2",
  "3D lần 3",
  "Hồ sơ bổ kỹ thuật",
  "Nghiệm thu và bàn giao",
] as const;

type DesignDateKey = "plannedDate" | "actualDate";

const isFixedDesignContent = (content: string) => designProgressContents.some((item) => item === content);
const createFixedDesignRow = (content: string, index: number): DesignProgressRow => ({
  id: `design-fixed-${index}`,
  isCustom: false,
  content,
  plannedDate: "",
  actualDate: "",
  note: "",
});
const createCustomDesignRow = (): DesignProgressRow => ({
  id: `design-custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  isCustom: true,
  content: "",
  plannedDate: "",
  actualDate: "",
  note: "",
});
const createDesignProgress = (): DesignProgressRow[] => designProgressContents.map(createFixedDesignRow);
const normalizeDesignProgress = (record?: WorkRecord | null): DesignProgressRow[] => {
  const existing = record?.designProgress ?? [];
  if (!existing.length) return createDesignProgress();

  const normalized = existing.map((row, index) => {
    const isCustom = row.isCustom ?? !isFixedDesignContent(row.content ?? "");
    return {
      id: row.id || `design-${isCustom ? "custom" : "fixed"}-legacy-${index}`,
      isCustom,
      content: row.content ?? "",
      plannedDate: row.plannedDate ?? "",
      actualDate: row.actualDate ?? "",
      note: row.note ?? "",
    };
  });
  const existingFixed = new Set(normalized.filter((row) => !row.isCustom).map((row) => row.content));
  const missingFixed = designProgressContents
    .map(createFixedDesignRow)
    .filter((row) => !existingFixed.has(row.content));
  return [...normalized, ...missingFixed];
};

const formatDesignDateInput = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
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

function normalizeAudioNoteChunks(note: AudioNote): AudioNoteChunk[] {
  if (note.chunks?.length) return [...note.chunks].sort((a, b) => a.index - b.index);
  if (!note.segments.length && !note.keyPoints.length) return [];
  return [{ index: 0, segments: note.segments, keyPoints: note.keyPoints }];
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
    keyPoints: combineKeyPoints(orderedChunks.map((chunk) => ({ segments: chunk.segments, keyPoints: chunk.keyPoints }))),
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
            designProgress: record.designProgress ?? localRecord?.designProgress ?? createDesignProgress(),
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
  const [selectedCustomerProjectId, setSelectedCustomerProjectId] = useState<string | null>(null);
  const [personnelView, setPersonnelView] = useState(false);
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
  const [syncingDesignId, setSyncingDesignId] = useState<string | null>(null);
  const [isLoadingDrive, setIsLoadingDrive] = useState(false);
  const [audioProcessingId, setAudioProcessingId] = useState<string | null>(null);
  const [audioProcessingStatus, setAudioProcessingStatus] = useState("");
  const driveSyncTimer = useRef<number | null>(null);
  const designSyncTimer = useRef<number | null>(null);

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
  const customerLocations = useMemo<CustomerLocation[]>(() => years.flatMap((yearFolder) => yearFolder.months.flatMap((monthFolder, monthIndex) => (
    monthFolder.records.map((record) => ({ record, year: yearFolder.year, month: monthIndex + 1 }))
  ))).sort((a, b) => b.year - a.year || b.month - a.month || a.record.name.localeCompare(b.record.name, "vi")), [years]);
  const customerSearchResults = useMemo(() => {
    const term = normalizeSearchText(search.trim());
    const periodCustomers = customerLocations.filter((location) => location.year === selectedYear && location.month === selectedMonth);
    return (term ? periodCustomers.filter(({ record }) => normalizeSearchText(`${record.name} ${record.houseId ?? ""} ${record.projectId}`).includes(term)) : periodCustomers).slice(0, 24);
  }, [customerLocations, search, selectedMonth, selectedYear]);
  const selectedCustomerLocation = customerLocations.find(({ record }) => record.projectId === selectedCustomerProjectId) ?? null;
  const visibleRecords = useMemo(() => {
    const records = activeMonthFolder?.records ?? [];
    return selectedCustomerProjectId ? records.filter((record) => record.projectId === selectedCustomerProjectId) : [];
  }, [activeMonthFolder, selectedCustomerProjectId]);

  const selectCustomer = ({ record, year, month }: CustomerLocation) => {
    setSelectedCustomerProjectId(record.projectId);
    setSelectedYear(year);
    setSelectedMonth(month);
    setActiveFolder("Tư vấn");
    setPersonnelView(false);
    setSelectedRecordId(null);
    setOpenMenuId(null);
    setSearch("");
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
  };

  const persist = (nextYears: YearFolder[]) => {
    setYears(nextYears);
    saveWorkspace(nextYears);
  };

  const persistRecord = (record: WorkRecord, year: number, month: number) => {
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
      designProgress: createDesignProgress(),
      functionalFloors: [createFunctionalFloor()],
    };
    const nextYears = years.map((yearFolder) => yearFolder.year !== modalYear ? yearFolder : {
      ...yearFolder,
      months: yearFolder.months.map((monthFolder, index) => index !== modalMonth - 1 ? monthFolder : { ...monthFolder, records: [record, ...monthFolder.records] }),
    });
    persist(nextYears);
    void syncRecordToDrive(record, modalYear, modalMonth);
    void syncDesignProgressToDrive(record, modalYear, modalMonth);
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

  const selectedRecord = activeMonthFolder?.records.find((record) => record.id === selectedRecordId) ?? null;
  const activeCustomerRecord = selectedCustomerLocation?.record ?? null;
  const designProgressRows = normalizeDesignProgress(activeCustomerRecord);
  const designScheduleAnalysis = analyzeDesignProgress(designProgressRows);

  const commitDesignProgressRows = (nextRows: DesignProgressRow[]) => {
    if (!activeCustomerRecord || !selectedCustomerLocation) return;
    const updatedRecord = { ...activeCustomerRecord, designProgress: nextRows };
    persistRecord(updatedRecord, selectedCustomerLocation.year, selectedCustomerLocation.month);
    queueDesignProgressSync(updatedRecord, selectedCustomerLocation.year, selectedCustomerLocation.month);
  };

  const updateDesignProgress = (rowIndex: number, key: "content" | DesignDateKey | "note", value: string) => {
    let nextValue = value;
    if (key === "plannedDate" || key === "actualDate") {
      nextValue = formatDesignDateInput(value);
      if (nextValue.length === 10 && !parseDesignDate(nextValue)) {
        setNotice("Ngày không hợp lệ. Hãy nhập theo dạng ngày/tháng/năm, ví dụ 12/04/2026.");
        return;
      }
    }
    const nextRows = designProgressRows.map((row, index) => index === rowIndex ? { ...row, [key]: nextValue } : row);
    if ((key === "plannedDate" || key === "actualDate") && nextValue.length === 10 && !hasSequentialDesignDates(nextRows, key)) {
      setNotice(`${key === "plannedDate" ? "Ngày dự kiến" : "Ngày thực tế"} phải tăng dần theo thứ tự từ trên xuống.`);
      return;
    }
    commitDesignProgressRows(nextRows);
  };

  const addDesignProgressRow = () => commitDesignProgressRows([...designProgressRows, createCustomDesignRow()]);

  const deleteDesignProgressRow = (rowIndex: number) => {
    const row = designProgressRows[rowIndex];
    if (!row?.isCustom) return;
    commitDesignProgressRows(designProgressRows.filter((_, index) => index !== rowIndex));
  };

  const moveDesignProgressRow = (rowIndex: number, direction: -1 | 1) => {
    const destination = rowIndex + direction;
    if (destination < 0 || destination >= designProgressRows.length) return;
    const nextRows = [...designProgressRows];
    [nextRows[rowIndex], nextRows[destination]] = [nextRows[destination], nextRows[rowIndex]];
    if (!hasSequentialDesignDates(nextRows, "plannedDate") || !hasSequentialDesignDates(nextRows, "actualDate")) {
      setNotice("Không thể đổi vị trí vì sẽ làm thứ tự ngày bị lùi. Hãy điều chỉnh ngày trước.");
      return;
    }
    commitDesignProgressRows(nextRows);
  };

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
    const config = defaultDriveSyncConfig;
    let workingRecord = startingRecord;
    let workingChunks = normalizeAudioNoteChunks(startingRecord.audioNote);
    const totalChunks = startingRecord.audioNote.totalChunks ?? workingChunks.length;
    let startIndex = startingRecord.audioNote.completedChunks ?? 0;
    while (workingChunks.some((chunk) => chunk.index === startIndex)) startIndex += 1;

    for (let index = startIndex; index < totalChunks; index += 1) {
      setAudioProcessingStatus(`Đang xử lý đoạn ${index + 1}/${totalChunks}…`);
      let result: AudioProcessResponse | null = null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await fetch("/api/audio-process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scriptUrl: config.scriptUrl,
            token: config.token,
            year,
            month,
            projectId: startingRecord.projectId,
            chunkIndex: index,
            totalChunks,
          }),
        });
        const responseText = await response.text();
        try {
          result = JSON.parse(responseText) as AudioProcessResponse;
        } catch {
          throw new Error("Không thể đọc phản hồi khi xử lý file ghi âm. Hãy thử lại sau.");
        }
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
        keyPoints: result.keyPoints ?? [],
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

    const config = defaultDriveSyncConfig;
    const record = selectedRecord;
    setAudioProcessingId(record.id);
    setAudioProcessingStatus("Đang chuẩn bị bản ghi…");
    try {
      const chunks = await splitAudioForProcessing(file);
      for (let index = 0; index < chunks.length; index += 1) {
        setAudioProcessingStatus(`Đang lưu file ghi âm ${index + 1}/${chunks.length} vào Drive…`);
        const formData = new FormData();
        formData.append("audio", chunks[index].file);
        formData.append("scriptUrl", config.scriptUrl);
        formData.append("token", config.token);
        formData.append("year", String(selectedYear));
        formData.append("month", String(selectedMonth));
        formData.append("projectId", record.projectId);
        formData.append("chunkIndex", String(index));
        formData.append("totalChunks", String(chunks.length));
        formData.append("originalFileName", file.name);
        const response = await fetch("/api/audio-store", { method: "POST", body: formData });
        const responseText = await response.text();
        let result: { ok?: boolean; error?: string };
        try {
          result = JSON.parse(responseText) as typeof result;
        } catch {
          throw new Error("Không thể lưu file ghi âm vào Drive. Hãy cập nhật lại Apps Script.");
        }
        if (!response.ok || !result.ok) throw new Error(result.error || "Không thể lưu file ghi âm vào Drive.");
      }

      const audioNote: AudioNote = {
        fileName: file.name,
        language: "Tiếng Việt",
        updatedAt: new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date()),
        segments: [],
        keyPoints: [],
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
    if (activeCustomerRecord) void syncDesignProgressToDrive(activeCustomerRecord, selectedYear, selectedMonth, config);
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

  const syncDesignProgressToDrive = async (record: WorkRecord, year = selectedYear, month = selectedMonth, configOverride?: DriveSyncConfig) => {
    const config = configOverride ?? { scriptUrl: driveScriptUrl.trim(), token: driveSyncToken.trim() };
    if (!config.scriptUrl || !config.token) {
      setDriveConfigOpen(true);
      return;
    }
    setSyncingDesignId(record.id);
    try {
      const response = await fetch("/api/drive-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync-design-progress",
          scriptUrl: config.scriptUrl,
          token: config.token,
          year,
          month,
          record: { ...record, designProgress: normalizeDesignProgress(record) },
        }),
      });
      const result = await response.json() as { ok?: boolean; error?: string; fileUrl?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || "Không thể tạo Excel tiến độ thiết kế kiến trúc.");
      setNotice(`Đã cập nhật Tiến độ thiết kế kiến trúc ${record.projectId}.xlsx`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Không thể đồng bộ tiến độ thiết kế kiến trúc.");
    } finally {
      setSyncingDesignId(null);
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

  const queueDesignProgressSync = (record: WorkRecord, year = selectedYear, month = selectedMonth) => {
    if (!isDriveConnected) return;
    if (designSyncTimer.current) window.clearTimeout(designSyncTimer.current);
    designSyncTimer.current = window.setTimeout(() => {
      designSyncTimer.current = null;
      void syncDesignProgressToDrive(record, year, month);
    }, 900);
  };

  useEffect(() => () => {
    if (driveSyncTimer.current) window.clearTimeout(driveSyncTimer.current);
    if (designSyncTimer.current) window.clearTimeout(designSyncTimer.current);
  }, []);

  const selectedAudioNote = selectedRecord?.audioNote;
  const audioDisplayChunks = selectedAudioNote ? normalizeAudioNoteChunks(selectedAudioNote) : [];
  const audioTotalChunks = selectedAudioNote?.totalChunks ?? audioDisplayChunks.length;
  const audioCompletedChunks = selectedAudioNote?.completedChunks ?? audioDisplayChunks.length;
  const hasPendingAudio = Boolean(selectedAudioNote && audioTotalChunks > audioCompletedChunks);

  return (
    <main className="crm-shell">
      {!selectedCustomerProjectId && (
        <section className="customer-gateway" aria-label={personnelView ? "Nhân lực" : "Chọn khách hàng"}>
          <header className="customer-gateway__header">
            <div className="brand customer-gateway__brand">GM<span>-CRM</span></div>
            <div className="customer-gateway__actions">
              <button className={`drive-status ${isDriveConnected ? "drive-status--connected" : ""}`} onClick={() => setDriveConfigOpen(true)}><i /> {isDriveConnected ? "Drive đã kết nối" : "Kết nối Drive"}</button>
              <button className="reload-drive" onClick={() => void loadWorkspaceFromDrive()} disabled={isLoadingDrive}>{isLoadingDrive ? "Đang nạp…" : "Nạp lại Drive"}</button>
              {!personnelView && <button className="add-button" onClick={openAddDialog}><span>＋</span> Add customer</button>}
            </div>
          </header>

          {personnelView ? (
            <div className="personnel-placeholder">
              <button className="gateway-back" onClick={() => setPersonnelView(false)}>← Quay lại tìm khách hàng</button>
              <span className="personnel-placeholder__icon">♙</span>
              <p className="eyebrow">GM-Manager</p>
              <h1>Nhân lực</h1>
              <p>Đây là khu vực riêng cho dữ liệu nhân lực. Giao diện chi tiết sẽ được xây dựng ở bước tiếp theo.</p>
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
                <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm tên, mã nhà hoặc ID dự án…" aria-label="Tìm khách hàng" />
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

              <button className="personnel-entry" onClick={() => setPersonnelView(true)}>
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
        <div className="brand">GM<span>-CRM</span></div>
        <p className="sidebar-label sidebar-label--top">Quy trình công việc</p>
        <nav className="main-nav" aria-label="Quy trình GM-manager">
          {syncedDriveFolders.filter((folder) => folder.label !== "Nhân lực").map((folder) => (
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
          <button className="customer-context" onClick={returnToCustomerSearch}>
            <span className="customer-context__back">←</span>
            <span><small>Khách hàng đang chọn</small><b>{selectedCustomerLocation?.record.name ?? "Chọn lại khách hàng"}</b><em>{selectedCustomerLocation?.record.projectId}{selectedCustomerLocation?.record.houseId ? ` · ${selectedCustomerLocation.record.houseId}` : ""}</em></span>
          </button>
          <div className="topbar__actions"><button className={`drive-status ${isDriveConnected ? "drive-status--connected" : ""}`} onClick={() => setDriveConfigOpen(true)}><i /> {isDriveConnected ? "Drive đã kết nối" : "Kết nối Drive"}</button><button className="reload-drive" onClick={() => void loadWorkspaceFromDrive()} disabled={isLoadingDrive}>{isLoadingDrive ? "Đang nạp…" : "Nạp lại Drive"}</button><button className="add-button" onClick={openAddDialog}><span>＋</span> Add customer</button></div>
        </header>

        {activeFolder === "Tư vấn" ? (
          <section className="consulting-view">
            <div className="calendar-bar">
              <label>Tháng
                <select value={selectedMonth} disabled aria-label="Tháng của khách hàng đã chọn">
                  {monthLabels.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
                </select>
              </label>
              <label>Năm
                <select value={selectedYear} disabled aria-label="Năm của khách hàng đã chọn">
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
        ) : activeFolder === "Thiết kế" ? (
          <section className="design-progress-view">
            <header className="design-progress-view__heading">
              <div><p className="eyebrow">Thiết kế · {activeCustomerRecord?.projectId}</p><h1>Tiến độ thiết kế kiến trúc</h1><span>{activeCustomerRecord?.name}{activeCustomerRecord?.houseId ? ` · ${activeCustomerRecord.houseId}` : ""} · Ngày tự định dạng dd/mm/yyyy</span></div>
              <div className="design-progress-view__status"><i className={syncingDesignId === activeCustomerRecord?.id ? "is-syncing" : ""} />{syncingDesignId === activeCustomerRecord?.id ? "Đang cập nhật Excel…" : "Tự động lưu vào Drive"}</div>
            </header>
            <div className="design-progress-table-wrap">
              <table className="design-progress-table">
                <thead><tr><th>Nội dung</th><th>Ngày dự kiến</th><th>Ngày thực tế</th><th>Ghi chú</th></tr></thead>
                <tbody>{designProgressRows.map((row, index) => (
                  <tr key={row.id}>
                    <td><div className="design-progress-content">
                      {row.isCustom
                        ? <GrowingTextarea value={row.content} onChange={(event) => updateDesignProgress(index, "content", event.target.value)} placeholder="Nhập nội dung mới" aria-label={`Nội dung dòng ${index + 1}`} />
                        : <b>{row.content}</b>}
                      <span className="design-progress-content__actions">
                        <button type="button" onClick={() => moveDesignProgressRow(index, -1)} disabled={index === 0} title="Lên một dòng" aria-label={`Đưa ${row.content || `dòng ${index + 1}`} lên`}>↑</button>
                        <button type="button" onClick={() => moveDesignProgressRow(index, 1)} disabled={index === designProgressRows.length - 1} title="Xuống một dòng" aria-label={`Đưa ${row.content || `dòng ${index + 1}`} xuống`}>↓</button>
                        {row.isCustom && <button type="button" className="is-delete" onClick={() => deleteDesignProgressRow(index)} title="Xóa dòng" aria-label={`Xóa ${row.content || `dòng ${index + 1}`}`}>×</button>}
                      </span>
                    </div></td>
                    <td><input value={row.plannedDate} maxLength={10} onChange={(event) => updateDesignProgress(index, "plannedDate", event.target.value)} placeholder="12/04/2026" inputMode="numeric" aria-label={`Ngày dự kiến ${row.content}`} /></td>
                    <td><input value={row.actualDate} maxLength={10} onChange={(event) => updateDesignProgress(index, "actualDate", event.target.value)} placeholder="12/04/2026" inputMode="numeric" aria-label={`Ngày thực tế ${row.content}`} /></td>
                    <td><GrowingTextarea value={row.note} onChange={(event) => updateDesignProgress(index, "note", event.target.value)} placeholder="Nhập ghi chú" aria-label={`Ghi chú ${row.content}`} /></td>
                  </tr>
                ))}</tbody>
              </table>
              <button type="button" className="design-progress-add-row" onClick={addDesignProgressRow}><span>＋</span> Thêm dòng tiến độ</button>
            </div>
            <section className="design-progress-insights">
              <div className="design-progress-insights__heading"><div><p className="eyebrow">So sánh lịch</p><h2>Đồ thị kế hoạch và thực tế</h2></div><div className="schedule-legend"><span><i className="is-late" /> Chậm</span><span><i className="is-early" /> Sớm</span><span><i className="is-on-time" /> Bằng kế hoạch</span></div></div>
              <div className="schedule-charts">
                <DesignTimelineChart rows={designProgressRows} dateKey="plannedDate" title="Đồ thị ngày dự kiến" />
                <DesignTimelineChart rows={designProgressRows} dateKey="actualDate" title="Đồ thị ngày thực tế" />
              </div>
              <article className="schedule-analysis">
                <header><p className="eyebrow">Phân tích tự động</p><h3>5 nhận xét tiến độ</h3><span>Dựa trên chênh lệch từng mốc, không thay thế phân tích đường găng.</span></header>
                <ol>{designScheduleAnalysis.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}</ol>
              </article>
            </section>
            <footer className="design-progress-view__footer"><span>File: Tiến độ thiết kế kiến trúc {activeCustomerRecord?.projectId}.xlsx</span><span>GM-Manager / Khách hàng / {selectedYear} / T{selectedMonth} / {activeCustomerRecord?.projectId} / Thiết kế</span></footer>
          </section>
        ) : (
          <section className="coming-soon">
            <span>{activeDriveFolder?.icon}</span><p className="eyebrow">GM-manager</p><h1>{activeFolder}</h1>
            <p>Khu vực {activeFolder} của <b>{selectedCustomerLocation?.record.name}</b> · {selectedCustomerLocation?.record.projectId}. Dữ liệu sẽ nằm trong thư mục cùng tên bên trong hồ sơ khách hàng này.</p><a href={activeDriveFolder?.url} target="_blank" rel="noreferrer" className="add-button">Mở trên Drive ↗</a>
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
                    <p>File được lưu trong thư mục khách hàng. Mỗi đoạn xong sẽ ghi ngay vào Excel; nếu dừng giữa chừng, lần sau tiếp tục từ đoạn chưa làm.</p>
                  </div>
                  {audioProcessingId === selectedRecord.id ? (
                    <button type="button" className="audio-import-button audio-import-button--busy" disabled>{audioProcessingStatus || "Đang xử lý…"}</button>
                  ) : hasPendingAudio ? (
                    <button type="button" className="audio-import-button audio-resume-button" onClick={() => void resumeAudioProcessing(selectedRecord)}>
                      Tiếp tục từ đoạn {audioCompletedChunks + 1}/{audioTotalChunks}
                    </button>
                  ) : (
                    <label className="audio-import-button">
                      <input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac" onChange={importAudioNote} />
                      Import ghi âm
                    </label>
                  )}
                </div>
                {selectedAudioNote && (
                  <div className="audio-note">
                    <p className="audio-note__meta">{selectedAudioNote.fileName} · {selectedAudioNote.language} · Đã hoàn thành {audioCompletedChunks}/{audioTotalChunks} đoạn · {selectedAudioNote.updatedAt}</p>
                    {audioDisplayChunks.length ? audioDisplayChunks.map((chunk) => (
                      <section className="audio-chunk" key={chunk.index}>
                        <h4>Đoạn {chunk.index + 1}/{audioTotalChunks}</h4>
                        <div className="audio-chunk__transcript">
                          <strong>Nội dung đầy đủ</strong>
                          {chunk.segments.map((segment, index) => <p key={`${segment.time}-${index}`}><b>{segment.time}</b>{segment.text}</p>)}
                        </div>
                        <div className="audio-chunk__summary">
                          <strong>Tóm tắt</strong>
                          {chunk.keyPoints.length ? <ul>{chunk.keyPoints.map((point, index) => <li key={`${index}-${point}`}>{point}</li>)}</ul> : <p>Chưa có ý chính cho đoạn này.</p>}
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
