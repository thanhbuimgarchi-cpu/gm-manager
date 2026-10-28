import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

// Mock the folder picker/native IPC and Apps Script. No actual disk, roster,
// customer, or notification is modified by this UI regression test.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.GM_TEST_PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.GM_TEST_BROWSER_PATH ? { executablePath: process.env.GM_TEST_BROWSER_PATH } : {}) });
const baseUrl = process.env.GM_TEST_BASE_URL || "http://127.0.0.1:5191/gm-manager/";
const deepPath = "I:\\Shared drives\\GM Manager\\GM Manager\\Khách hàng";
const canonicalPath = "I:\\Shared drives\\GM Manager\\GM Manager";
const roster = { office: [{ id: "path-test-member", name: "Nguyễn Minh Anh", email: "anh@example.com", loginCode: "00123", status: "Có", role: "Nhân viên thiết kế", permissions: ["Ghi chú", "Tư vấn", "Tài liệu"] }] };
const workflowToken = `${Buffer.from(JSON.stringify({ version: 2, purpose: "workflow", account: "anh@example.com", expiresAt: Date.now() + 31 * 86400000, nonce: "workspace-path-qa" })).toString("base64url")}.fixture-signature`;
const errors = [];

try {
  await mkdir("outputs/workspace-path-qa", { recursive: true });
  for (const native of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: "block" });
    await context.addInitScript(({ native, deepPath, canonicalPath, roster }) => {
      window.pathQA = { requested: [], pickerCalls: 0 };
      localStorage.setItem("gm-manager-personnel-v1", JSON.stringify(roster));
      // Fake handles contain functions and cannot be cloned into IndexedDB.
      // Verify the UI also works when optional handle persistence is unavailable.
      indexedDB.open = () => { throw new Error("Synthetic IndexedDB unavailable"); };
      if (native) window.gmDesktop = { isDesktop: true, isWindows: true,
        async showNotification() { return true; },
        async selectWorkspaceFolder() { return { ok: true, path: canonicalPath }; },
        validateWorkspaceFolder(payload) {
          if (!payload?.path) return new Promise((resolve) => { window.pathQA.finishRestore = resolve; });
          window.pathQA.requested.push(payload.path);
          return Promise.resolve(payload.path === deepPath || payload.path === canonicalPath ? { ok: true, path: canonicalPath } : { ok: false, path: "", error: "Chưa tìm thấy GM Manager tại đường dẫn này." });
        },
      };
      else {
        const directory = (name, children = {}) => ({ name, kind: "directory", async queryPermission() { return "granted"; }, async requestPermission() { return "granted"; }, async getDirectoryHandle(child) { if (!children[child]) throw new Error("not found"); return children[child]; }, async *values() { yield* Object.values(children); } });
        const root = directory("GM Manager", { "Khách hàng": directory("Khách hàng"), "Nhân lực": directory("Nhân lực") });
        const drive = directory("I", { "Shared drives": directory("Shared drives", { "GM Manager": directory("GM Manager", { "GM Manager": root }) }) });
        window.showDirectoryPicker = async () => { window.pathQA.pickerCalls++; return drive; };
      }
    }, { native, deepPath, canonicalPath, roster });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === new URL(baseUrl).origin) return route.continue();
      if (url.hostname !== "script.google.com") return route.abort();
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: `<meta charset="utf-8"><script>
        const personnel=${JSON.stringify(roster)};
        addEventListener('message',event=>{if(event.data?.channel!=='gm-manager-apps-script')return;const {id,payload:p}=event.data,r={ok:true};
          if(p.action==='load-personnel')r.personnel=personnel;
          if(p.action==='verify-employee-login'){
            const member=Object.values(personnel).flat().find(member=>member.name===p.name&&member.loginCode===p.loginCode);
            Object.assign(r,member?{valid:true,account:member.email,member,workflowSessionToken:${JSON.stringify(workflowToken)}}:{valid:false,error:'Tên nhân viên hoặc mã đăng nhập không đúng.'});
          }
          if(p.action==='load-workspace-cache'||p.action==='load-consulting')r.years=[];
          if(p.action==='load-assigned-work-notes')r.notes=[];
          if(p.action==='load-assigned-design-tasks')r.tasks=[];
          if(p.action==='load-customer-messages'){r.messages=[];r.configured=true;}
          event.source.postMessage({channel:'gm-manager-apps-script-response',id,result:r},'*');
        });parent.postMessage({channel:'gm-manager-apps-script-ready'},'*');<\/script>` });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseUrl);
    await page.locator(".customer-gateway__actions .pwa-action--login").click();
    const login = page.getByRole("dialog", { name: "Đăng nhập", exact: true });
    const location = login.getByLabel("Vị trí GM Manager", { exact: true });
    await location.fill(deepPath);
    if (native) {
      await page.waitForFunction(() => Boolean(window.pathQA.finishRestore));
      await page.evaluate(() => window.pathQA.finishRestore({ ok: true, path: "G:\\Old workspace" }));
      assert.equal(await location.inputValue(), deepPath, "a late saved-location read must not overwrite typing");
    } else {
      await login.getByRole("button", { name: "Chọn ổ / thư mục", exact: true }).click();
      await page.waitForFunction(() => localStorage.getItem("gm-manager-local-workspace-path-v1"));
      assert.equal(await location.inputValue(), deepPath);
      assert.equal(await page.evaluate(() => window.pathQA.pickerCalls), 1);
    }
    await login.getByLabel("Tên nhân viên", { exact: true }).fill("Nguyễn Minh Anh");
    await login.getByLabel("Mã đăng nhập", { exact: true }).fill("00123");
    await location.fill("I:\\Unrelated location");
    await login.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await login.getByRole("alert").waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem("gm-manager-personnel-session-email")), null);
    await location.fill(deepPath);
    await page.screenshot({ path: `outputs/workspace-path-qa/login-${native ? "native" : "browser"}.png` });
    await login.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".login-dialog"));
    assert.equal(await page.evaluate(() => localStorage.getItem("gm-manager-personnel-session-email")), "anh@example.com");
    const employeeSession = await page.evaluate(() => JSON.parse(localStorage.getItem("gm-manager-workflow-session-v1")));
    assert.equal(employeeSession.account, "anh@example.com");
    assert.equal(employeeSession.token, workflowToken, "folder validation is followed by server-verified employee authentication");
    if (native) assert.equal(await page.evaluate(() => window.pathQA.requested.at(-1)), deepPath);
    else assert.equal(await page.evaluate(() => localStorage.getItem("gm-manager-local-workspace-path-v1")), deepPath);
    await page.reload();
    await page.locator(".customer-gateway__actions .pwa-action--login").click();
    const restoredLocation = page.getByRole("dialog", { name: "Đăng nhập", exact: true }).getByLabel("Vị trí GM Manager", { exact: true });
    assert.equal(await restoredLocation.inputValue(), native ? canonicalPath : deepPath, "remember the validated location after reopening the app");
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, nativeTypedPath: true, drivePicker: true, rejectsUnrelatedPath: true, preservesTyping: true, errors }));
} finally {
  await browser.close();
}
