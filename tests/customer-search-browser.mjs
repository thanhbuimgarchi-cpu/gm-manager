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
const archived = [month(2026, 11, [currentArchive]), month(2026, 10, [record('DV-10', 'Archive tháng 10')]), month(2026, 9, [record('DV-75', 'Archive tháng 9')]), month(2025, 2, [oldArchive])];

await page.clock.setFixedTime(new Date('2026-11-09T02:00:00Z'));
await context.exposeBinding('customerSearchFixture', (_source, payload) => {
  if (payload.action === 'load-workspace-cache') return { ok: true, years: [current] };
  if (payload.action === 'load-consulting') {
    if (payload.mode === 'search') {
      searches.push(payload.query);
      const query = payload.query.toLowerCase();
      return { ok: true, years: query === 'archive' ? archived : query === 'dv' ? archived.slice(1, 3) : [] };
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
  const suggestions = page.getByRole('region', { name: 'Gợi ý hồ sơ', exact: true });
  const rows = page.getByRole('region', { name: 'Hồ sơ trong tháng', exact: true }).locator('.customer-result-row');
  await rows.getByText('NOW-02', { exact: true }).waitFor();
  assert.equal(await rows.count(), 2);
  assert.equal(await suggestions.count(), 0, 'suggestions are hidden before typing');

  await page.setViewportSize({ width: 390, height: 844 });
  await input.fill('DV');
  await suggestions.getByRole('button', { name: 'DV-75 T9 / 2026' }).waitFor();
  await suggestions.getByRole('button', { name: 'DV-10 T10 / 2026' }).waitFor();
  assert.ok(await suggestions.getByText('T9 / 2026', { exact: true }).isVisible(), 'the period is visible on mobile');
  assert.ok(await suggestions.evaluate(panel => panel.previousElementSibling?.matches('.customer-search') && panel.nextElementSibling?.matches('.customer-period')), 'suggestions sit between the input and the month controls');
  assert.equal(await rows.getByText('DV-75', { exact: true }).count(), 0);
  await rows.getByText('NOW-02', { exact: true }).waitFor();
  assert.equal(await rows.count(), 2, 'typing leaves the monthly list intact');
  await page.getByLabel('Tháng', { exact: true }).selectOption('9');
  await rows.getByText('DV-75', { exact: true }).waitFor();
  assert.equal(await rows.count(), 1, 'changing the month only affects the monthly list');
  assert.equal(await suggestions.getByRole('button').count(), 2);
  await page.getByLabel('Tháng', { exact: true }).selectOption('11');
  await input.press('Escape');
  assert.equal(await suggestions.count(), 0);
  assert.equal(await input.inputValue(), '');
  await page.setViewportSize({ width: 1280, height: 900 });

  await input.fill('archive');
  await suggestions.getByRole('button', { name: 'DUP-01 T2 / 2025' }).waitFor();
  assert.equal(await suggestions.getByText('DUP-01', { exact: true }).count(), 2, 'the same house code in two periods remains individually openable');
  assert.equal(await suggestions.getByRole('button').count(), 4, 'matches from both months and years are shown');
  assert.deepEqual(searches, ['DV', 'archive']);

  await page.getByRole('button', { name: 'Xóa tìm kiếm khách hàng', exact: true }).click();
  await rows.getByText('NOW-02', { exact: true }).waitFor();
  assert.equal(await suggestions.count(), 0);
  assert.equal(await rows.count(), 2, 'clearing search leaves the current period intact');

  await input.fill('archive');
  await suggestions.getByRole('button', { name: 'DUP-01 T2 / 2025' }).click();
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
  console.log('Customer suggestions: DV lookup on mobile, separate month selection, exact open and cold notification link passed.');
} catch (error) {
  console.error('Index requests:', indexRequests, 'URL:', page.url(), 'visible title:', await page.locator('h1').allTextContents());
  if (errors.length) console.error('Browser errors:', errors);
  throw error;
} finally {
  await browser.close();
}
