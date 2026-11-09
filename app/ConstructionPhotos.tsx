"use client";

import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import "./construction-photos.css";

export type ConstructionPhoto = {
  id: string;
  name: string;
  mimeType: string;
  capturedAt: string;
  viewUrl: string;
  downloadUrl: string;
  thumbnailUrl?: string;
  dayFolderId?: string;
};

export type ConstructionPhotoDay = {
  date: string;
  folderId: string;
  folderUrl: string;
  photos: ConstructionPhoto[];
};

export type ConstructionPhotoUpload = {
  uploadId: string;
  capturedAt: string;
  file: { data: string; mimeType: "image/jpeg" };
};

export type ConstructionPhotoUploadResult = Omit<ConstructionPhotoDay, "photos"> & {
  photo: ConstructionPhoto;
};

type ConstructionPhotosProps = {
  canCapture: boolean;
  cacheKey?: string;
  loadPhotos: () => Promise<ConstructionPhotoDay[]>;
  uploadPhoto: (input: ConstructionPhotoUpload) => Promise<ConstructionPhotoUploadResult>;
  deletePhoto?: (day: ConstructionPhotoDay, photo: ConstructionPhoto) => Promise<void>;
};

type PhotoDeletion = { id: string; at: number };
type PhotoGallery = { days: ConstructionPhotoDay[]; deletedPhotos: PhotoDeletion[] };
type PhotoToDelete = { day: ConstructionPhotoDay; photo: ConstructionPhoto };
const photoDeletionGraceMs = 10 * 60_000;

type Position = Pick<GeolocationCoordinates, "latitude" | "longitude">;
type WeatherStation = {
  station_id: string;
  observation_time: number;
  latitude: number;
  longitude: number;
  temp_c: number | null;
  wx_string: string | null;
  sky_cover: string | null;
  sky_cover_1: string | null;
  sky_cover_2: string | null;
};
type PhotoJob = {
  uploadId: string;
  capturedAt: Date;
  position: Promise<Position | null>;
  frame?: HTMLCanvasElement | File;
  blob?: Blob;
  previewUrl?: string;
  error?: string;
  stage: "preparing" | "uploading" | "failed";
};
type CameraPhase = "closed" | "starting" | "live" | "failed" | "finishing";
const maxOutstandingPhotos = 8;

const vietnamTimeZone = "Asia/Ho_Chi_Minh";
const photoDate = new Intl.DateTimeFormat("vi-VN", { timeZone: vietnamTimeZone, day: "2-digit", month: "2-digit", year: "numeric" });
const photoTime = new Intl.DateTimeFormat("vi-VN", { timeZone: vietnamTimeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
const weatherEndpoint = "https://mapservices.weather.noaa.gov/vector/rest/services/aviation/awc_aviation_weather/MapServer/42/query";
const weatherAttribution = "https://aviationweather.gov/data/api/";
const weatherCells = new Map<string, { until: number; stations: Promise<WeatherStation[]> }>();
const missingLocation = "Không lấy được vị trí";
const missingWeather = "Chưa có dữ liệu";

function onMobile() {
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function devicePosition(): Promise<Position | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    const timeout = window.setTimeout(() => resolve(null), 9000);
    const unavailable = () => {
      window.clearTimeout(timeout);
      resolve(null);
    };
    try {
      navigator.geolocation.getCurrentPosition(
        ({ coords: { latitude, longitude } }) => {
          window.clearTimeout(timeout);
          resolve(Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null);
        },
        unavailable,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 },
      );
    } catch {
      unavailable();
    }
  });
}

function observationDistance(position: Position, station: WeatherStation) {
  const rad = Math.PI / 180;
  const latDistance = (position.latitude - station.latitude) * rad;
  const lonDistance = (position.longitude - station.longitude) * rad;
  const haversine = Math.sin(latDistance / 2) ** 2 +
    Math.cos(position.latitude * rad) * Math.cos(station.latitude * rad) * Math.sin(lonDistance / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(haversine)));
}

function weatherCondition(station: WeatherStation) {
  const code = station.wx_string || "";
  if (/TS/.test(code)) return "Dông";
  if (/SN|SG|PL|IC/.test(code)) return "Tuyết hoặc băng";
  if (/RA|DZ/.test(code)) return code.startsWith("-") ? "Mưa nhẹ" : "Mưa";
  if (/FG|BR|HZ/.test(code)) return "Sương mù";
  const sky = [station.sky_cover, station.sky_cover_1, station.sky_cover_2];
  if (sky.some((value) => value === "OVC" || value === "BKN")) return "Nhiều mây";
  if (sky.some((value) => value === "FEW" || value === "SCT")) return "Có mây";
  if (sky.some((value) => value === "CLR" || value === "SKC" || value === "NSC" || value === "CAVOK")) return "Trời quang";
  return "";
}

async function nearbyWeather(position: Position, capturedAt: Date) {
  // Only a coarse envelope is sent to the public station feed. The photo uses the GPS reading.
  const lat = Math.round(position.latitude * 4) / 4;
  const lon = Math.round(position.longitude * 4) / 4;
  const cell = `${lat},${lon}`;
  let cached = weatherCells.get(cell);
  if (!cached || cached.until <= Date.now()) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    const query = new URLSearchParams({
      f: "json",
      geometry: [Math.max(-180, lon - 0.9), Math.max(-90, lat - 0.9), Math.min(180, lon + 0.9), Math.min(90, lat + 0.9)].join(","),
      geometryType: "esriGeometryEnvelope",
      inSR: "4326",
      spatialRel: "esriSpatialRelIntersects",
      returnGeometry: "false",
      outFields: "station_id,observation_time,latitude,longitude,temp_c,wx_string,sky_cover,sky_cover_1,sky_cover_2",
    });
    const stations = fetch(`${weatherEndpoint}?${query}`, { signal: controller.signal, referrerPolicy: "no-referrer" })
      .then(async (response) => {
        if (!response.ok) return [];
        const result = await response.json() as { features?: { attributes: WeatherStation }[] };
        return Array.isArray(result.features) ? result.features.map(({ attributes }) => attributes) : [];
      })
      .catch(() => [])
      .finally(() => window.clearTimeout(timeout));
    if (weatherCells.size >= 12) {
      const first = weatherCells.keys().next().value;
      if (first !== undefined) weatherCells.delete(first);
    }
    cached = { until: Date.now() + 5 * 60_000, stations };
    weatherCells.set(cell, cached);
  }
  const station = (await cached.stations)
    .filter((value) => value && Number.isFinite(value.latitude) && Number.isFinite(value.longitude)
      && Number.isFinite(value.observation_time) && Math.abs(capturedAt.getTime() - value.observation_time) <= 2 * 60 * 60_000)
    .map((value) => ({ value, distance: observationDistance(position, value) }))
    .filter(({ distance }) => distance <= 75)
    .sort((a, b) => a.distance - b.distance || b.value.observation_time - a.value.observation_time)[0]?.value;
  if (!station) return null;
  const conditions = [Number.isFinite(station.temp_c) ? `${Math.round(station.temp_c!)}°C` : "", weatherCondition(station)].filter(Boolean);
  return conditions.length ? { label: conditions.join(" · "), station: station.station_id } : null;
}

function readImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Không thể đọc ảnh."));
    image.src = url;
  });
}

function copyFrame(source: CanvasImageSource, width: number, height: number) {
  if (!width || !height) throw new Error("Camera chưa sẵn sàng. Hãy thử chụp lại.");
  const scale = Math.min(1, 1920 / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Thiết bị không thể xử lý ảnh.");
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function decodeCapture(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = await readImage(url);
    return copyFrame(image, image.naturalWidth, image.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function stampPhoto(canvas: HTMLCanvasElement, capturedAt: Date, position: Position | null) {
  const [logo, weather] = await Promise.all([
    readImage(`${import.meta.env.BASE_URL}gm-logo-192.png`),
    position ? nearbyWeather(position, capturedAt) : null,
  ]);
  const context = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const shortest = Math.min(width, height);
  const padding = Math.round(shortest * 0.035);
  const fontSize = Math.max(12, Math.round(shortest * 0.034));
  const lineHeight = Math.round(fontSize * 1.42);
  const logoSize = Math.max(32, Math.round(shortest * 0.14));
  const logoCanvas = document.createElement("canvas");
  logoCanvas.width = logoSize;
  logoCanvas.height = logoSize;
  const logoContext = logoCanvas.getContext("2d")!;
  logoContext.drawImage(logo, 0, 0, logoSize, logoSize);
  logoContext.globalCompositeOperation = "source-in";
  logoContext.fillStyle = "#fff";
  logoContext.fillRect(0, 0, logoSize, logoSize);

  const bottomShade = context.createLinearGradient(0, height - 5 * lineHeight - padding, 0, height);
  bottomShade.addColorStop(0, "transparent");
  bottomShade.addColorStop(1, "rgba(0,0,0,.82)");
  context.fillStyle = bottomShade;
  context.fillRect(0, height - 5 * lineHeight - padding, width, 5 * lineHeight + padding);
  context.save();
  context.shadowColor = "rgba(0,0,0,.9)";
  context.shadowBlur = Math.max(3, Math.round(logoSize / 13));
  context.drawImage(logoCanvas, padding, padding);
  context.restore();

  const lines = [
    `Ngày: ${photoDate.format(capturedAt)}`,
    `Giờ: ${photoTime.format(capturedAt)}`,
    `Thời tiết: ${weather ? `${weather.label} (trạm ${weather.station})` : missingWeather}`,
    `Địa điểm: ${position ? `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}` : missingLocation}`,
  ];
  context.fillStyle = "#fff";
  context.font = `700 ${fontSize}px Arial, sans-serif`;
  context.textBaseline = "bottom";
  context.shadowColor = "rgba(0,0,0,.8)";
  context.shadowBlur = 3;
  lines.forEach((line, index) => context.fillText(line, padding, height - padding - (3 - index) * lineHeight, width - 2 * padding));

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Không thể lưu ảnh đã chụp.")), "image/jpeg", 0.88);
  });
  return blob;
}

function blobData(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result || "").split(",")[1];
      if (data) resolve(data);
      else reject(new Error("Không thể chuẩn bị ảnh để tải lên."));
    };
    reader.onerror = () => reject(new Error("Không thể đọc ảnh đã chụp."));
    reader.readAsDataURL(blob);
  });
}

function cameraMessage(error: unknown) {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return { message: "Hãy cấp quyền camera cho GM Manager trong cài đặt trình duyệt rồi thử lại.", canUseNative: false };
  }
  return { message: "Không thể mở camera. Hãy đóng ứng dụng đang dùng camera rồi thử lại.", canUseNative: true };
}

function displayDay(date: string) {
  return date.replaceAll("-", "/");
}

function dayOrder(a: ConstructionPhotoDay, b: ConstructionPhotoDay) {
  const key = (date: string) => date.split("-").reverse().join("");
  return key(b.date).localeCompare(key(a.date));
}

function readGallery(storageKey: string): PhotoGallery | null {
  if (!storageKey) return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) || "null") as PhotoGallery | null;
    if (value && Array.isArray(value.days) && Array.isArray(value.deletedPhotos)
      && value.days.every((day) => typeof day?.date === "string" && Array.isArray(day.photos))) return value;
  } catch { /* Use the server list when cached metadata is unavailable. */ }
  return null;
}

function recentPhotoDeletions(...groups: PhotoDeletion[][]) {
  const after = Date.now() - photoDeletionGraceMs;
  const latest = new Map<string, PhotoDeletion>();
  for (const deletion of groups.flat()) {
    if (!deletion || deletion.at <= after) continue;
    const prior = latest.get(deletion.id);
    if (!prior || prior.at < deletion.at) latest.set(deletion.id, deletion);
  }
  return [...latest.values()].sort((left, right) => right.at - left.at).slice(0, 256);
}

function withoutDeletedPhotos(days: ConstructionPhotoDay[], deletions: PhotoDeletion[]) {
  const deleted = new Set(deletions.map((deletion) => deletion.id));
  return days.map((day) => ({ ...day, photos: day.photos.filter((photo) => !deleted.has(photo.id)) }))
    .filter((day) => day.photos.length > 0)
    .sort(dayOrder);
}

function photoErrorCode(error: unknown) {
  return error instanceof Error && "code" in error ? String(error.code) : "";
}

function CameraIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7h4l2-3h6l2 3h4v13H3z" /><circle cx="12" cy="13" r="3.4" />
  </svg>;
}

function FolderIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 6h7l2 2h9v11H3z" />
  </svg>;
}

export default function ConstructionPhotos({ canCapture, cacheKey, loadPhotos, uploadPhoto, deletePhoto }: ConstructionPhotosProps) {
  const storageKey = cacheKey ? `gm-manager-construction-photos-v1:${cacheKey}` : "";
  const albumId = useId();
  const cameraTitleId = useId();
  const deleteTitleId = useId();
  const deleteDescriptionId = useId();
  const [mobile, setMobile] = useState(false);
  const [gallery, setGallery] = useState(() => readGallery(storageKey));
  const days = gallery?.days ?? [];
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");
  const [toDelete, setToDelete] = useState<PhotoToDelete | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [albumOpen, setAlbumOpen] = useState(true);
  const [openDays, setOpenDays] = useState(() => new Set(gallery?.days.slice(0, 1).map((day) => day.date)));
  const [phase, setPhase] = useState<CameraPhase>("closed");
  const [videoReady, setVideoReady] = useState(false);
  const [shots, setShots] = useState<PhotoJob[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [cameraError, setCameraError] = useState("");
  const [nativeAvailable, setNativeAvailable] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const deletePending = useRef(false);
  const video = useRef<HTMLVideoElement>(null);
  const nativeCamera = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const cameraRevision = useRef(0);
  const lifetime = useRef(0);
  const listRevision = useRef(0);
  const listPending = useRef(false);
  const galleryRef = useRef(gallery);
  const galleryBlocked = useRef(false);
  const finishing = useRef(false);
  const pendingShots = useRef<PhotoJob[]>([]);
  const uploadTail = useRef<Promise<void>>(Promise.resolve());
  const locationRequest = useRef<{ startedAt: number; result: Promise<Position | null> } | null>(null);
  const nativeOpenedAt = useRef(0);
  const loader = useRef(loadPhotos);
  loader.current = loadPhotos;

  const publishGallery = useCallback((nextDays: ConstructionPhotoDay[], deletedPhotoId?: string) => {
    const deletedPhotos = recentPhotoDeletions(
      galleryRef.current?.deletedPhotos ?? [], readGallery(storageKey)?.deletedPhotos ?? [],
      deletedPhotoId ? [{ id: deletedPhotoId, at: Date.now() }] : [],
    );
    const next = { days: withoutDeletedPhotos(nextDays, deletedPhotos), deletedPhotos };
    if (!galleryRef.current?.days.length && next.days[0]) setOpenDays(new Set([next.days[0].date]));
    galleryRef.current = next;
    setGallery(next);
    if (storageKey) {
      try { window.localStorage.setItem(storageKey, JSON.stringify(next)); }
      catch { /* The current gallery stays available when storage is full or disabled. */ }
    }
  }, [storageKey]);

  const refresh = useCallback(async () => {
    const revision = ++listRevision.current;
    listPending.current = true;
    setLoading(true);
    setListError("");
    try {
      const result = await loader.current();
      if (revision === listRevision.current) {
        galleryBlocked.current = false;
        publishGallery(result);
      }
    } catch (error) {
      if (revision !== listRevision.current) return;
      if (["AUTH_REQUIRED", "FORBIDDEN", "NOT_FOUND"].includes(photoErrorCode(error))) {
        galleryBlocked.current = true;
        galleryRef.current = null;
        setGallery(null);
        if (storageKey) {
          try { window.localStorage.removeItem(storageKey); }
          catch { /* Local storage can be disabled by the browser. */ }
        }
      }
      setListError(error instanceof Error ? error.message : "Không tải được ảnh thi công.");
    } finally {
      if (revision === listRevision.current) {
        listPending.current = false;
        setLoading(false);
      }
    }
  }, [publishGallery, storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    function reflectDeletedPhotos(event: StorageEvent) {
      if (event.key !== storageKey) return;
      const saved = readGallery(storageKey);
      const current = galleryRef.current;
      if (!saved || !current) return;
      const deletedPhotos = recentPhotoDeletions(current.deletedPhotos, saved.deletedPhotos);
      if (deletedPhotos.length === current.deletedPhotos.length && deletedPhotos.every((item, index) => item.id === current.deletedPhotos[index].id && item.at === current.deletedPhotos[index].at)) return;
      const next = { days: withoutDeletedPhotos(current.days, deletedPhotos), deletedPhotos };
      galleryRef.current = next;
      setGallery(next);
    }
    window.addEventListener("storage", reflectDeletedPhotos);
    return () => window.removeEventListener("storage", reflectDeletedPhotos);
  }, [storageKey]);

  function releaseStream() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }

  useEffect(() => {
    setMobile(onMobile());
    void refresh();
    return () => {
      listRevision.current++;
      cameraRevision.current++;
      lifetime.current++;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      pendingShots.current.forEach((shot) => {
        if (shot.previewUrl) URL.revokeObjectURL(shot.previewUrl);
      });
    };
  }, [refresh]);

  function updateShots(next: PhotoJob[]) {
    pendingShots.current = next;
    setShots(next);
  }

  function replaceShot(shot: PhotoJob) {
    updateShots(pendingShots.current.map((item) => item.uploadId === shot.uploadId ? shot : item));
  }

  function closeIfFinished() {
    if (!finishing.current || pendingShots.current.length) return;
    setPhase("closed");
    if (dialog.current?.open) dialog.current.close();
  }

  function removeShot(shot: PhotoJob) {
    if (shot.previewUrl) URL.revokeObjectURL(shot.previewUrl);
    updateShots(pendingShots.current.filter((item) => item.uploadId !== shot.uploadId));
    closeIfFinished();
  }

  function closeCamera() {
    cameraRevision.current++;
    releaseStream();
    locationRequest.current = null;
    setCameraError("");
    finishing.current = true;
    setPhase("finishing");
    closeIfFinished();
  }

  function requestPosition() {
    const startedAt = Date.now();
    const current = locationRequest.current;
    if (current && startedAt - current.startedAt < 30_000) return current.result;
    const result = devicePosition();
    locationRequest.current = { startedAt, result };
    return result;
  }

  async function startCamera() {
    if (!canCapture || !mobile) return;
    const revision = ++cameraRevision.current;
    finishing.current = false;
    releaseStream();
    setCameraError("");
    setNativeAvailable(false);
    setVideoReady(false);
    setPhase("starting");
    if (!dialog.current?.open) {
      setSavedCount(0);
      dialog.current?.showModal();
    }
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Camera API không khả dụng.");
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      });
      if (revision !== cameraRevision.current || !video.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      video.current.srcObject = media;
      void video.current.play().catch(() => undefined);
      setPhase("live");
      void requestPosition();
    } catch (error) {
      if (revision !== cameraRevision.current) return;
      const state = cameraMessage(error);
      setCameraError(state.message);
      setNativeAvailable(Boolean(state.canUseNative && nativeCamera.current && "capture" in nativeCamera.current));
      setPhase("failed");
    }
  }

  function queuePhoto(frame: HTMLCanvasElement | File, capturedAt: Date) {
    const shot: PhotoJob = { uploadId: crypto.randomUUID(), capturedAt, frame, position: requestPosition(), stage: "preparing" };
    updateShots([...pendingShots.current, shot]);
    void processShot(shot);
  }

  function takePhoto() {
    const viewfinder = video.current;
    if (!viewfinder || !stream.current || phase !== "live" || pendingShots.current.length >= maxOutstandingPhotos) return;
    const capturedAt = new Date();
    try {
      const frame = copyFrame(viewfinder, viewfinder.videoWidth, viewfinder.videoHeight);
      setCameraError("");
      queuePhoto(frame, capturedAt);
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : "Không thể chụp ảnh.");
    }
  }

  function readNativeCapture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || phase !== "failed" || finishing.current || pendingShots.current.length >= maxOutstandingPhotos) return;
    const capturedAt = new Date(file.lastModified);
    const time = capturedAt.getTime();
    if (!Number.isFinite(time) || time < nativeOpenedAt.current - 120_000 || time > Date.now() + 10_000) {
      setCameraError("Hãy chụp một ảnh mới bằng camera.");
      return;
    }
    setCameraError("");
    queuePhoto(file, capturedAt);
  }

  async function processShot(shot: PhotoJob) {
    const revision = lifetime.current;
    let prepared = shot;
    try {
      let blob = shot.blob;
      if (!blob) {
        const position = await shot.position;
        if (revision !== lifetime.current) return;
        const frame = shot.frame instanceof File ? await decodeCapture(shot.frame) : shot.frame;
        if (!frame) throw new Error("Không thể đọc ảnh vừa chụp.");
        if (revision !== lifetime.current) return;
        blob = await stampPhoto(frame, shot.capturedAt, position);
        frame.width = 0;
      }
      if (revision !== lifetime.current) return;
      prepared = { ...shot, frame: undefined, blob, stage: "uploading", error: undefined };
      replaceShot(prepared);
      // Each frame is taken immediately. Keep Drive writes sequential because they share a server-side lock.
      const transfer = uploadTail.current.then(async () => {
        if (revision !== lifetime.current) return null;
        const data = await blobData(blob);
        if (revision !== lifetime.current) return null;
        return uploadPhoto({ uploadId: shot.uploadId, capturedAt: shot.capturedAt.toISOString(), file: { mimeType: "image/jpeg", data } });
      });
      uploadTail.current = transfer.then(() => undefined, () => undefined);
      const result = await transfer;
      if (!result || revision !== lifetime.current) return;
      const { date, folderId, folderUrl, photo } = result;
      if (listPending.current) void refresh();
      if (!galleryBlocked.current) {
        const current = galleryRef.current?.days ?? [];
        const old = current.find((day) => day.date === date);
        const photos = [photo, ...(old?.photos.filter((entry) => entry.id !== photo.id) || [])]
          .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
        publishGallery([...current.filter((day) => day.date !== date), { date, folderId, folderUrl, photos }]);
        setAlbumOpen(true);
        setOpenDays((current) => new Set([...current, date]));
      }
      setNotice(`Đã lưu ảnh vào thư mục ${displayDay(date)}.`);
      setSavedCount((current) => current + 1);
      removeShot(prepared);
    } catch (error) {
      if (revision !== lifetime.current) return;
      if (photoErrorCode(error) === "PHOTO_DELETED") {
        const message = "Ảnh này đã được chuyển vào thùng rác Google Drive.";
        setNotice(message);
        if (!finishing.current) setCameraError(message);
        removeShot(prepared);
        return;
      }
      replaceShot({ ...prepared, stage: "failed", previewUrl: prepared.previewUrl || (prepared.blob ? URL.createObjectURL(prepared.blob) : undefined), error: error instanceof Error ? error.message : "Chưa lưu được ảnh lên Drive." });
    }
  }

  function retryShot(uploadId: string) {
    const shot = pendingShots.current.find((item) => item.uploadId === uploadId);
    if (!canCapture || shot?.stage !== "failed") return;
    const retry: PhotoJob = { ...shot, stage: shot.blob ? "uploading" : "preparing", error: undefined };
    replaceShot(retry);
    void processShot(retry);
  }

  function discardFailedShots() {
    if (pendingShots.current.some((shot) => shot.stage !== "failed")) return;
    pendingShots.current.forEach((shot) => {
      if (shot.previewUrl) URL.revokeObjectURL(shot.previewUrl);
    });
    updateShots([]);
    closeIfFinished();
  }

  function askDeletePhoto(day: ConstructionPhotoDay, photo: ConstructionPhoto) {
    if (!deletePhoto || deletePending.current) return;
    setToDelete({ day, photo });
    setDeleteError("");
    deleteDialog.current?.showModal();
  }

  function closeDeleteDialog() {
    if (deletePending.current) return;
    deleteDialog.current?.close();
    setToDelete(null);
  }

  async function confirmDeletePhoto() {
    if (!deletePhoto || !toDelete || deletePending.current) return;
    const revision = lifetime.current;
    const { day, photo } = toDelete;
    deletePending.current = true;
    setDeleting(true);
    setDeleteError("");
    try {
      await deletePhoto(day, photo);
      if (revision !== lifetime.current) return;
      if (!galleryBlocked.current) publishGallery(galleryRef.current?.days ?? [], photo.id);
      if (listPending.current) void refresh();
      setNotice("Đã chuyển ảnh vào thùng rác Google Drive.");
      deletePending.current = false;
      closeDeleteDialog();
    } catch (error) {
      if (revision === lifetime.current) setDeleteError(error instanceof Error ? error.message : "Chưa xóa được ảnh trên Drive.");
    } finally {
      deletePending.current = false;
      if (revision === lifetime.current) setDeleting(false);
    }
  }

  const failedShots = shots.filter((shot) => shot.stage === "failed");
  const pendingCount = shots.length - failedShots.length;
  const queueFull = shots.length >= maxOutstandingPhotos;

  return <section className="construction-photos" aria-label="Ảnh thi công">
    <header className="construction-photos__header">
      <div><p>Thi công</p><h2><button type="button" className="construction-photos__album" aria-expanded={albumOpen} aria-controls={albumId} onClick={() => setAlbumOpen((open) => !open)}>
        <FolderIcon /> Ảnh thi công <span aria-hidden="true">{albumOpen ? "−" : "+"}</span>
      </button></h2></div>
      <div className="construction-photos__actions">
        <button type="button" className="construction-photos__secondary" disabled={loading} onClick={() => void refresh()}>Nạp lại</button>
        {mobile && canCapture && <button type="button" className="construction-photos__primary" onClick={() => void startCamera()}>
          <CameraIcon /> Chụp ảnh
        </button>}
      </div>
    </header>
    {notice && <p className="construction-photos__status" role="status">{notice}</p>}
    <div id={albumId} hidden={!albumOpen}>
      {listError && <p className="construction-photos__status construction-photos__error" role="alert">{listError}{gallery && " Đang hiển thị danh sách đã lưu."}</p>}
      {loading && !gallery && <p className="construction-photos__empty" role="status">Đang tải thư mục ảnh…</p>}
      {gallery && !days.length && <p className="construction-photos__empty">Chưa có ảnh thi công.</p>}
      {days.length > 0 && <div className="construction-photos__days">
        {days.map((day) => <details key={day.date} open={openDays.has(day.date)} onToggle={(event) => {
          const open = event.currentTarget.open;
          setOpenDays((current) => {
            if (open === current.has(day.date)) return current;
            const next = new Set(current);
            if (open) next.add(day.date);
            else next.delete(day.date);
            return next;
          });
        }}>
          <summary><span className="construction-photos__folder-icon"><FolderIcon /></span><strong>{displayDay(day.date)}</strong><small>{day.photos.length} ảnh</small></summary>
          {openDays.has(day.date) && <div className="construction-photos__day-content">
            {day.folderUrl && <a className="construction-photos__drive" href={day.folderUrl} target="_blank" rel="noreferrer">Mở thư mục trên Drive ↗</a>}
            <ul className="construction-photos__grid">
              {day.photos.map((photo) => <li key={photo.id}>
                <a href={photo.viewUrl || photo.downloadUrl} target="_blank" rel="noreferrer" title={photo.name}>
                  <span className="construction-photos__thumbnail">
                    <CameraIcon />
                    {photo.thumbnailUrl && <img src={photo.thumbnailUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.hidden = true; }} />}
                  </span>
                  <span className="construction-photos__filename">{photo.name}</span>
                </a>
                {deletePhoto && <button type="button" className="construction-photos__photo-delete" aria-label={`Xóa ảnh ${photo.name}`} onClick={() => askDeletePhoto(day, photo)}>Xóa</button>}
              </li>)}
            </ul>
          </div>}
        </details>)}
      </div>}
    </div>
    <dialog ref={deleteDialog} className="construction-photos__dialog construction-photos__delete-dialog" aria-labelledby={deleteTitleId} aria-describedby={deleteDescriptionId}
      onCancel={(event) => { event.preventDefault(); closeDeleteDialog(); }}>
      <header className="construction-photos__dialog-heading"><h3 id={deleteTitleId}>Xóa ảnh thi công?</h3></header>
      <p id={deleteDescriptionId}>Chuyển <strong>{toDelete?.photo.name}</strong> vào thùng rác Google Drive.</p>
      {deleteError && <p className="construction-photos__status construction-photos__error" role="alert">{deleteError}</p>}
      <div className="construction-photos__dialog-actions">
        <button type="button" className="construction-photos__secondary" disabled={deleting} onClick={closeDeleteDialog}>Hủy</button>
        <button type="button" className="construction-photos__primary" disabled={deleting || !deletePhoto} onClick={() => void confirmDeletePhoto()}>{deleting ? "Đang xóa…" : "Xóa ảnh"}</button>
      </div>
    </dialog>
    <dialog ref={dialog} className={`construction-photos__dialog${mobile ? " construction-photos__dialog--mobile" : ""}`} aria-labelledby={cameraTitleId} onCancel={(event) => { event.preventDefault(); closeCamera(); }}>
      <header className="construction-photos__dialog-heading">
        <h3 id={cameraTitleId}>{phase === "finishing" ? "Ảnh vừa chụp" : "Chụp ảnh thi công"}</h3>
        {phase !== "finishing" && <button type="button" aria-label="Đóng camera" onClick={closeCamera}>×</button>}
      </header>
      <video ref={video} className="construction-photos__camera" hidden={phase !== "starting" && phase !== "live"} muted autoPlay playsInline
        onCanPlay={(event) => setVideoReady(Boolean(event.currentTarget.videoWidth))} />
      {phase === "starting" && <p className="construction-photos__status" role="status">Đang mở camera…</p>}
      {(phase === "live" || pendingCount > 0 || savedCount > 0 || failedShots.length > 0) && <div className="construction-photos__capture-status">
        <p className="construction-photos__status" role="status">
          Đã lưu {savedCount} ảnh{pendingCount > 0 && ` · Đang lưu ${pendingCount} ảnh`}{failedShots.length > 0 && ` · ${failedShots.length} ảnh chưa lưu`}
        </p>
        <a className="construction-photos__source" href={weatherAttribution} target="_blank" rel="noreferrer">Thời tiết NOAA</a>
      </div>}
      {cameraError && <p className="construction-photos__status construction-photos__error" role="alert">{cameraError}</p>}
      {queueFull && phase !== "finishing" && <p className="construction-photos__status" role="status">Đã đủ ảnh chờ lưu. Chờ ảnh tải lên hoặc thử lưu lại ảnh lỗi để chụp tiếp.</p>}
      {failedShots.length > 0 && <ul className="construction-photos__failed-shots">
        {failedShots.map((shot) => <li key={shot.uploadId}>
          {shot.previewUrl && <img className="construction-photos__failed-preview" src={shot.previewUrl} alt={`Ảnh chụp lúc ${photoTime.format(shot.capturedAt)}`} />}
          <div><strong>Ảnh lúc {photoTime.format(shot.capturedAt)}</strong><p role="alert">{shot.error}</p></div>
          <button type="button" className="construction-photos__secondary" disabled={!canCapture} onClick={() => retryShot(shot.uploadId)}>Thử lưu lại</button>
        </li>)}
      </ul>}
      <div className="construction-photos__dialog-actions">
        {phase === "live" && <button type="button" className="construction-photos__primary construction-photos__shutter" disabled={!videoReady || queueFull} onClick={takePhoto}>
          <CameraIcon /> Chụp
        </button>}
        {phase === "failed" && <>
          <button type="button" className="construction-photos__secondary" onClick={() => void startCamera()}>Thử lại</button>
          {nativeAvailable && <button type="button" className="construction-photos__primary" disabled={queueFull} onClick={() => {
            nativeOpenedAt.current = Date.now();
            nativeCamera.current?.click();
            void requestPosition();
          }}>Mở camera của thiết bị</button>}
        </>}
        {phase === "finishing" && <>
          {pendingCount === 0 && failedShots.length > 0 && <button type="button" className="construction-photos__secondary" onClick={discardFailedShots}>Bỏ ảnh chưa lưu</button>}
          <button type="button" className="construction-photos__primary" disabled={!canCapture} onClick={() => void startCamera()}>Chụp tiếp</button>
        </>}
      </div>
      <input ref={nativeCamera} type="file" accept="image/*" capture="environment" hidden onChange={readNativeCapture} />
    </dialog>
  </section>;
}
