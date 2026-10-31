import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';

// Native methods, version channel and Google calls are isolated fixtures.
// No installer is launched and no actual Windows settings/data are changed.
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

async function fixture({ mode = 'legacy', version = '1.1.0', manifest = release('1.2.0'), notifications = false, query = '' } = {}) {
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
    const qa = window.qaUpdates = { downloads: [], nativeDownloads: 0, notifications: [], infoCalls: 0, failInfo: false, failDownload: false, holdInfo: false, pendingInfo: null };
    window.open = url => { qa.downloads.push(url); return null; };
    if (mode === 'web') return;
    window.gmDesktop = {
      isDesktop: true, isWindows: mode !== 'mac', platform: mode === 'mac' ? 'darwin' : 'win32',
      showNotification: async payload => { qa.notifications.push(payload); return true; },
      ...(mode === 'legacy-startup' ? { getStartupSettings: async () => ({ supported: true, canChange: true, openAtLogin: false }), setStartupSettings: async () => ({ supported: true, canChange: true, openAtLogin: false }) } : {}),
      ...(['legacy', 'legacy-startup'].includes(mode) ? {} : {
        getAppInfo: async () => {
          qa.infoCalls += 1;
          if (qa.failInfo) throw new Error('synthetic native connection failure');
          if (qa.holdInfo) await new Promise(resolve => { qa.pendingInfo = resolve; });
          return { version, platform: mode === 'mac' ? 'darwin' : 'win32', isPackaged: mode !== 'dev' };
        },
        downloadUpdate: async () => { qa.nativeDownloads += 1; return qa.failDownload ? { ok: false, error: 'Chưa mở được bộ cài kiểm thử.' } : { ok: true }; },
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
  return Object.assign(fixture, { context, page, banner: page.getByRole('status', { name: 'Có bản cập nhật PC', exact: true }), button: page.locator('.pwa-action--desktop-update') });
}

try {
  const old = await fixture({ notifications: true });
  await old.banner.waitFor();
  assert.ok((await old.banner.innerText()).includes('1.2.0'));
  assert.equal(await old.page.getByRole('button', { name: '⚙ Thiết lập', exact: true }).count(), 0, 'ordinary employees receive PC updates');
  await old.page.waitForFunction(() => qaUpdates.notifications.length === 1);
  assert.equal(await old.page.evaluate(() => qaUpdates.notifications[0].url), old.page.url(), 'notification click focuses the current workspace without discarding a draft');
  await old.page.screenshot({ path: 'outputs/interface-qa/desktop-update-legacy.png', fullPage: true });
  assert.ok(old.manifestRequests >= 1, 'legacy runtimes check the published native channel immediately');
  await old.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await old.page.waitForFunction(() => document.querySelector('.pwa-action--desktop-update') !== null);
  assert.equal(await old.page.evaluate(() => qaUpdates.notifications.length), 1, 'one OS notification per release');
  await old.banner.getByRole('button', { name: 'Tải bản PC 1.2.0', exact: true }).click();
  assert.deepEqual(await old.page.evaluate(() => qaUpdates.downloads), [release('1.2.0').installerUrl]);
  await old.banner.getByRole('button', { name: 'Để sau', exact: true }).click();
  assert.equal(await old.banner.count(), 0);
  assert.equal(await old.button.count(), 1, 'dismissing the banner retains the header download action');
  await old.page.reload();
  await old.button.waitFor();
  assert.equal(await old.banner.count(), 0, 'dismissal persists for the same version');
  assert.equal(await old.page.evaluate(() => qaUpdates.notifications.length), 0, 'reload does not repeat the acknowledged update alert');
  old.manifest = release('1.3.0');
  await old.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await old.banner.getByRole('button', { name: 'Tải bản PC 1.3.0', exact: true }).waitFor();
  await old.page.waitForFunction(() => qaUpdates.notifications.length === 1);
  old.offline = true;
  await old.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert.equal(await old.button.count(), 1, 'offline checks retain the last verified offer');
  await old.page.screenshot({ path: 'outputs/interface-qa/desktop-update-next.png', fullPage: true });
  await old.context.close();

  const legacyStartup = await fixture({ mode: 'legacy-startup' });
  await legacyStartup.button.waitFor();
  assert.equal(await legacyStartup.page.locator('.pwa-action--startup').count(), 1, 'the 1.1 startup-capable runtime also receives native update offers');
  await legacyStartup.context.close();

  const current = await fixture({ mode: 'current', version: '1.2.0' });
  await current.page.waitForFunction(() => qaUpdates.infoCalls > 0);
  await current.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await current.button.count(), 0, 'the installed current native release has no persistent update banner');
  assert.equal(await current.page.evaluate(() => qaUpdates.notifications.length), 0);
  await current.context.close();

  const native = await fixture({ mode: 'current', version: '1.2.0', manifest: release('1.3.0') });
  await native.banner.waitFor();
  assert.ok((await native.banner.innerText()).includes('Máy này đang dùng bản 1.2.0'));
  assert.equal(await native.page.evaluate(() => qaUpdates.notifications.length), 0, 'native update alerts respect disabled notification preferences');
  await native.button.click();
  assert.equal(await native.page.evaluate(() => qaUpdates.nativeDownloads), 1);
  assert.equal(await native.page.evaluate(() => qaUpdates.downloads.length), 0, 'new runtimes use the validated native download route');
  await native.page.evaluate(() => { qaUpdates.failDownload = true; });
  await native.button.click();
  await native.page.locator('.toast').filter({ hasText: 'Chưa mở được bộ cài kiểm thử.' }).waitFor();
  await native.context.close();

  const numeric = await fixture({ mode: 'current', version: '1.9.0', manifest: release('1.10.0') });
  await numeric.button.getByText('Cập nhật PC 1.10.0', { exact: false }).waitFor();
  await numeric.context.close();

  for (const configuration of [
    { mode: 'web' }, { mode: 'mac' }, { mode: 'dev' },
    { mode: 'current', version: '2.0.0' },
    { manifest: { available: false } },
    { manifest: { ...release('1.2.0'), installerUrl: 'https://evil.example/installer.exe' } },
    { manifest: { ...release('1.2.0'), version: '01.2.0' } },
    { manifest: { ...release('1.2.0'), sha256: 'invalid' } },
    { manifest: { ...release('1.2.0'), installerUrl: release('1.2.0').installerUrl + '?redirect=evil' } },
  ]) {
    const other = await fixture(configuration);
    await other.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await other.button.count(), 0, `no unsafe or unnecessary offer ${JSON.stringify(configuration)}`);
    assert.equal(await other.page.evaluate(() => qaUpdates.downloads.length + qaUpdates.nativeDownloads), 0);
    if (configuration.mode === 'web' || configuration.mode === 'mac') assert.equal(other.manifestRequests, 0);
    await other.context.close();
  }
  const portal = await fixture({ query: '?view=customer&share=qa-update' });
  assert.equal(await portal.button.count(), 0);
  assert.equal(portal.manifestRequests, 0, 'customer pages do not request or display employee PC updates');
  await portal.context.close();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, legacyNativeUpgradesVisible: true, currentVersionHidden: true, newVersionRestoresDismissedBanner: true, notificationOncePerVersion: true, notificationsRespectPreference: true, untrustedInstallerRejected: true, manualDownloadOnly: true, webMacCustomerHidden: true, actualInstallerExecuted: false, errors }));
} catch (error) {
  if (qaPage && !qaPage.isClosed()) {
    console.error(JSON.stringify({ text: (await qaPage.locator('body').innerText()).slice(-5000), state: await qaPage.evaluate(() => window.qaUpdates ? ({ downloads: qaUpdates.downloads, nativeDownloads: qaUpdates.nativeDownloads, infoCalls: qaUpdates.infoCalls, notifications: qaUpdates.notifications }) : null) }));
    await qaPage.screenshot({ path: 'outputs/interface-qa/desktop-updates-failed.png', fullPage: true });
  }
  throw error;
} finally { await browser.close(); }
