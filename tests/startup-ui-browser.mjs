import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';

// All native/Google calls use synthetic fixtures. This suite never changes
// the real Windows startup registry, launches GM Manager, or contacts Drive.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.GM_TEST_PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const scriptUrl = source.match(/scriptUrl:\s*"(https:\/\/script\.google\.com\/[^\"]+)"/)[1];
const baseUrl = process.env.GM_TEST_BASE_URL || 'http://127.0.0.1:5173/gm-manager/';
const browser = await chromium.launch({ headless: true, ...(process.env.GM_TEST_BROWSER_PATH ? { executablePath: process.env.GM_TEST_BROWSER_PATH } : {}) });
const errors = [];
let qaPage;
await mkdir('outputs/interface-qa', { recursive: true });

async function fixture(mode = 'windows', query = '') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  context.setDefaultTimeout(8000);
  await context.addInitScript(({ mode, scriptUrl }) => {
    const member = { id: 'staff', name: 'Nhân viên kiểm thử', email: 'staff@example.com', role: 'Nhân viên văn phòng', permissions: ['Ghi chú'], status: 'Có' };
    localStorage.setItem('gm-manager-personnel-v1', JSON.stringify({ office: [member] }));
    localStorage.setItem('gm-manager-personnel-session-email', member.email);
    const claims = { version: 2, purpose: 'workflow', account: member.email, nonce: 'qa-startup', expiresAt: Date.parse('2030-01-01T00:00:00Z') };
    const token = `${btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.fixture-signature`;
    localStorage.setItem('gm-manager-workflow-session-v1', JSON.stringify({ scriptUrl, account: member.email, token }));
    const qa = window.qaStartup = { getCalls: 0, setCalls: [], listeners: new Set(), holdRead: false, holdWrite: false, failWrite: false, pendingRead: null, pendingWrite: null };
    const state = () => ({ supported: true, canChange: true, openAtLogin: localStorage.getItem('qa-native-startup') === 'on' });
    qa.emit = (value) => { localStorage.setItem('qa-native-startup', value ? 'on' : 'off'); for (const listener of qa.listeners) listener(state()); };
    qa.resolveRead = () => { qa.pendingRead?.(); qa.pendingRead = null; };
    qa.resolveWrite = () => { qa.pendingWrite?.(); qa.pendingWrite = null; };
    if (mode === 'web') return;
    window.gmDesktop = {
      isDesktop: true, isWindows: mode !== 'mac', platform: mode === 'mac' ? 'darwin' : 'win32',
      showNotification: async () => true,
      ...(mode === 'old-windows' ? {} : {
        getStartupSettings: async () => {
          qa.getCalls += 1;
          const read = mode === 'unsupported' ? { supported: false, openAtLogin: false, canChange: false } : state();
          if (qa.holdRead) { qa.holdRead = false; await new Promise(resolve => { qa.pendingRead = resolve; }); }
          return read;
        },
        setStartupSettings: async ({ openAtLogin }) => {
          qa.setCalls.push({ openAtLogin });
          if (qa.holdWrite) { qa.holdWrite = false; await new Promise(resolve => { qa.pendingWrite = resolve; }); }
          if (qa.failWrite) return { ...state(), error: 'Windows từ chối lưu thiết lập kiểm thử.' };
          localStorage.setItem('qa-native-startup', openAtLogin ? 'on' : 'off');
          const result = state();
          for (const listener of qa.listeners) listener(result);
          return result;
        },
        onStartupChanged: (listener) => { qa.listeners.add(listener); return () => qa.listeners.delete(listener); },
      }),
    };
  }, { mode, scriptUrl });
  await context.route('https://script.google.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<meta charset="utf-8"><script>
const personnel={office:[{id:'staff',name:'Nhân viên kiểm thử',email:'staff@example.com',role:'Nhân viên văn phòng',permissions:['Ghi chú'],status:'Có'}]};
addEventListener('message',event=>{if(event.data?.channel!=='gm-manager-apps-script')return;const {id,payload:p}=event.data;let result={ok:true};
if(p.action==='load-personnel')result.personnel=personnel;
if(p.action==='load-consulting'||p.action==='load-workspace-cache')result.years=[];
if(p.action==='load-assigned-work-notes')result.notes=[];
if(p.action==='load-assigned-design-tasks')result.tasks=[];
if(p.action==='load-customer-messages'){result.messages=[];result.configured=true;}
if(p.action==='customer-portal-share')result={ok:false,error:'Hồ sơ kiểm thử không được phát hành.'};
event.source.postMessage({channel:'gm-manager-apps-script-response',id,result},'*');});parent.postMessage({channel:'gm-manager-apps-script-ready'},'*');<\/script>` }));
  const page = await context.newPage();
  qaPage = page;
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${baseUrl}${query}`);
  await page.locator('.crm-shell, .customer-portal').first().waitFor();
  return { context, page, button: page.locator('.pwa-action--startup') };
}

try {
  const { context, page, button } = await fixture();
  await button.getByText('Khởi động cùng Windows', { exact: false }).waitFor();
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.getByRole('button', { name: '⚙ Thiết lập', exact: true }).count(), 0, 'the per-device control does not depend on admin settings');
  assert.equal(await page.evaluate(() => qaStartup.setCalls.length), 0, 'reading startup state never enables it');

  await page.evaluate(() => { qaStartup.holdWrite = true; });
  await button.click();
  await button.getByText('Đang lưu khởi động…', { exact: false }).waitFor();
  assert.equal(await button.isDisabled(), true);
  assert.equal(await button.getAttribute('aria-pressed'), 'false', 'the control remains off until native acknowledgment');
  await page.evaluate(() => qaStartup.resolveWrite());
  await button.getByText('Đã bật cùng Windows', { exact: false }).waitFor();
  assert.equal(await button.getAttribute('aria-pressed'), 'true');
  assert.ok((await button.getAttribute('class')).includes('pwa-action--notifications-enabled'));
  await page.reload();
  await button.getByText('Đã bật cùng Windows', { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => qaStartup.setCalls.length), 0, 'restart restores native state without writing it again');

  await page.evaluate(() => qaStartup.emit(false));
  await button.getByText('Khởi động cùng Windows', { exact: false }).waitFor();
  await page.evaluate(() => { localStorage.setItem('qa-native-startup', 'on'); window.dispatchEvent(new Event('focus')); });
  await button.getByText('Đã bật cùng Windows', { exact: false }).waitFor();
  await button.click();
  await button.getByText('Khởi động cùng Windows', { exact: false }).waitFor();

  await page.evaluate(() => { qaStartup.holdRead = true; window.dispatchEvent(new Event('focus')); });
  await page.waitForFunction(() => Boolean(qaStartup.pendingRead));
  await button.click();
  await button.getByText('Đã bật cùng Windows', { exact: false }).waitFor();
  await page.evaluate(() => qaStartup.resolveRead());
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await button.getAttribute('aria-pressed'), 'true', 'a stale native read cannot undo an acknowledged toggle');
  await page.screenshot({ path: 'outputs/interface-qa/startup-windows-enabled.png', fullPage: true });

  await page.evaluate(() => { qaStartup.emit(false); qaStartup.failWrite = true; });
  await button.click();
  await page.locator('.toast').filter({ hasText: 'Windows từ chối lưu thiết lập kiểm thử.' }).waitFor();
  assert.equal(await button.getAttribute('aria-pressed'), 'false');
  assert.ok(!(await button.getAttribute('class')).includes('pwa-action--notifications-enabled'), 'failed writes cannot paint enabled green');
  await context.close();

  for (const mode of ['web', 'mac', 'old-windows', 'unsupported']) {
    const other = await fixture(mode);
    await other.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await other.button.count(), 0, `${mode} has no unsupported startup control`);
    assert.equal(await other.page.evaluate(() => qaStartup.setCalls.length), 0);
    await other.context.close();
  }
  const portal = await fixture('windows', '?view=customer&share=qa-startup');
  assert.equal(await portal.button.count(), 0);
  assert.equal(await portal.page.evaluate(() => qaStartup.getCalls), 0, 'customer pages do not even read per-device employee startup settings');
  await portal.context.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, ordinaryEmployeeCanToggle: true, nativeAckRequired: true, restoredAfterReload: true, trayAndFocusReconciled: true, staleReadIgnored: true, failedWritePreservesState: true, webMacOldDesktopCustomerHidden: true, actualWindowsSettingsChanged: false, errors }));
} catch (error) {
  if (qaPage && !qaPage.isClosed()) {
    console.error(JSON.stringify({ text: (await qaPage.locator('body').innerText()).slice(-2500), state: await qaPage.evaluate(() => window.qaStartup ? ({ getCalls: qaStartup.getCalls, setCalls: qaStartup.setCalls, fail: qaStartup.failWrite, native: localStorage.getItem('qa-native-startup') }) : null) }));
    await qaPage.screenshot({ path: 'outputs/interface-qa/startup-windows-failed.png', fullPage: true });
  }
  throw error;
} finally {
  await browser.close();
}
