import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

// Local preview and synthetic Apps Script/desktop transport only.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.GM_TEST_PLAYWRIGHT_MODULE || "playwright");
const baseUrl = process.env.GM_TEST_BASE_URL || "http://127.0.0.1:5173/gm-manager/";
const source = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const scriptUrl = source.match(/scriptUrl:\s*"(https:\/\/script\.google\.com\/[^\"]+)"/)[1];
const tokenFor = (account) => `${Buffer.from(JSON.stringify({ version: 2, purpose: "workflow", account, nonce: "photo-qa", expiresAt: Date.parse("2030-01-01T00:00:00Z") })).toString("base64url")}.fixture-signature`;
const reader = "reader@example.com";
const other = "other@example.com";
const notifyOnly = "notify@example.com";
const makeMember = (email, name, permissions, role = "Nhân viên công trình") => ({ id: email, email, name, loginCode: "00123", status: "Có", role, permissions });
let personnel = { coordination: [makeMember(reader, "Người nhận ảnh", ["Thi công"]), makeMember(other, "Quản lý không đăng ký", [], "Quản lý chung"), makeMember(notifyOnly, "Người chỉ nhận báo", ["Ảnh thi công", "Tư vấn"])] };
const project = { id: "photo-project", houseId: "QA-CT", projectId: "PHOTO-QA", name: "Công trình kiểm thử", createdAt: "02/03/2025", isHydrated: true, progressHydrated: true, details: {} };
const current = [{ year: 2026, months: [{ label: "T11", records: [{ ...project, id: "current-duplicate", name: "Hồ sơ trùng mã" }] }] }];
const historical = [{ year: 2025, months: [{ label: "T3", records: [project] }] }];
const shots = [1, 2].map(sequence => ({ id: `shot-${sequence}`, sequence, year: 2025, month: 3, projectId: project.projectId, houseId: project.houseId, actorName: "Nhân lực chụp ảnh", fileName: `Anh-${sequence}.jpg`, capturedAt: "2026-11-09T02:00:00Z" }));
const loads = [];
const notices = [];
const writes = [];
const errors = [];
const browser = await chromium.launch({ headless: true, ...(process.env.GM_TEST_BROWSER_PATH ? { executablePath: process.env.GM_TEST_BROWSER_PATH } : {}) });
let failSecond = true;

async function openAccount(account, mode = "desktop") {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const token = tokenFor(account);
  await context.exposeBinding("photoQaRequest", (_source, payload) => {
    loads.push({ account, payload });
    if (payload.action === "load-personnel") return { ok: true, personnel };
    if (payload.action === "save-personnel-cache") {
      assert.equal(account, "admin");
      assert.equal(payload.workflowSessionToken, token);
      writes.push(payload);
      personnel = payload.personnel;
      return { ok: true };
    }
    if (payload.action === "load-construction-photo-notifications") {
      assert.equal(payload.workflowSessionToken, token);
      const enabled = personnel.coordination.find(member => member.email === account)?.permissions.includes("Ảnh thi công") ?? false;
      return { ok: true, enabled, cursor: shots.length, events: enabled ? shots.filter(shot => shot.sequence > payload.after) : [] };
    }
    if (payload.action === "load-consulting") {
      if (payload.mode === "detail" || payload.mode === "progress") return { ok: true, year: payload.year, month: payload.month, record: project };
      return { ok: true, years: payload.year === 2025 && payload.month === 3 ? historical : current };
    }
    if (payload.action === "load-workspace-cache") return { ok: true, years: current };
    if (payload.action === "list-construction-photos") return { ok: true, days: [] };
    return { ok: true, notes: [], tasks: [], messages: [], configured: true };
  });
  await context.exposeBinding("photoQaNotify", (_source, payload) => {
    const id = new URL(payload.url).searchParams.get("gmcrmConstructionPhoto");
    const shown = !(account === reader && id === "shot-2" && failSecond);
    if (!shown) failSecond = false;
    notices.push({ account, mode, id, shown, ...payload });
    return shown;
  });
  await context.addInitScript(({ account, token, personnel, scriptUrl, mode }) => {
    if (window.top !== window) return;
    localStorage.setItem("gm-manager-personnel-v1", JSON.stringify(personnel));
    localStorage.setItem("gm-manager-personnel-session-email", account);
    localStorage.setItem("gm-manager-workflow-session-v1", JSON.stringify({ token, account, scriptUrl }));
    if (mode === "desktop") window.gmDesktop = { isDesktop: true, isWindows: false, platform: "darwin", showNotification: window.photoQaNotify };
    else {
      Object.defineProperty(window, "Notification", { value: { permission: "granted" } });
      const registration = { active: {}, addEventListener() {}, update: async () => {}, showNotification: (title, options) => window.photoQaNotify({ title, body: options.body, url: options.data.url, tag: options.tag }) };
      Object.defineProperty(navigator, "serviceWorker", { value: { register: async () => registration, getRegistration: async () => registration, addEventListener() {} } });
    }
  }, { account, token, personnel, scriptUrl, mode });
  await context.route("https://script.google.com/**", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<meta charset="utf-8"><script>
addEventListener('message', async event => { if (event.data?.channel !== 'gm-manager-apps-script') return;
const { id, payload } = event.data;
const result = await photoQaRequest(payload);
event.source.postMessage({ channel: 'gm-manager-apps-script-response', id, result }, '*'); });
parent.postMessage({ channel: 'gm-manager-apps-script-ready' }, '*');</script>` }));
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(12_000);
  await page.clock.setFixedTime(new Date("2026-11-09T02:00:00Z"));
  await page.goto(baseUrl);
  return page;
}

const waitUntil = async (condition) => {
  const until = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() >= until) assert.fail(`No matching fixture result. Requests: ${JSON.stringify(loads.map(({ account, payload }) => [account, payload.action, payload.after]))}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
};

try {
  const adminPage = await openAccount("admin");
  await adminPage.getByRole("button", { name: "Nhân lực", exact: true }).click();
  await adminPage.getByRole("button", { name: "Tùy chọn Người nhận ảnh", exact: true }).click();
  await adminPage.getByRole("button", { name: "Thay đổi", exact: true }).click();
  const permission = adminPage.getByRole("checkbox", { name: "Ảnh thi công", exact: true });
  assert.equal(await permission.isChecked(), false);
  await permission.check();
  assert.deepEqual(await adminPage.locator('.personnel-add-form :invalid').evaluateAll(elements => elements.map(element => [element.getAttribute('type'), element.getAttribute('aria-label'), element.validationMessage])), [], 'personnel form is valid before saving');
  await adminPage.evaluate(() => { window.photoQaSubmits = 0; document.addEventListener("submit", () => { window.photoQaSubmits += 1; }); });
  await adminPage.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  assert.equal(await adminPage.evaluate(() => window.photoQaSubmits), 1, "the personnel editor submits from its Save button");
  await waitUntil(() => writes.length === 1);
  assert.deepEqual(personnel.coordination[0].permissions, ["Thi công", "Ảnh thi công"]);
  await adminPage.reload();
  await adminPage.getByRole("button", { name: "Nhân lực", exact: true }).click();
  await adminPage.getByRole("button", { name: "Tùy chọn Người nhận ảnh", exact: true }).click();
  await adminPage.getByRole("button", { name: "Thay đổi", exact: true }).click();
  assert.equal(await permission.isChecked(), true);

  const otherPage = await openAccount(other);
  const readerPage = await openAccount(reader);
  await waitUntil(() => notices.filter(item => item.account === reader).length === 2);
  assert.deepEqual(notices.filter(item => item.account === reader).map(({ id, shown }) => [id, shown]), [["shot-1", true], ["shot-2", false]]);
  await readerPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  await waitUntil(() => notices.some(item => item.account === reader && item.id === "shot-2" && item.shown));
  assert.ok(loads.some(({ account, payload }) => account === reader && payload.action === "load-construction-photo-notifications" && payload.after === 1));
  await otherPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  assert.equal(loads.some(({ account, payload }) => account === other && payload.action === "load-construction-photo-notifications"), false, "manager workflow privileges do not opt in automatically");

  const shown = notices.filter(item => item.account === reader && item.shown);
  assert.equal(shown.length, 2);
  assert.match(shown[0].body, /QA-CT[\s\S]*Nhân lực chụp ảnh[\s\S]*Anh-1.jpg/);
  await readerPage.reload();
  await waitUntil(() => loads.some(({ account, payload }) => account === reader && payload.action === "load-construction-photo-notifications" && payload.after === 2));
  assert.equal(notices.filter(item => item.account === reader && item.shown).length, 2, "reload does not repeat delivered events");
  await readerPage.goto(shown[0].url);
  await readerPage.getByRole("region", { name: "Ảnh thi công", exact: true }).waitFor();
  await waitUntil(() => loads.some(({ account, payload }) => account === reader && payload.action === "list-construction-photos" && payload.year === 2025 && payload.month === 3));
  assert.equal(loads.some(({ account, payload }) => account === reader && payload.action === "list-construction-photos" && payload.year === 2026), false, "notification opens the historical photo album rather than the current duplicate");

  const limitedPage = await openAccount(notifyOnly);
  await waitUntil(() => notices.some(item => item.account === notifyOnly && item.shown));
  await limitedPage.goto(notices.find(item => item.account === notifyOnly).url);
  await limitedPage.getByText("Có ảnh thi công mới. Tài khoản này nhận thông báo nhưng chưa có quyền Thi công để xem ảnh trong hồ sơ.").waitFor();
  assert.equal(loads.some(({ account, payload }) => account === notifyOnly && payload.action === "list-construction-photos"), false, "photo subscription does not grant photo access");

  await openAccount(reader, "web");
  await waitUntil(() => notices.filter(item => item.mode === "web" && item.shown).length === 2);
  const webNotice = notices.find(item => item.mode === "web" && item.id === "shot-1");
  assert.match(webNotice.tag, /reader@example\.com-shot-1$/);
  assert.equal(new URL(webNotice.url).searchParams.get("gmcrmYear"), "2025");
  assert.deepEqual(errors, []);
  console.log("Construction notifications: permission save/reload, desktop/web opt-in delivery, failed-delivery retry, deduplication, and safe exact-project links passed.");
} finally {
  await browser.close();
}
