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
  loadPhotos: () => Promise<ConstructionPhotoDay[]>;
  uploadPhoto: (input: ConstructionPhotoUpload) => Promise<ConstructionPhotoUploadResult>;
};

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
type PhotoDraft = {
  url: string;
  blob: Blob;
  uploadId: string;
  capturedAt: string;
  weatherStation?: string;
};
type CameraPhase = "closed" | "starting" | "live" | "processing" | "preview" | "failed";

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
  return { blob, weatherStation: weather?.station };
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

export default function ConstructionPhotos({ canCapture, loadPhotos, uploadPhoto }: ConstructionPhotosProps) {
  const albumId = useId();
  const cameraTitleId = useId();
  const [mobile, setMobile] = useState(false);
  const [days, setDays] = useState<ConstructionPhotoDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");
  const [albumOpen, setAlbumOpen] = useState(true);
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<CameraPhase>("closed");
  const [videoReady, setVideoReady] = useState(false);
  const [draft, setDraft] = useState<PhotoDraft | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [nativeAvailable, setNativeAvailable] = useState(false);
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const nativeCamera = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const previewUrl = useRef("");
  const cameraRevision = useRef(0);
  const listRevision = useRef(0);
  const listPending = useRef(false);
  const savingRef = useRef(false);
  const locationRequest = useRef<{ startedAt: number; result: Promise<Position | null> } | null>(null);
  const nativeOpenedAt = useRef(0);
  const loader = useRef(loadPhotos);
  loader.current = loadPhotos;

  const refresh = useCallback(async () => {
    const revision = ++listRevision.current;
    listPending.current = true;
    setLoading(true);
    setListError("");
    try {
      const result = await loader.current();
      if (revision === listRevision.current) setDays([...result].sort(dayOrder));
    } catch (error) {
      if (revision === listRevision.current) setListError(error instanceof Error ? error.message : "Không tải được ảnh thi công.");
    } finally {
      if (revision === listRevision.current) {
        listPending.current = false;
        setLoading(false);
      }
    }
  }, []);

  function releaseStream() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }

  function revokePreview() {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = "";
  }

  useEffect(() => {
    setMobile(onMobile());
    void refresh();
    return () => {
      listRevision.current++;
      cameraRevision.current++;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = "";
    };
  }, [refresh]);

  function closeCamera() {
    if (savingRef.current) return;
    cameraRevision.current++;
    releaseStream();
    revokePreview();
    locationRequest.current = null;
    setDraft(null);
    setSaving(false);
    setPhase("closed");
    if (dialog.current?.open) dialog.current.close();
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
    if (!canCapture || !mobile || savingRef.current) return;
    const revision = ++cameraRevision.current;
    releaseStream();
    revokePreview();
    setDraft(null);
    setCameraError("");
    setNativeAvailable(false);
    setVideoReady(false);
    setPhase("starting");
    if (!dialog.current?.open) dialog.current?.showModal();
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

  async function preparePhoto(canvas: HTMLCanvasElement, capturedAt: Date, revision: number) {
    const position = await requestPosition();
    if (revision !== cameraRevision.current) return;
    const { blob, weatherStation } = await stampPhoto(canvas, capturedAt, position);
    if (revision !== cameraRevision.current) return;
    revokePreview();
    const url = URL.createObjectURL(blob);
    previewUrl.current = url;
    const shot = { url, blob, capturedAt: capturedAt.toISOString(), uploadId: crypto.randomUUID(), weatherStation };
    setDraft(shot);
    setPhase("preview");
    await savePhoto(shot);
  }

  async function takePhoto() {
    if (!video.current || !stream.current || phase !== "live") return;
    const revision = ++cameraRevision.current;
    const capturedAt = new Date();
    try {
      const canvas = copyFrame(video.current, video.current.videoWidth, video.current.videoHeight);
      releaseStream();
      setPhase("processing");
      await preparePhoto(canvas, capturedAt, revision);
    } catch (error) {
      if (revision !== cameraRevision.current) return;
      releaseStream();
      setCameraError(error instanceof Error ? error.message : "Không thể chụp ảnh.");
      setPhase("failed");
    }
  }

  async function readNativeCapture(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const capturedAt = new Date(file.lastModified);
    const time = capturedAt.getTime();
    if (!Number.isFinite(time) || time < nativeOpenedAt.current - 120_000 || time > Date.now() + 10_000) {
      setCameraError("Hãy chụp một ảnh mới bằng camera.");
      return;
    }
    const revision = ++cameraRevision.current;
    setCameraError("");
    setPhase("processing");
    const url = URL.createObjectURL(file);
    try {
      const image = await readImage(url);
      await preparePhoto(copyFrame(image, image.naturalWidth, image.naturalHeight), capturedAt, revision);
    } catch (error) {
      if (revision !== cameraRevision.current) return;
      setCameraError(error instanceof Error ? error.message : "Không thể đọc ảnh vừa chụp.");
      setPhase("failed");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function savePhoto(shot: PhotoDraft) {
    if (savingRef.current || !canCapture) return;
    const revision = cameraRevision.current;
    savingRef.current = true;
    setSaving(true);
    setCameraError("");
    try {
      const data = await blobData(shot.blob);
      if (revision !== cameraRevision.current) return;
      const { date, folderId, folderUrl, photo } = await uploadPhoto({
        uploadId: shot.uploadId,
        capturedAt: shot.capturedAt,
        file: { mimeType: "image/jpeg", data },
      });
      if (revision !== cameraRevision.current) return;
      if (listPending.current) void refresh();
      setDays((current) => {
        const old = current.find((day) => day.date === date);
        const photos = [photo, ...(old?.photos.filter((entry) => entry.id !== photo.id) || [])]
          .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt));
        return [...current.filter((day) => day.date !== date), { date, folderId, folderUrl, photos }].sort(dayOrder);
      });
      setAlbumOpen(true);
      setOpenDays((current) => new Set([...current, date]));
      setNotice(`Đã lưu ảnh vào thư mục ${displayDay(date)}.`);
      savingRef.current = false;
      closeCamera();
    } catch (error) {
      if (revision === cameraRevision.current) setCameraError(error instanceof Error ? error.message : "Chưa lưu được ảnh lên Drive.");
    } finally {
      savingRef.current = false;
      if (revision === cameraRevision.current) setSaving(false);
    }
  }

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
      {listError && <p className="construction-photos__status construction-photos__error" role="alert">{listError}</p>}
      {loading && !days.length && <p className="construction-photos__empty" role="status">Đang tải thư mục ảnh…</p>}
      {!loading && !listError && !days.length && <p className="construction-photos__empty">Chưa có ảnh thi công.</p>}
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
              </li>)}
            </ul>
          </div>}
        </details>)}
      </div>}
    </div>
    <dialog ref={dialog} className="construction-photos__dialog" aria-labelledby={cameraTitleId} onCancel={(event) => { event.preventDefault(); closeCamera(); }}>
      <header className="construction-photos__dialog-heading">
        <h3 id={cameraTitleId}>{phase === "preview" ? "Ảnh vừa chụp" : "Chụp ảnh thi công"}</h3>
        <button type="button" aria-label="Đóng camera" disabled={saving} onClick={closeCamera}>×</button>
      </header>
      <video ref={video} className="construction-photos__camera" hidden={phase !== "starting" && phase !== "live"} muted autoPlay playsInline
        onCanPlay={(event) => setVideoReady(Boolean(event.currentTarget.videoWidth))} />
      {phase === "starting" && <p className="construction-photos__status" role="status">Đang mở camera…</p>}
      {phase === "processing" && <p className="construction-photos__status" role="status">Đang ghi ngày, giờ, thời tiết và vị trí vào ảnh…</p>}
      {phase === "preview" && draft && <>
        <img className="construction-photos__preview" src={draft.url} alt="Ảnh vừa chụp có ngày, giờ, thời tiết và địa điểm" />
        {draft.weatherStation && <p className="construction-photos__source">
          Thời tiết tham khảo từ <a href={weatherAttribution} target="_blank" rel="noreferrer">trạm {draft.weatherStation} trên NOAA Aviation Weather Center</a>.
        </p>}
        {saving && <p className="construction-photos__status" role="status">Đang lưu ảnh lên Drive…</p>}
      </>}
      {cameraError && <p className="construction-photos__status construction-photos__error" role="alert">{cameraError}</p>}
      <div className="construction-photos__dialog-actions">
        {phase === "live" && <button type="button" className="construction-photos__primary" disabled={!videoReady} onClick={() => void takePhoto()}>
          <CameraIcon /> Chụp
        </button>}
        {phase === "preview" && draft && cameraError && !saving && <button type="button" className="construction-photos__primary" disabled={!canCapture} onClick={() => void savePhoto(draft)}>Thử lưu lại</button>}
        {phase === "failed" && <>
          <button type="button" className="construction-photos__secondary" onClick={() => void startCamera()}>Thử lại</button>
          {nativeAvailable && <button type="button" className="construction-photos__primary" onClick={() => {
            nativeOpenedAt.current = Date.now();
            nativeCamera.current?.click();
            void requestPosition();
          }}>Mở camera của thiết bị</button>}
        </>}
      </div>
      <input ref={nativeCamera} type="file" accept="image/*" capture="environment" hidden onChange={(event) => void readNativeCapture(event)} />
    </dialog>
  </section>;
}
