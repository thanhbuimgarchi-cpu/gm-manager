import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { stableVersion, compareVersions, desktopManifestFromRelease, fetchDesktopManifest, writeDesktopManifest, releaseApiUrl } from '../scripts/write-desktop-version.mjs';

const downloadPrefix = 'https://github.com/thanhbuimgarchi-cpu/gm-manager/releases/download/desktop-latest/';
function installer(version = '1.2.0', extra = {}) {
  const name = `GM-CRM-Setup-${version}.exe`;
  return { name, state: 'uploaded', size: 111048986, digest: `sha256:${'a'.repeat(64)}`, browser_download_url: downloadPrefix + name, ...extra };
}
const release = (...assets) => ({ tag_name: 'desktop-latest', draft: false, assets });
const readyResponse = (body) => ({ ok: true, status: 200, json: async () => body });

test('native release selection uses semantic version order and ignores aliases or incomplete uploads', () => {
  const selected = desktopManifestFromRelease(release(
    installer('1.9.9'), installer('1.10.0'), installer('2.0.0', { state: 'starter' }),
    installer('8.0.0', { digest: null }), installer('9.0.0', { size: 0 }),
    installer('1.2.0', { name: 'GM-CRM-Setup.exe' }),
  ));
  assert.deepEqual(selected, { version: '1.10.0', installerUrl: downloadPrefix + 'GM-CRM-Setup-1.10.0.exe', sha256: 'a'.repeat(64), size: 111048986 });
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
});

test('only stable unambiguous versions are eligible for a native update', () => {
  for (const version of ['01.2.0', '1.02.0', '1.2.00', '1.2', 'v1.2.0', '1.2.0-beta', '1.2.0+build', '1.2.0\n', ' 1.2.0', '9007199254740992.0.0']) {
    assert.equal(stableVersion(version), null, version);
    assert.deepEqual(desktopManifestFromRelease(release(installer(version))), { available: false });
  }
  assert.throws(() => compareVersions('1.2', '1.2.0'));
});

test('manifest rejects third-party download destinations and invalid integrity metadata', () => {
  const valid = installer();
  for (const patch of [
    { browser_download_url: 'https://example.org/GM-CRM-Setup-1.2.0.exe' },
    { browser_download_url: valid.browser_download_url + '?redirect=elsewhere' },
    { browser_download_url: valid.browser_download_url.replace('/gm-manager/', '/other-repository/') },
    { browser_download_url: valid.browser_download_url.replace('https:', 'http:') },
    { digest: 'sha256:1234' }, { digest: 'sha512:' + 'a'.repeat(64) },
    { size: -1 }, { size: 1.5 }, { size: Number.MAX_SAFE_INTEGER + 1 },
    { name: valid.name + '\n', browser_download_url: valid.browser_download_url + '\n' },
  ]) assert.deepEqual(desktopManifestFromRelease(release(installer('1.2.0', patch))), { available: false }, JSON.stringify(patch));
  const uppercase = desktopManifestFromRelease(release(installer('1.2.0', { digest: 'sha256:' + 'A'.repeat(64) })));
  assert.equal(uppercase.sha256, 'a'.repeat(64));
});

test('missing, draft, wrong-tag and duplicate ready releases fail closed', () => {
  for (const value of [null, {}, release(), { ...release(installer()), draft: true }, { ...release(installer()), tag_name: 'different-release' }]) {
    assert.deepEqual(desktopManifestFromRelease(value), { available: false });
  }
  assert.throws(() => desktopManifestFromRelease(release(installer(), installer())), /Duplicate/);
});

test('CI performs authenticated release discovery without publishing its token in the manifest', async () => {
  const requests = [];
  const manifest = await fetchDesktopManifest({ token: 'qa-token', fetcher: async (url, options) => { requests.push({ url, options }); return readyResponse(release(installer())); } });
  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.startsWith(`${releaseApiUrl}?gm-manifest-check=`));
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].options.headers['Cache-Control'], 'no-cache');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer qa-token');
  assert.equal(JSON.stringify(manifest).includes('qa-token'), false);
  assert.equal(manifest.version, '1.2.0');
});

test('unpublished releases remain unavailable and transient API failures retry within a bound', async () => {
  assert.deepEqual(await fetchDesktopManifest({ fetcher: async () => ({ ok: false, status: 404 }) }), { available: false });
  let attempts = 0;
  const delays = [];
  const requestUrls = [];
  const manifest = await fetchDesktopManifest({ fetcher: async (url) => { requestUrls.push(url); return ++attempts < 3 ? { ok: false, status: 503 } : readyResponse(release(installer())); }, pause: async (value) => delays.push(value) });
  assert.equal(manifest.version, '1.2.0');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [1000, 2000]);
  assert.equal(new Set(requestUrls).size, 3, 'each retry bypasses a previously cached release response');
});

test('a failed discovery preserves the existing output instead of advertising unverified bytes', async (t) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'gm-desktop-release-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('gm-desktop-release-'));
    await rm(temporary, { recursive: true, force: true });
  });
  const output = path.join(temporary, 'desktop-version.json');
  await writeFile(output, 'previous verified manifest', 'utf8');
  let attempts = 0;
  await assert.rejects(writeDesktopManifest({ output, fetcher: async () => { attempts++; return { ok: false, status: 503 }; }, pause: async () => {} }), /HTTP 503/);
  assert.equal(attempts, 3);
  assert.equal(await readFile(output, 'utf8'), 'previous verified manifest');
  const manifest = await writeDesktopManifest({ output, fetcher: async () => readyResponse(release(installer())) });
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), manifest);
});

test('release publication preserves versioned installers and refreshes Pages only from trusted successful builds', async () => {
  const windows = await readFile(new URL('../.github/workflows/build-desktop.yml', import.meta.url), 'utf8');
  const pages = await readFile(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
  assert.match(windows, /GM-CRM-Setup-\$version\.exe/);
  assert.match(windows, /gh release upload desktop-latest "\$versionedInstaller#\$versionedName" --repo \$env:REPOSITORY\r?\n/);
  assert.doesNotMatch(windows, /gh release upload[^\r\n]*\$versionedInstaller[^\r\n]*--clobber/);
  assert.match(windows, /Get-FileHash -LiteralPath \$versionedInstaller -Algorithm SHA256/);
  assert.match(windows, /\$published\[0\]\.digest -cne \$checksum/);
  assert.match(windows, /\$newerVersions\.Count -eq 0/);
  assert.match(pages, /workflow_run:/);
  assert.match(pages, /conclusion == 'success'/);
  assert.match(pages, /head_repository\.full_name == github\.repository/);
  assert.match(pages, /ref: main/);
  assert.match(pages, /version=\$\(git rev-parse HEAD\)/);
  assert.equal((pages.match(/VITE_APP_VERSION: \$\{\{ steps\.source\.outputs\.version \}\}/g) || []).length, 2);
  assert.match(pages, /node scripts\/write-desktop-version\.mjs/);
});
