import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.GM_TEST_PLAYWRIGHT_MODULE || "playwright");
const baseUrl = process.env.GM_TEST_BASE_URL || "http://127.0.0.1:5173/gm-manager/";
const origin = new URL(baseUrl).origin;
const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const scriptUrl = source.match(/scriptUrl:\s*"(https:\/\/script\.google\.com\/[^"]+)"/)[1];
const account = "cong-trinh@example.com";
const managerAccount = "quan-ly@example.com";
const personnel = {
  construction: [
    { id: "construction-qa", name: "Nhân viên kiểm thử", loginCode: "111111", email: account, status: "Có", role: "Nhân công", permissions: ["Thi công"] },
    { id: "construction-manager-qa", name: "Quản lý kiểm thử", loginCode: "222222", email: managerAccount, status: "Có", role: "Quản lý chung", permissions: ["Thi công"] },
  ],
};
const sessionToken = (account) => Buffer.from(JSON.stringify({
  version: 2,
  purpose: "workflow",
  account,
  nonce: "construction-qa",
  expiresAt: Date.parse("2026-12-09T00:00:00Z"),
})).toString("base64url") + ".fixture-signature";
const token = sessionToken(account);
const managerToken = sessionToken(managerAccount);
const project = { id: "construction-qa-house", name: "Công trình kiểm thử", houseId: "QA-ANH", projectId: "CONSTRUCTION-QA", driveFolderId: "qa-folder", createdAt: "05/11/2026", isHydrated: true, progressHydrated: true, details: { HVT: "Công trình kiểm thử" } };
const years = [{ year: 2026, months: Array.from({ length: 12 }, (_, index) => ({ label: "T" + (index + 1), records: index === 10 ? [project] : [] })) }];
const captureTimes = ["2026-11-07T16:59:59.000Z", "2026-11-07T17:00:05.000Z", "2026-11-07T17:00:06.000Z"];
const captureDates = ["07-11-2026", "08-11-2026", "08-11-2026"];
const trashedUploadTime = "2026-11-07T17:00:07.000Z";
const locationTestTime = new Date("2026-11-08T04:00:00.000Z");
const expectedPhotos = captureTimes.map((capturedAt, index) => ({
  id: `fixture-photo-${index + 1}`,
  name: `Anh-thi-cong-${index + 1}.jpg`,
  mimeType: "image/jpeg",
  capturedAt,
  viewUrl: `https://drive.google.com/file/d/fixture-photo-${index + 1}/view`,
  downloadUrl: `https://drive.google.com/uc?export=download&id=fixture-photo-${index + 1}`,
  dayFolderId: index === 2 ? "alternate-same-day-folder" : `fixture-day-${captureDates[index]}`,
}));
const savedDays = new Map();
const uploads = [];
const deletions = [];
const listOverrides = new Map();
const weather = [];
const pageErrors = [];
let releaseFirstUpload;
const firstUploadGate = new Promise((resolve) => { releaseFirstUpload = resolve; });
let observeFirstUpload;
const firstUploadStarted = new Promise((resolve) => { observeFirstUpload = resolve; });

async function dispatch(payload) {
  if (payload.action === "load-consulting" || payload.action === "load-workspace-cache") return { ok: true, years, record: project };
  if (payload.action === "load-personnel") return { ok: true, personnel };
  if (payload.action === "load-assigned-work-notes") return { ok: true, notes: [], projectRevisions: [] };
  if (payload.action === "load-assigned-design-tasks") return { ok: true, tasks: [] };
  if (payload.action === "load-customer-messages") return { ok: true, messages: [], configured: true };
  if (payload.action === "list-construction-photos") {
    assert.equal(payload.projectId, project.projectId);
    assert.ok([token, managerToken].includes(payload.workflowSessionToken));
    const override = listOverrides.get(payload.workflowSessionToken);
    if (override) return override();
    return { ok: true, days: [...savedDays.values()] };
  }
  if (payload.action === "upload-construction-photo") {
    uploads.push(payload);
    if (payload.capturedAt === trashedUploadTime) return { ok: false, code: "PHOTO_DELETED", error: "Ảnh đã nằm trong thùng rác." };
    if (uploads.length === 1) {
      observeFirstUpload();
      await firstUploadGate;
      return { ok: false, error: "Drive chưa lưu được ảnh. Hãy thử lại." };
    }
    if (payload.capturedAt.startsWith("2026-11-08T")) {
      const id = `fixture-location-${uploads.length}`;
      const folderId = "fixture-location-folder";
      const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
      const photo = { id, name: `${id}.jpg`, mimeType: "image/jpeg", capturedAt: payload.capturedAt, viewUrl: `https://drive.google.com/file/d/${id}/view`, downloadUrl: `https://drive.google.com/uc?export=download&id=${id}` };
      return { ok: true, date: "08-11-2026", folderId, folderUrl, photo };
    }
    const index = captureTimes.indexOf(payload.capturedAt);
    assert.ok(index >= 0);
    const date = captureDates[index];
    const photo = expectedPhotos[index];
    const folderId = `fixture-day-${date}`;
    const folderUrl = `https://drive.google.com/drive/folders/${folderId}`;
    const photos = [photo, ...(savedDays.get(date)?.photos || []).filter((item) => item.id !== photo.id)];
    savedDays.set(date, { date, folderId, folderUrl, photos });
    return { ok: true, date, folderId, folderUrl, photo };
  }
  if (payload.action === "delete-construction-photo") {
    assert.equal(payload.workflowSessionToken, managerToken);
    assert.equal(payload.projectId, project.projectId);
    assert.equal(payload.photoId, expectedPhotos[2].id);
    assert.equal(payload.date, captureDates[2]);
    assert.equal(payload.dayFolderId, expectedPhotos[2].dayFolderId);
    deletions.push(payload);
    if (deletions.length === 1) return { ok: false, error: "Drive chưa xóa được ảnh." };
    const group = savedDays.get(payload.date);
    savedDays.set(payload.date, { ...group, photos: group.photos.filter((item) => item.id !== payload.photoId) });
    return { ok: true, deleted: true, trashed: true };
  }
  return { ok: true };
}

const browser = await chromium.launch({
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  ...(process.env.GM_TEST_BROWSER_PATH ? { executablePath: process.env.GM_TEST_BROWSER_PATH } : {}),
});

async function enterGallery(page) {
  await page.locator(".customer-result").filter({ hasText: project.houseId }).click();
  await page.getByRole("button", { name: "Thi công", exact: true }).click();
  const photos = page.getByRole("region", { name: "Ảnh thi công", exact: true });
  await photos.waitFor();
  return photos;
}

async function openWorkspace({ mobile = true, denyCamera = false, manager = false, storageState, controlledLocation = false, controlledNotifications = false, distantWeatherRecovery = false } = {}) {
  const context = await browser.newContext({
    ...(mobile ? devices["Pixel 8"] : { viewport: { width: 1280, height: 900 } }),
    serviceWorkers: "block",
    geolocation: { latitude: 21.02851, longitude: 105.85417, accuracy: 10 },
    permissions: controlledLocation ? ["camera"] : ["camera", "geolocation"],
    timezoneId: "Asia/Ho_Chi_Minh",
    storageState,
  });
  await context.exposeBinding("constructionDispatch", (_source, payload) => dispatch(payload));
  await context.addInitScript(({ account, personnel, years, token, scriptUrl, denyCamera, origin, controlledLocation, controlledNotifications }) => {
    if (location.origin !== origin) return;
    localStorage.setItem("gm-manager-consulting", JSON.stringify(years));
    localStorage.setItem("gm-manager-personnel-v1", JSON.stringify(personnel));
    localStorage.setItem("gm-manager-personnel-session-email", account);
    localStorage.setItem("gm-manager-workflow-session-v1", JSON.stringify({ account, token, scriptUrl }));
    window.constructionCameraTest = { calls: 0, tracks: [], lines: [], locationRequests: [], notificationRequests: [] };
    if (controlledLocation) {
      const queryPermission = navigator.permissions.query.bind(navigator.permissions);
      const locationPermission = Object.assign(new EventTarget(), { state: "prompt" });
      navigator.permissions.query = (descriptor) => descriptor.name === "geolocation" ? Promise.resolve(locationPermission) : queryPermission(descriptor);
      navigator.geolocation.getCurrentPosition = (success, error, options) => {
        const { calls, locationRequests } = window.constructionCameraTest;
        locationRequests.push({
          success: (position) => {
            locationPermission.state = "granted";
            locationPermission.dispatchEvent(new Event("change"));
            success(position);
          },
          error: (failure) => {
            if (failure.code === 1) {
              locationPermission.state = "denied";
              locationPermission.dispatchEvent(new Event("change"));
            }
            error(failure);
          },
          options,
          priorCameraCalls: calls,
          activation: navigator.userActivation.isActive,
        });
      };
    }
    if (controlledNotifications) {
      let notificationPermission = "default";
      Object.defineProperty(Notification, "permission", { configurable: true, get: () => notificationPermission });
      Notification.requestPermission = () => {
        const probe = window.constructionCameraTest;
        probe.notificationRequests.push(navigator.userActivation.isActive);
        return new Promise((resolve) => {
          probe.grantNotifications = () => {
            notificationPermission = "granted";
            resolve(notificationPermission);
          };
        });
      };
      Object.defineProperty(navigator.serviceWorker, "ready", {
        configurable: true,
        value: Promise.resolve({ active: {}, showNotification: async () => {} }),
      });
    }
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.constructionCameraTest.lines.push(String(text));
      return fillText.call(this, text, ...args);
    };
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      window.constructionCameraTest.calls++;
      if (denyCamera) throw new DOMException("Permission denied", "NotAllowedError");
      const stream = await getUserMedia(constraints);
      window.constructionCameraTest.tracks.push(...stream.getTracks());
      return stream;
    };
  }, { account: manager ? managerAccount : account, personnel, years, token: manager ? managerToken : token, scriptUrl, denyCamera, origin, controlledLocation, controlledNotifications });
  let contextWeatherRequests = 0;
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    if (url.hostname === "script.google.com") return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<meta charset="utf-8"><script>
      addEventListener('message', async event => {
        if(event.data?.channel !== 'gm-manager-apps-script') return;
        const {id,payload} = event.data;
        const result = await window.constructionDispatch(payload);
        event.source.postMessage({channel:'gm-manager-apps-script-response',id,result},'*');
      });
      parent.postMessage({channel:'gm-manager-apps-script-ready'},'*');
      <\/script>` });
    if (url.hostname === "mapservices.weather.noaa.gov") {
      weather.push(url);
      contextWeatherRequests++;
      if (distantWeatherRecovery && contextWeatherRequests === 1) return route.fulfill({ status: 503 });
      return route.fulfill({ json: { features: [{ attributes: {
        station_id: distantWeatherRecovery ? "QA99" : "VVNB",
        observation_time: controlledLocation ? locationTestTime.getTime() - 5 * 60_000 : Date.parse("2026-11-07T16:55:00Z"),
        latitude: distantWeatherRecovery ? 22.05 : 21.218,
        longitude: 105.805,
        temp_c: 19,
        wx_string: "-RA",
        sky_cover: "OVC",
      } }] } });
    }
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  if (controlledLocation) await page.clock.install({ time: locationTestTime });
  else await page.clock.setFixedTime(new Date(captureTimes[0]));
  await page.goto(baseUrl);
  return { context, page };
}

async function openProject(options) {
  const workspace = await openWorkspace(options);
  const photos = await enterGallery(workspace.page);
  return { ...workspace, photos };
}

async function openLocationCamera(options = {}) {
  const project = await openProject({ controlledLocation: true, ...options });
  await project.photos.getByRole("button", { name: "Chụp ảnh", exact: true }).tap();
  const camera = project.page.getByRole("dialog", { name: "Chụp ảnh thi công" });
  const shutter = camera.getByRole("button", { name: "Chụp", exact: true });
  return { ...project, camera, shutter };
}

async function respondToLocation(page, index, { code, accuracy = 10 } = {}) {
  await page.waitForFunction((index) => window.constructionCameraTest.locationRequests.length > index, index);
  await page.evaluate(({ index, code, accuracy }) => {
    const request = window.constructionCameraTest.locationRequests[index];
    if (code) request.error({ code });
    else request.success({ coords: { latitude: 21.02851, longitude: 105.85417, accuracy }, timestamp: Date.now() });
  }, { index, code, accuracy });
}

const capturedStamps = (page) => page.evaluate(() => window.constructionCameraTest.lines);

try {
  const { context, page, photos } = await openProject();
  await photos.getByText("Chưa có ảnh thi công.").waitFor();
  assert.equal(await page.evaluate(() => window.constructionCameraTest.calls), 0);
  await photos.getByRole("button", { name: "Chụp ảnh", exact: true }).click();
  const camera = page.getByRole("dialog", { name: "Chụp ảnh thi công" });
  const shutter = camera.getByRole("button", { name: "Chụp", exact: true });
  const frame = await camera.locator("video").boundingBox();
  const shutterBounds = await shutter.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(frame.width >= viewport.width - 24 && frame.height >= viewport.height * 0.72, `Small viewfinder ${JSON.stringify(frame)}`);
  assert.ok(shutterBounds.y + shutterBounds.height <= viewport.height, `Off-screen shutter ${JSON.stringify(shutterBounds)}`);
  await shutter.tap();
  await firstUploadStarted;
  await page.clock.setFixedTime(new Date(captureTimes[1]));
  await shutter.tap();
  await page.clock.setFixedTime(new Date(captureTimes[2]));
  await shutter.tap();
  await camera.getByText("Đã lưu 0 ảnh · Đang lưu 3 ảnh", { exact: true }).waitFor();
  assert.equal(uploads.length, 1);
  assert.deepEqual(await page.evaluate(() => ({ calls: window.constructionCameraTest.calls, tracks: window.constructionCameraTest.tracks.map((track) => track.readyState) })), { calls: 1, tracks: ["live"] });
  await camera.getByRole("button", { name: "Đóng camera" }).tap();
  await camera.waitFor({ state: "hidden" });
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.equal(await page.evaluate(() => window.constructionCameraTest.tracks[0]?.readyState), "ended");
  assert.equal(uploads.length, 1);
  await page.getByRole("button", { name: /Tổng quan/ }).tap();
  await photos.waitFor({ state: "hidden" });
  await enterGallery(page);
  await photos.getByRole("button", { name: "Chụp ảnh", exact: true }).tap();
  await camera.getByText("Đã lưu 0 ảnh · Đang lưu 3 ảnh", { exact: true }).waitFor();
  releaseFirstUpload();
  await camera.getByRole("img", { name: "Ảnh chụp lúc 23:59:59" }).waitFor();
  await camera.getByText(/Drive chưa lưu được ảnh/).waitFor();
  await camera.getByText("Đã lưu 2 ảnh · 1 ảnh chưa lưu", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.constructionCameraTest.tracks[1]?.readyState), "live");
  await page.keyboard.press("Escape");
  await camera.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.constructionCameraTest.tracks[1]?.readyState), "ended");
  const stamps = await page.evaluate(() => window.constructionCameraTest.lines);
  const stampedPhotos = Array.from({ length: 3 }, (_, index) => stamps.slice(index * 4, index * 4 + 4)).sort((left, right) => left[0].localeCompare(right[0]) || left[1].localeCompare(right[1]));
  assert.deepEqual(stampedPhotos, [
    ["Ngày: 07/11/2026", "Giờ: 23:59:59"],
    ["Ngày: 08/11/2026", "Giờ: 00:00:05"],
    ["Ngày: 08/11/2026", "Giờ: 00:00:06"],
  ].map((dateTime) => [...dateTime,
    "Thời tiết: 19°C · Mưa nhẹ (trạm VVNB)",
    "Địa điểm: 21.02851, 105.85417",
  ]));
  assert.equal(weather.length, 1);
  assert.ok(!weather[0].searchParams.get("geometry").includes("21.02851"));
  await photos.getByRole("button", { name: "Thử lưu lại" }).tap();
  await photos.getByText("Đã lưu ảnh vào thư mục 07/11/2026.").waitFor();
  for (const photo of expectedPhotos) {
    const link = photos.getByRole("link", { name: photo.name });
    await link.waitFor();
    assert.equal(await link.getAttribute("title"), null);
    assert.equal(await photos.getByText(photo.name, { exact: true }).count(), 0);
  }
  const dayLinks = await photos.getByRole("link", { name: /Mở thư mục trên Drive/ }).evaluateAll((links) => links.map((link) => link.href));
  assert.deepEqual(dayLinks, [savedDays.get("08-11-2026").folderUrl, savedDays.get("07-11-2026").folderUrl]);
  assert.equal(uploads.length, 4);
  assert.equal(new Set(uploads.map((upload) => upload.uploadId)).size, 3);
  assert.equal(uploads[0].uploadId, uploads[3].uploadId);
  assert.equal(uploads[0].capturedAt, uploads[3].capturedAt);
  assert.equal(uploads[0].file.data, uploads[3].file.data);
  for (const upload of uploads) {
    assert.equal(upload.file.mimeType, "image/jpeg");
    assert.match(upload.file.data, /^\/9j\//);
  }

  await page.clock.setFixedTime(new Date(trashedUploadTime));
  await photos.getByRole("button", { name: "Chụp ảnh", exact: true }).tap();
  await shutter.tap();
  await camera.getByText("Ảnh này đã được chuyển vào thùng rác Google Drive.").waitFor();
  assert.equal(await camera.getByRole("button", { name: "Thử lưu lại" }).count(), 0);
  await camera.getByRole("button", { name: "Đóng camera" }).tap();
  await camera.waitFor({ state: "hidden" });

  let failOfflineList;
  listOverrides.set(token, () => new Promise((resolve) => { failOfflineList = resolve; }));
  await page.reload();
  const remembered = await enterGallery(page);
  const recentPhoto = remembered.getByRole("link", { name: expectedPhotos[2].name });
  await recentPhoto.waitFor();
  assert.equal(await remembered.getByRole("button", { name: /Xóa ảnh/ }).count(), 0);
  assert.ok(failOfflineList, "The background Drive request started while cached photos were visible");
  failOfflineList({ ok: false, error: "Không kết nối được Drive." });
  await remembered.getByText(/Đang hiển thị danh sách đã lưu/).waitFor();
  await recentPhoto.waitFor();
  listOverrides.delete(token);
  await context.close();

  const denied = await openProject({ denyCamera: true });
  await denied.photos.getByRole("button", { name: "Chụp ảnh", exact: true }).click();
  await denied.page.getByRole("dialog").getByText(/Hãy cấp quyền camera/).waitFor();
  assert.equal(await denied.page.getByRole("button", { name: "Mở camera của thiết bị" }).count(), 0);
  await denied.context.close();

  const desktop = await openProject({ mobile: false });
  const album = desktop.photos.getByRole("button", { name: "Ảnh thi công", exact: true });
  const day = desktop.photos.getByText("08/11/2026", { exact: true });
  await day.waitFor();
  await album.click();
  await day.waitFor({ state: "hidden" });
  await album.click();
  assert.equal(await desktop.photos.getByRole("button", { name: "Chụp ảnh", exact: true }).count(), 0);
  await desktop.photos.getByRole("link", { name: expectedPhotos[2].name }).waitFor();
  await desktop.context.close();

  const manager = await openProject({ manager: true, mobile: false });
  const deleteButton = manager.photos.getByRole("button", { name: `Xóa ảnh ${expectedPhotos[2].name}` });
  const confirmDialog = manager.page.getByRole("dialog", { name: "Xóa ảnh thi công?" });
  const confirmButton = confirmDialog.getByRole("button", { name: "Xóa ảnh", exact: true });
  const cancelButton = confirmDialog.getByRole("button", { name: "Hủy", exact: true });
  const deletePhotoLink = manager.photos.getByRole("link", { name: expectedPhotos[2].name });
  const reloadAlbum = manager.photos.getByRole("button", { name: "Nạp lại", exact: true });
  await deleteButton.waitFor();
  const imageBounds = await deletePhotoLink.boundingBox();
  const deleteBounds = await deleteButton.boundingBox();
  const rightInset = imageBounds.x + imageBounds.width - deleteBounds.x - deleteBounds.width;
  const bottomInset = imageBounds.y + imageBounds.height - deleteBounds.y - deleteBounds.height;
  assert.ok(rightInset >= 0 && rightInset <= 12 && bottomInset >= 0 && bottomInset <= 12 && deleteBounds.height >= 44);
  await deleteButton.click();
  await confirmDialog.getByText(/vào thùng rác Google Drive/).waitFor();
  await cancelButton.click();
  assert.equal(deletions.length, 0);
  await deleteButton.click();
  await confirmButton.click();
  await confirmDialog.getByText("Drive chưa xóa được ảnh.").waitFor();
  await cancelButton.click();
  await deletePhotoLink.waitFor();

  const staleSnapshot = structuredClone([...savedDays.values()]);
  let releaseStale;
  let observeStale;
  const staleGate = new Promise((resolve) => { releaseStale = resolve; });
  const staleStarted = new Promise((resolve) => { observeStale = resolve; });
  let staleCalls = 0;
  listOverrides.set(managerToken, async () => {
    if (++staleCalls === 1) { observeStale(); await staleGate; }
    return { ok: true, days: staleSnapshot };
  });
  await reloadAlbum.click();
  await staleStarted;
  await deleteButton.click();
  await confirmButton.click();
  await manager.photos.getByText("Đã chuyển ảnh vào thùng rác Google Drive.").waitFor();
  releaseStale();
  await manager.page.waitForFunction(() => !Array.from(document.querySelectorAll(".construction-photos button")).find((button) => button.textContent === "Nạp lại")?.disabled);
  assert.equal(staleCalls, 2);
  assert.equal(await deletePhotoLink.count(), 0);
  await manager.photos.getByRole("link", { name: expectedPhotos[1].name }).waitFor();
  const managerStorage = await manager.context.storageState();
  const photoCache = managerStorage.origins.find((item) => item.origin === origin).localStorage.find((item) => item.name.startsWith("gm-manager-construction-photos-v1:"));
  assert.ok(photoCache.name.includes(managerAccount));
  assert.equal(JSON.parse(photoCache.value).days.flatMap((day) => day.photos).some((photo) => photo.id === expectedPhotos[2].id), false);

  let releaseStaffList;
  listOverrides.set(token, () => new Promise((resolve) => { releaseStaffList = resolve; }));
  const staff = await openProject({ mobile: false, storageState: managerStorage });
  await staff.photos.getByText("Đang tải thư mục ảnh…").waitFor();
  assert.equal(await staff.photos.getByRole("link", { name: expectedPhotos[1].name }).count(), 0);
  releaseStaffList?.({ ok: true, days: [] });
  listOverrides.delete(token);
  await staff.context.close();

  await manager.page.reload();
  const afterDeletion = await enterGallery(manager.page);
  await afterDeletion.getByRole("link", { name: expectedPhotos[1].name }).waitFor();
  assert.equal(await afterDeletion.getByRole("link", { name: expectedPhotos[2].name }).count(), 0);

  // Drive can restore a trashed file. A later fresh read must show it once the grace expires.
  await manager.page.clock.setFixedTime(new Date(Date.parse(captureTimes[0]) + 11 * 60_000));
  await reloadAlbum.click();
  await deletePhotoLink.waitFor();

  listOverrides.set(managerToken, () => ({ ok: false, code: "FORBIDDEN", error: "Không có quyền xem ảnh thi công." }));
  await reloadAlbum.click();
  await manager.photos.getByText("Không có quyền xem ảnh thi công.").waitFor();
  assert.equal(await manager.photos.getByRole("link", { name: expectedPhotos[1].name }).count(), 0);
  assert.equal(await manager.page.evaluate((key) => localStorage.getItem(key), photoCache.name), null);
  await manager.context.close();

  const slow = await openLocationCamera({ distantWeatherRecovery: true });
  const initialLocationRequest = await slow.page.evaluate(() => {
    const { options, priorCameraCalls, activation } = window.constructionCameraTest.locationRequests[0];
    return { options, priorCameraCalls, activation };
  });
  assert.deepEqual(initialLocationRequest, { options: { enableHighAccuracy: false, maximumAge: 60000, timeout: 8000 }, priorCameraCalls: 0, activation: true });
  const uploadsBeforeSlow = uploads.length;
  const weatherBeforeSlow = weather.length;
  await slow.shutter.tap();
  await slow.page.clock.fastForward(9500);
  await slow.camera.getByText("Đang lấy vị trí…").waitFor();
  assert.equal(uploads.length, uploadsBeforeSlow);
  await slow.shutter.tap();
  await slow.page.clock.fastForward(11_000);
  await slow.camera.getByText("Đã lưu 1 ảnh · Đang lưu 1 ảnh", { exact: true }).waitFor();
  assert.equal(weather.length, weatherBeforeSlow);
  assert.deepEqual((await capturedStamps(slow.page)).slice(-2), ["Thời tiết: Chưa có vị trí để tra", "Địa điểm: Không lấy được vị trí"]);

  // The original permission request stays alive even after the first photo reaches its wait limit.
  await respondToLocation(slow.page, 0, { accuracy: 420 });
  await slow.camera.getByText("Đã lấy vị trí.").waitFor();
  await slow.camera.getByText("Đã lưu 2 ảnh", { exact: true }).waitFor();
  assert.deepEqual((await capturedStamps(slow.page)).slice(-2), ["Thời tiết: Không lấy được bản tin NOAA", "Địa điểm: 21.02851, 105.85417 (±420 m)"]);
  await slow.shutter.tap();
  await slow.camera.getByText("Đã lưu 3 ảnh", { exact: true }).waitFor();
  assert.equal(weather.length, weatherBeforeSlow + 2);
  assert.equal(await slow.page.evaluate(() => window.constructionCameraTest.locationRequests.length), 1);
  assert.deepEqual((await capturedStamps(slow.page)).slice(-2), ["Thời tiết: 19°C · Mưa nhẹ (trạm QA99, cách 114 km)", "Địa điểm: 21.02851, 105.85417 (±420 m)"]);
  await slow.context.close();

  const transient = await openLocationCamera();
  await transient.shutter.tap();
  await respondToLocation(transient.page, 0, { code: 2 });
  await respondToLocation(transient.page, 1, { code: 3 });
  const fallbackOptions = await transient.page.evaluate(() => window.constructionCameraTest.locationRequests[1].options);
  assert.deepEqual(fallbackOptions, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
  await transient.camera.getByText("Chưa nhận được vị trí. Hãy cấp quyền hoặc thử lại.").waitFor();
  await transient.camera.getByText("Đã lưu 1 ảnh", { exact: true }).waitFor();
  await transient.camera.getByRole("button", { name: "Thử lại vị trí" }).tap();
  await respondToLocation(transient.page, 2);
  await transient.camera.getByText("Đã lấy vị trí.").waitFor();
  await transient.shutter.tap();
  await transient.camera.getByText("Đã lưu 2 ảnh", { exact: true }).waitFor();
  assert.deepEqual((await capturedStamps(transient.page)).slice(-2), ["Thời tiết: 19°C · Mưa nhẹ (trạm VVNB)", "Địa điểm: 21.02851, 105.85417"]);
  await transient.context.close();

  const deniedLocation = await openLocationCamera();
  const weatherBeforeDenial = weather.length;
  await respondToLocation(deniedLocation.page, 0, { code: 1 });
  await deniedLocation.camera.getByText("Hãy cho phép GM Manager dùng vị trí trong cài đặt điện thoại hoặc trình duyệt.").waitFor();
  await deniedLocation.shutter.tap();
  await deniedLocation.camera.getByText("Đã lưu 1 ảnh", { exact: true }).waitFor();
  assert.equal(weather.length, weatherBeforeDenial);
  assert.equal(await deniedLocation.page.evaluate(() => window.constructionCameraTest.locationRequests.length), 1);
  assert.deepEqual((await capturedStamps(deniedLocation.page)).slice(-2), ["Thời tiết: Chưa có vị trí để tra", "Địa điểm: Không lấy được vị trí"]);
  await deniedLocation.context.close();

  const overview = await openWorkspace({ controlledLocation: true, controlledNotifications: true });
  const overviewActions = overview.page.locator(".workspace-header .customer-gateway__actions");
  const enablePermissions = overviewActions.getByRole("button", { name: /thông báo và vị trí/i });
  await enablePermissions.waitFor();
  assert.equal(await enablePermissions.count(), 1);
  assert.equal(await overviewActions.getByRole("button", { name: /(?:bật thông báo|cho phép vị trí)$/i }).count(), 0);
  assert.deepEqual(await overview.page.evaluate(() => {
    const { locationRequests, notificationRequests } = window.constructionCameraTest;
    return [locationRequests.length, notificationRequests.length];
  }), [0, 0]);
  await enablePermissions.tap();
  await overview.page.waitForFunction(() => {
    const { locationRequests, notificationRequests } = window.constructionCameraTest;
    return locationRequests.length === 1 && notificationRequests.length === 1;
  });
  await overview.page.evaluate(() => window.constructionCameraTest.grantNotifications());
  await respondToLocation(overview.page, 0, { code: 1 });
  await enablePermissions.tap();
  await respondToLocation(overview.page, 1);
  await overviewActions.getByRole("button", { name: /^(?:✓\s*)?đã bật thông báo và vị trí$/i }).waitFor();
  assert.equal(await overview.page.getByRole("dialog").count(), 0);
  assert.deepEqual(await overview.page.evaluate(() => {
    const { calls, locationRequests, notificationRequests } = window.constructionCameraTest;
    return { calls, locationActivations: locationRequests.map((request) => request.activation), notificationRequests };
  }), { calls: 0, locationActivations: [true, true], notificationRequests: [true] });
  await overview.context.close();

  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ passed: true, vietnamMidnight: true, largeMobileViewfinder: true, threePhotosWhileUploadPending: true, cameraClosesImmediately: true, queuedAcrossNavigation: true, reopenedCameraStaysOpen: true, sameUploadIdOnRetry: true, desktopView: true, cameraPermissionDenied: true, offlineMetadata: true, accountIsolation: true, managerDeleteAndConfirm: true, deleteOverlaysPhoto: true, photoNamesHidden: true, staleReadProtection: true, restoreFromDrive: true, lateLocationPermission: true, boundedLocationWait: true, locationRetry: true, locationDenial: true, weatherRetryAndDistantStation: true, overviewLocationPermission: true }));
} finally {
  await browser.close();
}
