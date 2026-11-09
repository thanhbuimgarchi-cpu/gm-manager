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
const personnel = {
  construction: [{ id: "construction-qa", name: "Nhân viên kiểm thử", loginCode: "111111", email: account, status: "Có", role: "Nhân công", permissions: ["Thi công"] }],
};
const token = Buffer.from(JSON.stringify({
  version: 2,
  purpose: "workflow",
  account,
  nonce: "construction-qa",
  expiresAt: Date.parse("2026-12-09T00:00:00Z"),
})).toString("base64url") + ".fixture-signature";
const project = { id: "construction-qa-house", name: "Công trình kiểm thử", houseId: "QA-ANH", projectId: "CONSTRUCTION-QA", driveFolderId: "qa-folder", createdAt: "05/11/2026", isHydrated: true, progressHydrated: true, details: { HVT: "Công trình kiểm thử" } };
const years = [{ year: 2026, months: Array.from({ length: 12 }, (_, index) => ({ label: "T" + (index + 1), records: index === 10 ? [project] : [] })) }];
const photo = {
  id: "fixture-photo",
  name: "Anh-thi-cong-000005.jpg",
  mimeType: "image/jpeg",
  capturedAt: "2026-11-07T17:00:05.000Z",
  viewUrl: "https://drive.google.com/file/d/fixture-photo/view",
  downloadUrl: "https://drive.google.com/uc?export=download&id=fixture-photo",
};
const group = { date: "08-11-2026", folderId: "fixture-day-folder", folderUrl: "https://drive.google.com/drive/folders/fixture-day-folder", photos: [photo] };
const uploads = [];
const weather = [];
const pageErrors = [];
let saved = false;

function dispatch(payload) {
  if (payload.action === "load-consulting" || payload.action === "load-workspace-cache") return { ok: true, years, record: project };
  if (payload.action === "load-personnel") return { ok: true, personnel };
  if (payload.action === "load-assigned-work-notes") return { ok: true, notes: [], projectRevisions: [] };
  if (payload.action === "load-assigned-design-tasks") return { ok: true, tasks: [] };
  if (payload.action === "load-customer-messages") return { ok: true, messages: [], configured: true };
  if (payload.action === "list-construction-photos") {
    assert.equal(payload.projectId, project.projectId);
    assert.equal(payload.workflowSessionToken, token);
    return { ok: true, days: saved ? [group] : [] };
  }
  if (payload.action === "upload-construction-photo") {
    uploads.push(payload);
    if (uploads.length === 1) return { ok: false, error: "Drive chưa lưu được ảnh. Hãy thử lại." };
    saved = true;
    return { ok: true, date: group.date, folderId: group.folderId, folderUrl: group.folderUrl, photo };
  }
  return { ok: true };
}

const browser = await chromium.launch({
  headless: true,
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  ...(process.env.GM_TEST_BROWSER_PATH ? { executablePath: process.env.GM_TEST_BROWSER_PATH } : {}),
});

async function openProject({ mobile = true, denyCamera = false } = {}) {
  const context = await browser.newContext({
    ...(mobile ? devices["Pixel 8"] : { viewport: { width: 1280, height: 900 } }),
    serviceWorkers: "block",
    geolocation: { latitude: 21.02851, longitude: 105.85417, accuracy: 10 },
    permissions: ["camera", "geolocation"],
    timezoneId: "Asia/Ho_Chi_Minh",
  });
  await context.exposeBinding("constructionDispatch", (_source, payload) => dispatch(payload));
  await context.addInitScript(({ account, personnel, years, token, scriptUrl, denyCamera }) => {
    if (location.protocol !== "http:") return;
    localStorage.setItem("gm-manager-consulting", JSON.stringify(years));
    localStorage.setItem("gm-manager-personnel-v1", JSON.stringify(personnel));
    localStorage.setItem("gm-manager-personnel-session-email", account);
    localStorage.setItem("gm-manager-workflow-session-v1", JSON.stringify({ account, token, scriptUrl }));
    window.constructionCameraTest = { calls: 0, tracks: [], lines: [] };
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
  }, { account, personnel, years, token, scriptUrl, denyCamera });
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
      return route.fulfill({ json: { features: [{ attributes: {
        station_id: "VVNB",
        observation_time: Date.parse("2026-11-07T16:55:00Z"),
        latitude: 21.218,
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
  await page.clock.setFixedTime(new Date(photo.capturedAt));
  await page.goto(baseUrl);
  await page.locator(".customer-result").filter({ hasText: project.houseId }).click();
  await page.getByRole("button", { name: "Thi công", exact: true }).click();
  const photos = page.getByRole("region", { name: "Ảnh thi công", exact: true });
  await photos.waitFor();
  return { context, page, photos };
}

try {
  const { context, page, photos } = await openProject();
  await photos.getByText("Chưa có ảnh thi công.").waitFor();
  assert.equal(await page.evaluate(() => window.constructionCameraTest.calls), 0);
  await photos.getByRole("button", { name: "Chụp ảnh", exact: true }).click();
  const shutter = page.getByRole("dialog").getByRole("button", { name: "Chụp", exact: true });
  await shutter.click();
  const preview = page.getByRole("dialog", { name: "Ảnh vừa chụp" });
  await preview.getByRole("img", { name: /Ảnh vừa chụp/ }).waitFor();
  await preview.getByText(/Drive chưa lưu được ảnh/).waitFor();
  assert.equal(uploads.length, 1);
  assert.deepEqual(await page.evaluate(() => window.constructionCameraTest.lines), [
    "Ngày: 08/11/2026",
    "Giờ: 00:00:05",
    "Thời tiết: 19°C · Mưa nhẹ (trạm VVNB)",
    "Địa điểm: 21.02851, 105.85417",
  ]);
  assert.equal(await page.evaluate(() => window.constructionCameraTest.tracks[0]?.readyState), "ended");
  assert.equal(weather.length, 1);
  assert.ok(!weather[0].searchParams.get("geometry").includes("21.02851"));
  await preview.getByRole("button", { name: "Thử lưu lại" }).click();
  await preview.waitFor({ state: "hidden" });
  await photos.getByText("Đã lưu ảnh vào thư mục 08/11/2026.").waitFor();
  await photos.getByRole("link", { name: photo.name }).waitFor();
  assert.equal(await photos.getByRole("link", { name: /Mở thư mục trên Drive/ }).getAttribute("href"), group.folderUrl);
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].uploadId, uploads[1].uploadId);
  assert.equal(uploads[0].capturedAt, photo.capturedAt);
  assert.equal(uploads[0].file.mimeType, "image/jpeg");
  assert.match(uploads[0].file.data, /^\/9j\//);
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
  await day.click();
  assert.equal(await desktop.photos.getByRole("button", { name: "Chụp ảnh", exact: true }).count(), 0);
  await desktop.photos.getByRole("link", { name: photo.name }).waitFor();
  await desktop.context.close();

  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({ passed: true, vietnamMidnight: true, cameraReleased: true, shutterAutoSaves: true, sameUploadIdOnRetry: true, desktopView: true, cameraPermissionDenied: true }));
} finally {
  await browser.close();
}
