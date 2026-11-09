import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Run against local Vite only. The mocked Apps Script returns synthetic
// customer folders; no production Drive or CRM data is accessed.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.GM_TEST_PLAYWRIGHT_MODULE || 'playwright');
const baseUrl = process.env.GM_TEST_BASE_URL || 'http://127.0.0.1:5173/gm-manager/';
const browser = await chromium.launch({ headless: true, ...(process.env.GM_TEST_BROWSER_PATH ? { executablePath: process.env.GM_TEST_BROWSER_PATH } : {}) });
const context = await browser.newContext({ serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
const searches = [];
const indexRequests = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(10_000);

const record = (code, name, id = code) => ({ id, houseId: code, projectId: code, name, createdAt: '02/11/2026', isHydrated: true, progressHydrated: true, details: { HVT: name } });
const currentArchive = record('DUP-01', 'Hồ sơ Archive tháng hiện tại', 'current-duplicate');
const currentOther = record('NOW-02', 'Hồ sơ tháng hiện tại');
const oldArchive = record('DUP-01', 'Hồ sơ Archive năm trước', 'old-duplicate');
const month = (year, number, records) => ({ year, months: [{ label: `T${number}`, records }] });
const current = month(2026, 11, [{ ...currentArchive, name: currentArchive.houseId, details: {} }, currentOther]);
// The same year appears twice in this response to exercise compatibility
// with the old Apps Script contract, which grouped each month separately.
const archived = [month(2026, 11, [currentArchive]), month(2026, 10, [record('ARCH-10', 'Archive tháng 10')]), month(2026, 9, [record('ARCH-09', 'Archive tháng 9')]), month(2025, 2, [oldArchive])];

await page.clock.setFixedTime(new Date('2026-11-09T02:00:00Z'));
await context.exposeBinding('customerSearchFixture', (_source, payload) => {
  if (payload.action === 'load-workspace-cache') return { ok: true, years: [current] };
  if (payload.action === 'load-consulting') {
    if (payload.mode === 'search') {
      searches.push(payload.query);
      return { ok: true, years: payload.query.toLowerCase() === 'archive' ? archived : [] };
    }
    const period = payload.year === 2026 && payload.month === 11 ? current : archived.find(year => year.year === payload.year && year.months[0].label === `T${payload.month}`);
    if (payload.mode === 'detail' || payload.mode === 'progress') return { ok: true, year: payload.year, month: payload.month, record: period?.months[0].records.find(item => item.projectId === payload.projectId) };
    indexRequests.push([payload.year, payload.month]);
    return { ok: true, years: period ? [period] : [] };
  }
  return { ok: true, personnel: {}, notes: [], tasks: [], messages: [], configured: true };
});
await context.route('https://script.google.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<meta charset="utf-8"><script>
addEventListener('message', async event => {
  if(event.data?.channel !== 'gm-manager-apps-script') return;
  const {id,payload} = event.data;
  const result = await customerSearchFixture(payload);
  event.source.postMessage({channel:'gm-manager-apps-script-response',id,result},'*');
});
parent.postMessage({channel:'gm-manager-apps-script-ready'},'*');</script>` }));

try {
  await page.goto(baseUrl);
  const input = page.getByRole('textbox', { name: 'Tìm khách hàng', exact: true });
  const rows = page.locator('.customer-result-row');
  await rows.getByText('NOW-02', { exact: true }).waitFor();
  assert.equal(await rows.count(), 2, 'empty search only shows the selected period');
  await input.fill('archive');
  await rows.getByText('ARCH-09', { exact: true }).waitFor();
  await rows.getByText('ARCH-10', { exact: true }).waitFor();
  assert.equal(await rows.getByText('DUP-01', { exact: true }).count(), 2, 'same house code in two periods remains individually openable');
  assert.equal(await rows.count(), 4, 'uncached matches from both months and years are shown');
  assert.deepEqual(searches, ['archive']);

  await page.getByRole('button', { name: 'Xóa tìm kiếm khách hàng', exact: true }).click();
  await rows.getByText('NOW-02', { exact: true }).waitFor();
  assert.equal(await rows.count(), 2, 'clearing search restores the current period including unrelated customers');

  await input.fill('archive');
  const previousYear = rows.filter({ hasText: /T2\s*\/\s*2025/ });
  await previousYear.getByRole('button', { name: 'Mở hồ sơ DUP-01', exact: true }).click();
  const customerName = page.getByRole('textbox', { name: 'Tên khách hàng', exact: true });
  await customerName.waitFor();
  assert.equal(await customerName.inputValue(), oldArchive.name, 'the older duplicate opens the older customer record, not the first house-code match');

  // A fresh browser has only the current duplicate in its startup fixture.
  // The link must request the actual period before consuming the target.
  await page.evaluate(() => localStorage.clear());
  indexRequests.length = 0;
  await page.goto(`${baseUrl}?gmcrmProject=DUP-01&gmcrmHouse=DUP-01&gmcrmYear=2025&gmcrmMonth=2&gmcrmNote=fixture-note`);
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('gmcrmNote'));
  assert.ok(indexRequests.some(([year, month]) => year === 2025 && month === 2), 'the link loads the missing historical period');
  await page.getByRole('navigation', { name: 'Quy trình GM Manager' }).getByRole('button', { name: 'Tư vấn', exact: true }).click();
  await customerName.waitFor();
  assert.equal(await customerName.inputValue(), oldArchive.name, 'the link does not open the current duplicate');
  assert.deepEqual(errors, []);
  console.log('Global customer search: cross-period lookup, additive cache, clear, exact open and cold notification link passed.');
} catch (error) {
  console.error('Index requests:', indexRequests, 'URL:', page.url(), 'visible title:', await page.locator('h1').allTextContents());
  if (errors.length) console.error('Browser errors:', errors);
  throw error;
} finally {
  await browser.close();
}
