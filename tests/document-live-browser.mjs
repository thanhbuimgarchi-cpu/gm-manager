import { createRequire } from 'node:module';
import { mkdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

// Local preview only. Every Apps Script frame is intercepted and returns
// synthetic file metadata; no customer, Drive file or real message is changed.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.GM_TEST_PLAYWRIGHT_MODULE || 'playwright');
const source = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
const scriptUrl = source.match(/scriptUrl:\s*"(https:\/\/script\.google\.com\/[^\"]+)"/)[1];
const now = '2026-10-29T02:00:00.000Z';
const token = (purpose, version) => `${Buffer.from(JSON.stringify({ version, purpose, account: 'admin', expiresAt: Date.parse('2026-11-29T02:00:00Z'), nonce: 'documents-live-qa' })).toString('base64url')}.fixture-signature`;
const workflowToken = token('workflow', 2);
const adminToken = token('customer-admin', 1);
const records = [
  { id: 'live-doc-house', name: 'Khách kiểm thử tài liệu', houseId: 'QA-DOC', projectId: 'DOCUMENT-LIVE-QA', createdAt: '29/10/2026', isHydrated: true, progressHydrated: true, details: { HVT: 'Khách kiểm thử tài liệu' } },
  { id: 'live-doc-other', name: 'Khách kiểm thử B', houseId: 'QA-OTHER', projectId: 'DOCUMENT-LIVE-B', createdAt: '29/10/2026', isHydrated: true, progressHydrated: true, details: { HVT: 'Khách kiểm thử B' } },
];
const years = [{ year: 2026, months: Array.from({ length: 12 }, (_, index) => ({ label: `T${index + 1}`, records: index === 9 ? records : [] })) }];
const snapshots = [
  { id: 'day-latest', name: '29-10-2026-QA-DOC', date: '29/10/2026' },
  { id: 'day-old', name: '28-10-2026-QA-DOC', date: '28/10/2026' },
];
const file = (id, name, updatedAt = '29/10/2026 09:00') => ({ id, name, updatedAt, work: 'Thiết kế', mimeType: 'application/pdf', viewUrl: `https://drive.google.com/file/d/${id}/view`, downloadUrl: `https://drive.google.com/uc?export=download&id=${id}` });
const otherSnapshot = { id: 'day-other', name: '29-10-2026-QA-OTHER', date: '29/10/2026' };
const files = new Map([
  ['day-latest', [file('initial', 'Mặt bằng hiện tại.pdf')]],
  ['day-old', [file('old', 'Hồ sơ ngày cũ.pdf', '28/10/2026 09:00')]],
  ['day-other', [file('other-file', 'Tài liệu mới của khách B.pdf')]],
]);
let threeDFiles = [file('3d-initial', 'Phối cảnh ban đầu.pdf')];
let otherThreeDFiles = [file('3d-other', 'Phối cảnh mới của khách B.pdf')];
const requests = [];
const errors = [];
let activeDocumentRequests = 0;
let activeThreeDRequests = 0;
let maximumDocumentRequests = 0;
const activeDocumentRequestsByProject = new Map();
let nextHold = null;
let nextThreeDHold = null;
const clone = value => JSON.parse(JSON.stringify(value));
function holdNextDocuments(match = () => true) {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  nextHold = { gate, entered, match };
  return { release, started };
}
function holdNextThreeD() {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  nextThreeDHold = { gate, entered };
  return { release, started };
}
async function dispatch(payload) {
  requests.push(clone(payload));
  if (payload.action === 'list-documents') {
    activeDocumentRequests++;
    activeDocumentRequestsByProject.set(payload.projectId, (activeDocumentRequestsByProject.get(payload.projectId) || 0) + 1);
    maximumDocumentRequests = Math.max(maximumDocumentRequests, activeDocumentRequestsByProject.get(payload.projectId));
    const projectSnapshots = payload.projectId === 'DOCUMENT-LIVE-B' ? [otherSnapshot] : snapshots;
    const target = (payload.latest ? undefined : projectSnapshots.find(snapshot => snapshot.id === payload.snapshotId)) || projectSnapshots[0];
    const result = { ok: true, snapshots: clone(projectSnapshots), activeSnapshotId: target?.id || '', latestSnapshotId: projectSnapshots[0]?.id || '', files: payload.metadataOnly ? [] : clone(files.get(target?.id) || []), ...(payload.metadataOnly ? { metadataOnly: true } : {}) };
    const held = nextHold?.match(payload) ? nextHold : null;
    if (held) nextHold = null;
    try {
      if (held) { held.entered(); await held.gate; }
      return result;
    } finally {
      activeDocumentRequests--;
      activeDocumentRequestsByProject.set(payload.projectId, activeDocumentRequestsByProject.get(payload.projectId) - 1);
    }
  }
  if (payload.action === 'list-3d-files') {
    activeThreeDRequests++;
    const result = { ok: true, rootUrl: 'https://drive.google.com/drive/folders/qa-3d', folders: [{ key: 'architecture', name: 'Kiến trúc', folderUrl: 'https://drive.google.com/drive/folders/qa-3d-architecture', files: clone(payload.projectId === 'DOCUMENT-LIVE-B' ? otherThreeDFiles : threeDFiles) }] };
    const held = nextThreeDHold;
    nextThreeDHold = null;
    try {
      if (held) { held.entered(); await held.gate; }
      return result;
    } finally { activeThreeDRequests--; }
  }
  if (payload.action === 'load-consulting' || payload.action === 'load-workspace-cache') return { ok: true, years: clone(years) };
  if (payload.action === 'load-personnel') return { ok: true, personnel: {} };
  if (payload.action === 'load-customer-messages') return { ok: true, messages: [], configured: true };
  if (payload.action === 'load-assigned-work-notes') return { ok: true, notes: [], projectRevisions: [] };
  if (payload.action === 'load-assigned-design-tasks') return { ok: true, tasks: [] };
  if (payload.action === 'load-work-notes') return { ok: true, notes: [], revision: 0, deletedIds: [] };
  return { ok: true };
}
await mkdir('outputs/interface-qa', { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.GM_TEST_BROWSER_PATH ? { executablePath: process.env.GM_TEST_BROWSER_PATH } : {}) });
let qaPage;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await context.exposeBinding('documentQaDispatch', (_source, payload) => dispatch(payload));
  await context.route('https://script.google.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<meta charset="utf-8"><script>
addEventListener('message', async event => {
  if (event.data?.channel !== 'gm-manager-apps-script') return;
  const { id, payload } = event.data;
  const result = await window.documentQaDispatch(payload);
  event.source.postMessage({ channel:'gm-manager-apps-script-response', id, result }, '*');
});
parent.postMessage({ channel:'gm-manager-apps-script-ready' }, '*');
</script>` }));
  await context.addInitScript(({ years, scriptUrl, workflowToken, adminToken, snapshots, staleFile, otherSnapshot, otherStaleFile }) => {
    if (localStorage.getItem('document-live-qa-seeded')) return;
    localStorage.setItem('document-live-qa-seeded', '1');
    localStorage.setItem('gm-manager-consulting', JSON.stringify(years));
    localStorage.setItem('gm-manager-personnel-v1', '{}');
    localStorage.setItem('gm-manager-personnel-session-email', 'admin');
    localStorage.setItem('gm-manager-admin-session-v1', JSON.stringify({ token: adminToken, scriptUrl }));
    localStorage.setItem('gm-manager-workflow-session-v1', JSON.stringify({ token: workflowToken, scriptUrl, account: 'admin' }));
    localStorage.setItem('gm-manager-drive-cache-v1:documents-v15:2026-10-DOCUMENT-LIVE-QA-latest', JSON.stringify({ savedAt: Date.now(), value: { snapshots, activeSnapshotId: 'day-latest', files: [staleFile] } }));
    localStorage.setItem('gm-manager-drive-cache-v1:documents-v15:2026-10-DOCUMENT-LIVE-B-latest', JSON.stringify({ savedAt: Date.now(), value: { snapshots: [otherSnapshot], activeSnapshotId: otherSnapshot.id, files: [otherStaleFile] } }));
    localStorage.setItem('gm-manager-drive-cache-v1:three-d-v1:2026-10-DOCUMENT-LIVE-B', JSON.stringify({ savedAt: Date.now(), value: { rootUrl: 'https://drive.google.com/drive/folders/qa-3d-other', folders: [{ key: 'architecture', name: 'Kiến trúc', folderUrl: 'https://drive.google.com/drive/folders/qa-3d-other-architecture', files: [otherStaleFile] }] } }));
  }, { years, scriptUrl, workflowToken, adminToken, snapshots, staleFile: file('stale-cache', 'Tệp cache cũ.pdf'), otherSnapshot, otherStaleFile: file('other-cache', 'Cache cũ của khách B.pdf') });
  const page = await context.newPage();
  qaPage = page;
  page.on('pageerror', error => errors.push(error.message));
  // Keep the fixture date while allowing the refresh timers to advance.
  await page.clock.install({ time: new Date(now) });
  await page.goto(process.env.GM_TEST_BASE_URL || 'http://127.0.0.1:5173/gm-manager/');
  await page.locator('.customer-result').filter({ hasText: 'QA-DOC' }).click();
  await page.getByRole('button', { name: 'Tài liệu', exact: true }).click();
  const library = page.getByLabel('Tài liệu dự án', { exact: true });
  const day = date => library.locator('.document-day').filter({ has: page.locator('.document-day__trigger', { hasText: `Ngày: ${date}` }) });
  const expandedDay = () => library.locator('.document-day--expanded');
  const latestRequests = () => requests.filter(request => request.action === 'list-documents' && !request.snapshotId && !request.metadataOnly);
  const oldContentRequests = () => requests.filter(request => request.action === 'list-documents' && request.snapshotId === 'day-old' && !request.metadataOnly);
  const expectVisibleFile = async (name, timeout = 8500) => page.getByRole('link', { name, exact: true }).waitFor({ state: 'visible', timeout });
  const waitForCondition = async (predicate, label, timeout = 10000) => {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  const waitForStart = held => Promise.race([held.started, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('The held refresh never started.')), 10000); timer.unref(); })]);
  const switchCustomer = async houseId => {
    await page.getByRole('button', { name: '← Tổng quan', exact: true }).click();
    await page.locator('.customer-result').filter({ hasText: houseId }).click();
  };

  await expectVisibleFile('Mặt bằng hiện tại.pdf');
  assert.ok(latestRequests().length >= 1, 'cached entry also requests fresh latest metadata immediately');
  assert.equal(await page.getByRole('link', { name: 'Tệp cache cũ.pdf', exact: true }).count(), 0);
  assert.equal(oldContentRequests().length, 0, 'opening latest does not read historical file contents');

  files.get('day-latest').push(file('upload', 'Tệp vừa tải từ Drive.pdf'));
  await expectVisibleFile('Tệp vừa tải từ Drive.pdf');
  files.set('day-latest', [file('upload', 'Tệp đã đổi tên.pdf', '29/10/2026 09:12')]);
  await expectVisibleFile('Tệp đã đổi tên.pdf');
  await page.getByRole('link', { name: 'Mặt bằng hiện tại.pdf', exact: true }).waitFor({ state: 'detached', timeout: 8500 });
  assert.ok((await library.innerText()).includes('29/10/2026 09:12'), 'replacement metadata refreshes the file date');
  files.get('day-latest').push(file('focus-upload', 'Tệp sau khi quay lại ứng dụng.pdf'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expectVisibleFile('Tệp sau khi quay lại ứng dụng.pdf', 2500);

  await day('28/10/2026').locator('.document-day__trigger').click();
  await day('28/10/2026').getByRole('button', { name: 'Nạp tệp', exact: true }).waitFor();
  assert.equal(oldContentRequests().length, 0, 'expanding an old day still waits for Nạp tệp');
  await day('28/10/2026').getByRole('button', { name: 'Nạp tệp', exact: true }).click();
  await expectVisibleFile('Hồ sơ ngày cũ.pdf');
  assert.equal(oldContentRequests().length, 1);
  const metadataCount = requests.filter(request => request.action === 'list-documents' && request.metadataOnly).length;
  snapshots.unshift({ id: 'day-newest', name: '30-10-2026-QA-DOC', date: '30/10/2026' });
  files.set('day-newest', [file('newest', 'Bản ngày mới từ Drive.pdf', '30/10/2026 09:00')]);
  await day('30/10/2026').locator('.document-day__trigger').waitFor({ timeout: 8500 });
  assert.ok(requests.filter(request => request.action === 'list-documents' && request.metadataOnly).length > metadataCount, 'old selection polls only the day index');
  assert.ok((await expandedDay().innerText()).includes('28/10/2026'), 'new day discovery does not move the older selection');
  await expectVisibleFile('Hồ sơ ngày cũ.pdf');
  assert.equal(oldContentRequests().length, 1, 'background index refresh does not reload older contents');

  await page.getByRole('button', { name: 'Ghi chú', exact: true }).click();
  await page.getByRole('button', { name: 'Tài liệu', exact: true }).click();
  await expectVisibleFile('Bản ngày mới từ Drive.pdf');
  await day('28/10/2026').locator('.document-day__trigger').click();
  await expectVisibleFile('Hồ sơ ngày cũ.pdf');
  assert.equal(await day('28/10/2026').getByRole('button', { name: 'Nạp tệp', exact: true }).count(), 0, 'already loaded old day stays ready after switching tabs');
  assert.equal(oldContentRequests().length, 1);

  await day('30/10/2026').locator('.document-day__trigger').click();
  await expectVisibleFile('Bản ngày mới từ Drive.pdf');
  const held = holdNextDocuments();
  await Promise.race([held.started, new Promise((_, reject) => { const timeout = setTimeout(() => reject(new Error('The next automatic document refresh never started.')), 10000); timeout.unref(); })]);
  await day('28/10/2026').locator('.document-day__trigger').click();
  held.release();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expectVisibleFile('Hồ sơ ngày cũ.pdf');
  assert.ok((await expandedDay().innerText()).includes('28/10/2026'), 'late latest response cannot displace an old-day selection');
  assert.equal(maximumDocumentRequests, 1, 'only one metadata request per project runs at a time');

  await day('30/10/2026').locator('.document-day__trigger').click();
  await expectVisibleFile('Bản ngày mới từ Drive.pdf');
  snapshots.unshift({ id: 'day-next', name: '31-10-2026-QA-DOC', date: '31/10/2026' });
  files.set('day-next', [file('next', 'Ngày mới tự xuất hiện.pdf', '31/10/2026 09:00')]);
  await expectVisibleFile('Ngày mới tự xuất hiện.pdf');
  assert.ok((await expandedDay().innerText()).includes('31/10/2026'), 'watching the latest day automatically follows a newly added day');

  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expectVisibleFile('Phối cảnh ban đầu.pdf');
  threeDFiles = [file('3d-replaced', 'Phối cảnh mới tải lên.pdf')];
  await expectVisibleFile('Phối cảnh mới tải lên.pdf');
  assert.equal(await page.getByRole('link', { name: 'Phối cảnh ban đầu.pdf', exact: true }).count(), 0);
  await page.screenshot({ path: 'outputs/interface-qa/document-live-3d.png', fullPage: true });
  await page.getByRole('button', { name: 'Tài liệu', exact: true }).click();
  await expectVisibleFile('Ngày mới tự xuất hiện.pdf');
  await page.screenshot({ path: 'outputs/interface-qa/document-live-latest.png', fullPage: true });

  // Hold a foreground A read, switch to a cached B, and keep A pending until
  // B has completed a fresh entry read and a subsequent automatic poll.
  snapshots.push({ id: 'day-foreground', name: '27-10-2026-QA-DOC', date: '27/10/2026' });
  files.set('day-foreground', [file('foreground-a', 'Tệp phản hồi chậm của khách A.pdf')]);
  await day('27/10/2026').locator('.document-day__trigger').waitFor({ timeout: 8500 });
  await day('27/10/2026').locator('.document-day__trigger').click();
  await waitForCondition(() => activeDocumentRequests === 0, 'previous document response');
  const heldForeground = holdNextDocuments(payload => payload.snapshotId === 'day-foreground');
  await day('27/10/2026').getByRole('button', { name: 'Nạp tệp', exact: true }).click();
  await waitForStart(heldForeground);
  assert.ok(await library.locator('.document-library__actions').getByRole('button', { name: /Nạp lại/ }).isDisabled(), 'A foreground read sets its loading flag');
  await switchCustomer('QA-OTHER');
  await page.getByRole('button', { name: 'Tài liệu', exact: true }).click();
  await expectVisibleFile('Tài liệu mới của khách B.pdf');
  files.get('day-other').push(file('other-after-switch', 'Tệp B cập nhật khi A còn chờ.pdf'));
  await expectVisibleFile('Tệp B cập nhật khi A còn chờ.pdf');
  assert.ok(await library.locator('.document-library__actions').getByRole('button', { name: /Nạp lại/ }).isEnabled(), 'A loading flag does not block cached B live refresh');
  heldForeground.release();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByRole('link', { name: 'Tệp phản hồi chậm của khách A.pdf', exact: true }).count(), 0, 'late foreground A response never paints B');
  await expectVisibleFile('Tệp B cập nhật khi A còn chờ.pdf');

  // Repeat the foreground/cached scope change for the separate 3D library.
  await switchCustomer('QA-DOC');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expectVisibleFile('Phối cảnh mới tải lên.pdf');
  await waitForCondition(() => activeThreeDRequests === 0, 'previous 3D response');
  const heldThreeD = holdNextThreeD();
  await page.getByRole('button', { name: 'Cập nhật thư mục 3D', exact: true }).click();
  await waitForStart(heldThreeD);
  assert.ok(await page.getByRole('button', { name: 'Cập nhật thư mục 3D', exact: true }).isDisabled(), 'A foreground 3D read sets its loading flag');
  await switchCustomer('QA-OTHER');
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expectVisibleFile('Phối cảnh mới của khách B.pdf');
  otherThreeDFiles.push(file('3d-other-later', 'Phối cảnh B tiếp tục cập nhật.pdf'));
  await expectVisibleFile('Phối cảnh B tiếp tục cập nhật.pdf');
  assert.ok(await page.getByRole('button', { name: 'Cập nhật thư mục 3D', exact: true }).isEnabled(), 'A loading flag does not block B 3D live refresh');
  heldThreeD.release();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.getByRole('link', { name: 'Phối cảnh mới tải lên.pdf', exact: true }).count(), 0, 'late foreground A 3D response never paints B');
  await expectVisibleFile('Phối cảnh B tiếp tục cập nhật.pdf');
  assert.equal(maximumDocumentRequests, 1, 'single-flight remains scoped per project while A and B requests overlap');
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log(JSON.stringify({ passed: true, latestRequests: latestRequests().length, historicalContentReads: oldContentRequests().length, indexOnlyReads: requests.filter(request => request.action === 'list-documents' && request.metadataOnly).length, maximumDocumentRequests, scenarios: ['stale cache revalidated on entry', 'upload rename removal detected automatically', 'focus refreshes immediately', 'old days loaded only on demand', 'index refresh retains old content', 'new day discovery and tab return', 'late latest response ignored after selection change', 'new day automatically activates when viewing latest', '3D upload and removal refresh', 'foreground A request cannot block cached B document polling', 'foreground A 3D request cannot block cached B 3D polling', 'late A document and 3D responses never paint B'], errors }));
} catch (error) {
  console.error(JSON.stringify({ requests: requests.map(({ action, snapshotId, latest, metadataOnly }) => ({ action, snapshotId, latest, metadataOnly })), errors, text: (await qaPage?.locator('body').innerText())?.slice(-6500) }));
  if (qaPage) await qaPage.screenshot({ path: 'outputs/interface-qa/document-live-failed.png', fullPage: true });
  throw error;
} finally {
  nextHold = null;
  nextThreeDHold = null;
  await browser.close();
}
