import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { appendFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const releasesApi = 'https://api.github.com/repos/thanhbuimgarchi-cpu/gm-manager/releases';
export const releaseApiUrl = `${releasesApi}/tags/desktop-latest`;
const downloadPrefix = 'https://github.com/thanhbuimgarchi-cpu/gm-manager/releases/download/desktop-latest/';
const versionPattern = '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)';
const installerPattern = new RegExp(`^GM-CRM-Setup-(${versionPattern})\\.exe$`);
const macInstallerName = 'GM-CRM-macOS-x64.dmg';
const retryPause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function stableVersion(value) {
  if (typeof value !== 'string' || value !== value.trim() || !new RegExp(`^${versionPattern}$`).test(value)) return null;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function compareVersions(left, right) {
  const a = stableVersion(left), b = stableVersion(right);
  if (!a || !b) throw new Error('A stable semantic version is required.');
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}

function desktopInstallersFromRelease(release) {
  const unavailable = { windows: { manifest: { available: false }, assetId: null }, mac: null };
  if (!release || release.draft === true || release.tag_name !== 'desktop-latest' || !Array.isArray(release.assets)) return unavailable;
  const candidates = [];
  const seen = new Set();
  let mac = null;
  for (const asset of release.assets) {
    if (!asset || typeof asset.name !== 'string' || asset.name !== asset.name.trim()) continue;
    if (asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0) continue;
    if (typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) continue;
    if (asset.browser_download_url !== `${downloadPrefix}${asset.name}`) continue;
    const metadata = { installerUrl: asset.browser_download_url, sha256: asset.digest.slice(7).toLowerCase(), size: asset.size };
    if (asset.name === macInstallerName) {
      if (mac) throw new Error('Duplicate macOS installer assets.');
      mac = { assetId: asset.id, manifest: metadata };
      continue;
    }
    const match = installerPattern.exec(asset.name);
    if (!match || !stableVersion(match[1])) continue;
    if (seen.has(match[1])) throw new Error('Duplicate native release versions.');
    seen.add(match[1]);
    candidates.push({
      assetId: asset.id,
      manifest: { version: match[1], ...metadata },
    });
  }
  candidates.sort((left, right) => compareVersions(right.manifest.version, left.manifest.version));
  return { windows: candidates[0] || unavailable.windows, mac };
}

export function desktopManifestFromRelease(release) {
  return desktopInstallersFromRelease(release).windows.manifest;
}

async function fetchDesktopInstallers({ fetcher = fetch, token = '', pause = retryPause } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const requestUrl = `${releaseApiUrl}?gm-manifest-check=${Date.now()}-${attempt}`;
      const response = await fetcher(requestUrl, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'GM-Manager-Release-Manifest', 'Cache-Control': 'no-cache', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        cache: 'no-store',
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 404) return desktopInstallersFromRelease(null);
      if (!response.ok) throw new Error(`Cannot inspect ready native installers (HTTP ${response.status}).`);
      return desktopInstallersFromRelease(await response.json());
    } catch (error) {
      if (attempt === 2) throw error;
      await pause((attempt + 1) * 1000);
    }
  }
}

export async function fetchDesktopManifest(options = {}) {
  return (await fetchDesktopInstallers(options)).windows.manifest;
}

export async function writeDesktopManifest({ output = new URL('../public/desktop-version.json', import.meta.url), ...options } = {}) {
  const manifest = await fetchDesktopManifest(options);
  await writeFile(output, `${JSON.stringify(manifest)}\n`, 'utf8');
  return manifest;
}

function trustedAssetRedirect(location) {
  let url;
  try { url = new URL(location); } catch { throw new Error('Invalid installer redirect.'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password
    || !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(url.hostname)) {
    throw new Error('Invalid installer redirect.');
  }
  return url.href;
}

export async function stageDesktopInstaller({ manifest, assetId, output, fetcher = fetch, token = '', pause = retryPause }) {
  if (!Number.isSafeInteger(assetId) || assetId <= 0) throw new Error('Missing GitHub installer asset ID.');
  const destination = output instanceof URL ? fileURLToPath(output) : output;
  await mkdir(dirname(destination), { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    const temporary = `${destination}.${randomUUID()}.part`;
    try {
      const signal = AbortSignal.timeout(120_000);
      const requestUrl = `${releasesApi}/assets/${assetId}?gm-installer-check=${Date.now()}-${attempt}`;
      let response = await fetcher(requestUrl, {
        headers: { Accept: 'application/octet-stream', 'X-GitHub-Api-Version': '2022-11-28', 'Cache-Control': 'no-cache', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        redirect: 'manual', cache: 'no-store', signal,
      });
      if (response.status === 302) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        // The signed CDN URL is sufficient. The API token must stay on api.github.com.
        response = await fetcher(trustedAssetRedirect(location), { redirect: 'error', cache: 'no-store', signal });
      }
      if (response.status !== 200 || !response.body) {
        await response.body?.cancel();
        throw new Error(`Installer asset did not return a full response (HTTP ${response.status}).`);
      }
      let size = 0;
      const hash = createHash('sha256');
      const verify = new Transform({
        transform(chunk, _encoding, callback) {
          size += chunk.length;
          if (size > manifest.size) return callback(new Error('Installer exceeds its expected size.'));
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(response.body, verify, createWriteStream(temporary, { flags: 'wx' }), { signal });
      if (size !== manifest.size || hash.digest('hex') !== manifest.sha256) throw new Error('Installer size or SHA-256 does not match the release.');
      await rename(temporary, destination);
      return;
    } catch (error) {
      await rm(temporary, { force: true });
      if (attempt === 2) throw error;
      await pause((attempt + 1) * 1000);
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const token = process.env.GITHUB_TOKEN || '';
  const { windows, mac } = await fetchDesktopInstallers({ token });
  const { manifest } = windows;
  await writeFile(new URL('../public/desktop-version.json', import.meta.url), `${JSON.stringify(manifest)}\n`, 'utf8');
  console.log(manifest.available === false ? 'No completed versioned Windows installer is available.' : `Ready Windows installer: ${manifest.version}`);
  if (process.argv.includes('--stage-installers')) {
    const installers = [
      { asset: manifest.available === false ? null : windows, fileName: 'GM-CRM-Setup.exe', platform: 'windows' },
      { asset: mac, fileName: macInstallerName, platform: 'macos' },
    ];
    const outputs = await Promise.all(installers.map(async ({ asset, fileName, platform }) => {
      if (!asset) return '';
      try {
        const output = new URL(`../public/downloads/${fileName}`, import.meta.url);
        await stageDesktopInstaller({ ...asset, token, output });
        console.log(`Verified ${fileName} staged for Pages.`);
        return `${platform}-installer-mirrored=true\n`;
      } catch {
        // Keep the site deployable. Avoid logging errors containing a signed CDN URL.
        console.warn(`::warning::Could not stage verified ${fileName} for Pages.`);
        return '';
      }
    }));
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, outputs.join(''), 'utf8');
  }
}
