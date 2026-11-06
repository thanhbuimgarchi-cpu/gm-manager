import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';

// Native installation, releases and Google data are isolated fixtures.
// No installer is executed and no real Windows settings are changed.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.GM_TEST_PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const scriptUrl = source.match(/scriptUrl:\s*"(https:\/\/script\.google\.com\/[^\"]+)"/)[1];
const baseUrl = process.env.GM_TEST_BASE_URL || 'http://127.0.0.1:5173/gm-manager/';
const browser = await chromium.launch({ headless: true, ...(process.env.GM_TEST_BROWSER_PATH ? { executablePath: process.env.GM_TEST_BROWSER_PATH } : {}) });
const errors = [];
let qaPage;
await mkdir('outputs/interface-qa', { recursive: true });
const release = version => ({ version, installerUrl: `https://github.com/thanhbuimgarchi-cpu/gm-manager/releases/download/desktop-latest/GM-CRM-Setup-${version}.exe`, sha256: 'a'.repeat(64), size: 111000000 });

async function fixture({ mode = 'integrated', version = '1.3.0', manifest = release('1.4.0'), notifications = false, query = '' } = {}) {
  const fixture = { manifest, offline: false, manifestRequests: 0 };
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  context.setDefaultTimeout(7000);
  await context.addInitScript(({ mode, version, notifications, scriptUrl }) => {
    const member = { id: 'staff', name: 'Nhân viên kiểm thử', email: 'staff@example.com', role: 'Nhân viên văn phòng', permissions: ['Ghi chú'], status: 'Có' };
    localStorage.setItem('gm-manager-personnel-v1', JSON.stringify({ office: [member] }));
    localStorage.setItem('gm-manager-personnel-session-email', member.email);
    localStorage.setItem('gm-manager-notifications-enabled-v1', notifications ? 'enabled' : 'disabled');
    const claims = { version: 2, purpose: 'workflow', account: member.email, nonce: 'qa-update', expiresAt: Date.parse('2030-01-01T00:00:00Z') };
    const token = `${btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.fixture-signature`;
    localStorage.setItem('gm-manager-workflow-session-v1', JSON.stringify({ scriptUrl, account: member.email, token }));
    const qa = window.qaUpdates = { downloads: [], nativeDownloads: 0, installCalls: 0, beforeInstallCalls: 0, notifications: [], infoCalls: 0, failInfo: false, failDownload: false, failInstall: false, currentAtInstall: false, holdInfo: false, pendingInfo: null, holdInstall: false, pendingInstall: null, progress: { phase: 'idle' }, progressListeners: new Set(), prepareListeners: new Set() };
    qa.emit = progress => { qa.progress = progress; for (const listener of qa.progressListeners) listener(progress); };
    window.open = url => { qa.downloads.push(url); return null; };
    if (mode === 'web') return;
    window.gmDesktop = {
      ...(mode === 'legacy-first' ? {} : { isDesktop: true, platform: mode === 'mac' ? 'darwin' : 'win32' }), isWindows: mode !== 'mac',
      showNotification: async payload => { qa.notifications.push(payload); return true; },
      ...(mode === 'legacy-startup' ? { getStartupSettings: async () => ({ supported: true, canChange: true, openAtLogin: false }), setStartupSettings: async () => ({ supported: true, canChange: true, openAtLogin: false }) } : {}),
      ...(['legacy-first', 'legacy', 'legacy-startup'].includes(mode) ? {} : {
        getAppInfo: async () => {
          qa.infoCalls += 1;
          if (qa.failInfo) throw new Error('synthetic native connection failure');
          if (qa.holdInfo) await new Promise(resolve => { qa.pendingInfo = resolve; });
          return { version, platform: mode === 'mac' ? 'darwin' : 'win32', isPackaged: mode !== 'dev', integratedUpdates: mode === 'integrated' };
        },
        downloadUpdate: async () => { qa.nativeDownloads += 1; return qa.failDownload ? { ok: false, error: 'Chưa mở được bộ cài kiểm thử.' } : { ok: true }; },
      }),
      ...(mode !== 'integrated' ? {} : {
        installUpdate: async () => {
          qa.installCalls += 1;
          if (qa.currentAtInstall) return { ok: true, current: true, version };
          qa.emit({ phase: 'downloading', percent: 5 });
          if (qa.holdInstall) await new Promise(resolve => { qa.pendingInstall = resolve; });
          if (qa.failInstall) { qa.emit({ phase: 'error', error: 'Bộ cài kiểm thử không khớp checksum.' }); return { ok: false, error: 'Bộ cài kiểm thử không khớp checksum.' }; }
          qa.emit({ phase: 'ready' });
          try { for (const listener of qa.prepareListeners) { qa.beforeInstallCalls += 1; await listener(); } }
          catch (error) { return { ok: false, error: error.message }; }
          qa.emit({ phase: 'installing' });
          return { ok: true };
        },
        getUpdateState: async () => qa.progress,
        onUpdateProgress: listener => { qa.progressListeners.add(listener); return () => qa.progressListeners.delete(listener); },
        onBeforeUpdate: listener => { qa.prepareListeners.add(listener); return () => qa.prepareListeners.delete(listener); },
      }),
    };
  }, { mode, version, notifications, scriptUrl });
  await context.route('**/desktop-version.json*', route => {
    fixture.manifestRequests += 1;
    return fixture.offline ? route.abort('failed') : route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture.manifest) });
  });
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
  await page.waitForTimeout(100);
  return Object.assign(fixture, { context, page, banner: page.getByRole('status', { name: 'Có bản cập nhật PC', exact: true }), button: page.locator('.pwa-action--desktop-update') });
}

const failStorage = page => page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key === 'gm-manager-consulting') throw new Error('synthetic full storage'); return original.call(this, key, value); }; });

try {
  const native = await fixture({ notifications: true });
  await native.banner.waitFor();
  assert.equal(await native.button.count(), 1, 'Windows has exactly one update action');
  assert.equal(await native.button.innerText(), 'Cập nhật');
  assert.equal(await native.banner.getByRole('button').count(), 1, 'the banner only contains dismissal, not another download button');
  assert.equal(await native.page.locator('.pwa-action--check-desktop-update').count(), 0);
  await native.page.waitForFunction(() => qaUpdates.notifications.length === 1);
  assert.equal(await native.page.evaluate(() => qaUpdates.notifications[0].url), native.page.url());
  assert.equal(await native.page.evaluate(() => qaUpdates.installCalls), 0, 'background checks never install');
  await native.banner.getByRole('button', { name: 'Để sau', exact: true }).click();
  await native.page.reload();
  await native.button.waitFor();
  assert.equal(await native.banner.count(), 0, 'dismissal survives reload');
  assert.equal(await native.page.evaluate(() => qaUpdates.notifications.length), 0);
  await native.page.evaluate(() => { qaUpdates.holdInstall = true; });
  await native.button.click();
  await native.page.waitForFunction(() => qaUpdates.installCalls === 1 && qaUpdates.pendingInstall !== null);
  assert.equal(await native.button.innerText(), 'Đang tải 5%');
  assert.equal(await native.button.isDisabled(), true);
  await native.page.evaluate(() => document.querySelector('.pwa-action--desktop-update').click());
  assert.equal(await native.page.evaluate(() => qaUpdates.installCalls), 1, 'double clicks do not start another download');
  assert.equal(await native.page.evaluate(() => qaUpdates.downloads.length + qaUpdates.nativeDownloads), 0, 'integrated updates stay inside the application');
  await native.page.evaluate(() => qaUpdates.emit({ phase: 'downloading', percent: 63 }));
  await native.button.getByText('Đang tải 63%', { exact: true }).waitFor();
  await native.page.screenshot({ path: 'outputs/interface-qa/desktop-update-in-app.png', fullPage: true });
  await native.page.evaluate(() => qaUpdates.emit({ phase: 'verifying' }));
  await native.button.getByText('Đang kiểm tra bản cập nhật…', { exact: true }).waitFor();
  await native.page.evaluate(() => { qaUpdates.holdInstall = false; qaUpdates.pendingInstall(); });
  await native.button.getByText('Đang khởi động lại…', { exact: true }).waitFor();
  assert.equal(await native.button.isDisabled(), true);
  assert.equal(await native.page.locator('.crm-shell').evaluate(shell => shell.inert), true, 'editing stops after final save while the installer is taking over');
  assert.ok(await native.page.evaluate(() => qaUpdates.beforeInstallCalls) >= 1, 'latest drafts are saved before handoff');
  await native.context.close();

  const failed = await fixture();
  await failed.page.evaluate(() => { qaUpdates.failInstall = true; });
  await failed.button.click();
  await failed.page.locator('.toast').filter({ hasText: 'Bộ cài kiểm thử không khớp checksum.' }).waitFor();
  assert.equal(await failed.button.isEnabled(), true, 'failed verification keeps the app open and allows retry');
  await failed.page.evaluate(() => { qaUpdates.failInstall = false; });
  await failed.button.click();
  await failed.button.getByText('Đang khởi động lại…', { exact: true }).waitFor();
  assert.equal(await failed.page.evaluate(() => qaUpdates.installCalls), 2);
  await failed.context.close();

  const storage = await fixture();
  await failStorage(storage.page);
  await storage.button.click();
  await storage.page.locator('.toast').filter({ hasText: 'Không lưu được dữ liệu trên máy.' }).waitFor();
  assert.equal(await storage.page.evaluate(() => qaUpdates.installCalls), 0, 'unsafe preparation prevents any download');
  assert.equal(await storage.button.isEnabled(), true);
  await storage.context.close();

  const finalPreparation = await fixture();
  await finalPreparation.page.evaluate(() => { qaUpdates.holdInstall = true; });
  await finalPreparation.button.click();
  await finalPreparation.page.waitForFunction(() => qaUpdates.pendingInstall !== null);
  await failStorage(finalPreparation.page);
  await finalPreparation.page.evaluate(() => qaUpdates.pendingInstall());
  await finalPreparation.page.locator('.toast').filter({ hasText: 'Không lưu được dữ liệu trên máy.' }).waitFor();
  assert.equal(await finalPreparation.button.isEnabled(), true, 'failed final save prevents restart after download');
  assert.equal(await finalPreparation.page.locator('.crm-shell').evaluate(shell => shell.inert), false, 'failed installation leaves editing available');
  await finalPreparation.context.close();

  const changedChannel = await fixture();
  await changedChannel.page.evaluate(() => { qaUpdates.currentAtInstall = true; });
  await changedChannel.button.click();
  await changedChannel.page.locator('.toast').filter({ hasText: 'GM Manager PC 1.3.0 đang là bản mới nhất.' }).waitFor();
  assert.equal(await changedChannel.button.innerText(), 'Cập nhật');
  assert.equal(await changedChannel.button.isEnabled(), true, 'a native current response cannot leave a false restarting state');
  assert.equal(await changedChannel.banner.count(), 0);
  await changedChannel.context.close();

  const current = await fixture({ manifest: release('1.3.0') });
  assert.equal(await current.banner.count(), 0);
  await current.button.click();
  await current.page.locator('.toast').filter({ hasText: 'GM Manager PC 1.3.0 đang là bản mới nhất.' }).waitFor();
  assert.equal(await current.page.evaluate(() => qaUpdates.installCalls), 0);
  const before = await current.page.evaluate(() => { qaUpdates.holdInfo = true; window.dispatchEvent(new Event('focus')); return qaUpdates.infoCalls; });
  await current.page.waitForFunction(() => qaUpdates.pendingInfo !== null);
  await current.button.click();
  await current.button.getByText('Đang kiểm tra cập nhật…', { exact: true }).waitFor();
  assert.equal(await current.page.evaluate(() => qaUpdates.infoCalls), before, 'automatic and explicit checks share one request');
  await current.page.evaluate(() => { qaUpdates.holdInfo = false; qaUpdates.pendingInfo(); qaUpdates.pendingInfo = null; });
  await current.button.getByText('Cập nhật', { exact: true }).waitFor();
  await current.context.setOffline(true);
  await current.button.click();
  await current.page.locator('.toast').filter({ hasText: 'Máy đang ngoại tuyến.' }).waitFor();
  assert.equal(await current.button.isEnabled(), true);
  await current.context.close();

  for (const mode of ['legacy-first', 'legacy', 'legacy-startup', 'old-native']) {
    const old = await fixture({ mode, version: '1.2.1', manifest: release('1.3.0') });
    await old.banner.waitFor();
    assert.equal(await old.button.count(), 1);
    assert.ok((await old.banner.innerText()).includes('cài nâng cấp một lần'));
    await old.button.click();
    await old.page.locator('.toast').filter({ hasText: 'cần cài nâng cấp một lần để hỗ trợ cập nhật tự động' }).waitFor();
    assert.equal(await old.page.evaluate(() => qaUpdates.installCalls), 0);
    if (mode === 'old-native') assert.equal(await old.page.evaluate(() => qaUpdates.nativeDownloads), 1);
    else assert.deepEqual(await old.page.evaluate(() => qaUpdates.downloads), [release('1.3.0').installerUrl]);
    await old.context.close();
  }
  for (const manifest of [{ available: false }, { ...release('1.4.0'), installerUrl: 'https://evil.example/setup.exe' }, { ...release('1.4.0'), sha256: 'invalid' }]) {
    const bad = await fixture({ manifest });
    assert.equal(await bad.banner.count(), 0);
    await bad.button.click();
    await bad.page.locator('.toast').filter({ hasText: manifest.available === false ? 'Chưa có bản cập nhật mới sẵn sàng.' : 'Chưa kiểm tra được cập nhật.' }).waitFor();
    assert.equal(await bad.page.evaluate(() => qaUpdates.installCalls + qaUpdates.downloads.length + qaUpdates.nativeDownloads), 0);
    await bad.context.close();
  }
  const numeric = await fixture({ version: '1.9.0', manifest: release('1.10.0') });
  await numeric.banner.waitFor();
  assert.equal(await numeric.button.getAttribute('title'), 'Cập nhật lên PC 1.10.0');
  await numeric.context.close();
  for (const mode of ['web', 'mac', 'dev']) {
    const other = await fixture({ mode });
    assert.equal(await other.button.count(), 0);
    assert.equal(await other.banner.count(), 0);
    if (mode !== 'dev') assert.equal(other.manifestRequests, 0);
    await other.context.close();
  }
  const portal = await fixture({ query: '?view=customer&share=qa-update' });
  assert.equal(await portal.button.count(), 0);
  assert.equal(portal.manifestRequests, 0);
  await portal.context.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, exactlyOneUpdateButton: true, integratedDownloadProgress: true, noExternalBrowser: true, automaticInstallOnlyOnClick: true, prepareBeforeInstall: true, failedVerificationRetriable: true, legacyBootstrapExplicit: true, currentOfflineAndUntrustedHandled: true, actualInstallerExecuted: false, errors }));
} catch (error) {
  if (qaPage && !qaPage.isClosed()) {
    console.error(JSON.stringify({ text: (await qaPage.locator('body').innerText()).slice(-5000), state: await qaPage.evaluate(() => window.qaUpdates ? ({ downloads: qaUpdates.downloads, nativeDownloads: qaUpdates.nativeDownloads, installCalls: qaUpdates.installCalls, infoCalls: qaUpdates.infoCalls, progress: qaUpdates.progress }) : null) }));
    await qaPage.screenshot({ path: 'outputs/interface-qa/desktop-updates-failed.png', fullPage: true });
  }
  throw error;
} finally { await browser.close(); }
