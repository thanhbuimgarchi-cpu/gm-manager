import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

// Exercise the real built UI in WebKit. OS permissions and Apps Script are
// simulated; this never changes a real roster or displays a system notification.
const require = createRequire(import.meta.url);
const { webkit } = require(process.env.GM_TEST_PLAYWRIGHT_MODULE || "playwright");
const baseUrl = process.env.GM_TEST_BASE_URL || "http://127.0.0.1:5191/gm-manager/";
const browser = await webkit.launch({ headless: true });
const errors = [];
const personnel = { office: [{ id: "ios-member", name: "Nguyễn Minh Anh", loginCode: "00123", email: "anh@example.com", status: "Có", role: "Nhân viên thiết kế", permissions: ["Ghi chú", "Tư vấn", "Thiết kế", "Tài liệu"] }] };
const year = 2026;
const month = 10;
const years = [{ year, months: Array.from({ length: 12 }, (_, index) => ({ label: `T${index + 1}`, records: [] })) }];

async function fixture({ version = "16_4", standalone = true, permission = "default", supported = true, ipad = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    userAgent: ipad ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/26.0 Safari/605.1.15" : `Mozilla/5.0 (iPhone; CPU iPhone OS ${version} like Mac OS X) AppleWebKit/605.1.15 Version/${version.replace("_", ".")} Mobile/15E148 Safari/604.1`,
    serviceWorkers: "block",
  });
  await context.addInitScript(({ standalone, permission, supported, ipad, personnel, years }) => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: standalone });
    Object.defineProperty(navigator, "platform", { configurable: true, value: ipad ? "MacIntel" : "iPhone" });
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 5 });
    window.iosQA = { permission: sessionStorage.getItem("ios-qa-permission") || permission, requests: 0, shown: [], userActivation: [] };
    if (supported) Object.defineProperty(window, "Notification", { configurable: true, value: {
      get permission() { return window.iosQA.permission; },
      requestPermission() { window.iosQA.requests++; window.iosQA.userActivation.push(navigator.userActivation?.isActive); window.iosQA.permission = "granted"; sessionStorage.setItem("ios-qa-permission", "granted"); return Promise.resolve("granted"); },
    } });
    else delete window.Notification;
    const registration = { active: {}, async update() {}, addEventListener() {}, async showNotification(title, options) { window.iosQA.shown.push({ title, options }); } };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { async register() { return registration; }, ready: Promise.resolve(registration), addEventListener() {} } });
    if (!localStorage.getItem("ios-qa-seeded")) {
      localStorage.setItem("ios-qa-seeded", "1");
      localStorage.setItem("gm-manager-consulting", JSON.stringify(years));
      localStorage.setItem("gm-manager-personnel-v1", JSON.stringify(personnel));
    }
  }, { standalone, permission, supported, ipad, personnel, years });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseUrl).origin) return route.continue();
    if (url.hostname !== "script.google.com") return route.abort();
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<meta charset="utf-8"><script>
      const years=${JSON.stringify(years)},personnel=${JSON.stringify(personnel)};
      addEventListener('message',event=>{if(event.data?.channel!=='gm-manager-apps-script')return;
        const {id,payload:p}=event.data,r={ok:true};
        if(p.action==='load-consulting'||p.action==='load-workspace-cache')r.years=years;
        if(p.action==='load-personnel')r.personnel=personnel;
        if(p.action==='load-assigned-work-notes')r.notes=[];
        if(p.action==='load-assigned-design-tasks')r.tasks=[];
        if(p.action==='load-customer-messages'){r.messages=[];r.configured=true;}
        event.source.postMessage({channel:'gm-manager-apps-script-response',id,result:r},'*');
      });parent.postMessage({channel:'gm-manager-apps-script-ready'},'*');<\/script>` });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-10-28T02:00:00Z"));
  await page.goto(baseUrl);
  await page.locator(".customer-gateway__actions .pwa-action--login").waitFor();
  return { context, page, notificationButton: () => page.locator(".customer-gateway__actions").getByRole("button", { name: /Bật thông báo|Thông báo đã bật/ }) };
}

try {
  await mkdir("outputs/ios-qa", { recursive: true });
  const safari = await fixture({ version: "16_0", standalone: false, supported: false });
  for (const width of [320, 375, 390, 430, 600, 768, 844, 1024]) {
    await safari.page.setViewportSize({ width, height: 844 });
    const login = safari.page.locator(".customer-gateway__actions .pwa-action--login");
    await login.click({ trial: true });
    const brand = await safari.page.locator(".customer-gateway__brand").boundingBox();
    const button = await login.boundingBox();
    assert.ok(brand.x + brand.width <= button.x || button.x + button.width <= brand.x || brand.y + brand.height <= button.y || button.y + button.height <= brand.y, `logo overlaps login at ${width}px`);
    assert.ok(await safari.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${width}px`);
  }
  await safari.page.setViewportSize({ width: 390, height: 844 });
  await safari.page.screenshot({ path: "outputs/ios-qa/header.png" });
  await safari.page.locator(".pwa-action--login").click();
  const loginDialog = safari.page.getByRole("dialog", { name: "Đăng nhập", exact: true });
  assert.equal(await loginDialog.getByLabel("Vị trí GM Manager", { exact: true }).count(), 0);
  await loginDialog.getByLabel("Tên nhân viên", { exact: true }).fill("Nguyễn Minh Anh");
  await loginDialog.getByLabel("Mã đăng nhập", { exact: true }).fill("00123");
  assert.equal(await loginDialog.getByLabel("Tên nhân viên", { exact: true }).evaluate((input) => getComputedStyle(input).fontSize), "16px");
  await safari.page.setViewportSize({ width: 390, height: 420 });
  await loginDialog.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await safari.page.waitForFunction(() => !document.querySelector(".login-dialog"));
  await safari.page.setViewportSize({ width: 390, height: 844 });
  await safari.notificationButton().click();
  await safari.page.getByRole("dialog", { name: "Cài GM-CRM" }).waitFor();
  assert.ok((await safari.page.locator(".install-help-dialog").innerText()).includes("16.4"));
  assert.equal(await safari.page.evaluate(() => window.iosQA.requests), 0);
  await safari.context.close();

  const oldIOS = await fixture({ version: "16_0", supported: false });
  await oldIOS.notificationButton().click();
  await oldIOS.page.getByRole("dialog", { name: "Bật thông báo?", exact: true }).waitFor();
  assert.ok((await oldIOS.page.locator(".notification-setup-dialog").innerText()).includes("16.0–16.3"));
  assert.equal(await oldIOS.page.locator(".pwa-action--notifications-enabled").count(), 0);
  await oldIOS.context.close();

  for (const version of ["16_4", "18_6"]) {
    const app = await fixture({ version });
    await app.notificationButton().click();
    await app.page.locator(".pwa-action--notifications-enabled").waitFor();
    const result = await app.page.evaluate(() => ({ ...window.iosQA, saved: localStorage.getItem("gm-manager-notifications-enabled-v1") }));
    assert.equal(result.requests, 1);
    assert.equal(result.shown.length, 1);
    assert.equal(result.saved, "enabled");
    assert.deepEqual(result.userActivation, [true]);
    await app.page.reload();
    await app.page.locator(".pwa-action--notifications-enabled").waitFor();
    await app.context.close();
  }

  const denied = await fixture({ permission: "denied", ipad: true });
  await denied.notificationButton().click();
  await denied.page.getByRole("heading", { name: "Cho phép thông báo", exact: true }).waitFor();
  assert.equal(await denied.page.evaluate(() => window.iosQA.requests), 0);
  await denied.page.evaluate(() => { window.iosQA.permission = "granted"; window.dispatchEvent(new Event("focus")); });
  await denied.page.locator(".pwa-action--notifications-enabled").waitFor();
  await denied.page.getByRole("button", { name: "Bật thông báo", exact: true }).click();
  await denied.page.waitForFunction(() => window.iosQA.shown.length === 1);
  await denied.context.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, engine: "WebKit", widths: [320, 375, 390, 430, 600, 768, 844, 1024], ios16Login: true, homeScreenPermission: true, unsupportedIOS: true, deniedPermission: true, persistedPermission: true, errors }));
} finally {
  await browser.close();
}
