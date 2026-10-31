import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const releaseApiUrl = 'https://api.github.com/repos/thanhbuimgarchi-cpu/gm-manager/releases/tags/desktop-latest';
const downloadPrefix = 'https://github.com/thanhbuimgarchi-cpu/gm-manager/releases/download/desktop-latest/';
const versionPattern = '(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)';
const installerPattern = new RegExp(`^GM-CRM-Setup-(${versionPattern})\\.exe$`);

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

export function desktopManifestFromRelease(release) {
  if (!release || release.draft === true || release.tag_name !== 'desktop-latest' || !Array.isArray(release.assets)) return { available: false };
  const candidates = [];
  const seen = new Set();
  for (const asset of release.assets) {
    if (!asset || typeof asset.name !== 'string' || asset.name !== asset.name.trim()) continue;
    const match = installerPattern.exec(asset.name);
    if (!match || !stableVersion(match[1]) || asset.state !== 'uploaded' || !Number.isSafeInteger(asset.size) || asset.size <= 0) continue;
    if (typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) continue;
    if (asset.browser_download_url !== `${downloadPrefix}${asset.name}`) continue;
    if (seen.has(match[1])) throw new Error('Duplicate native release versions.');
    seen.add(match[1]);
    candidates.push({ version: match[1], installerUrl: asset.browser_download_url, sha256: asset.digest.slice(7).toLowerCase(), size: asset.size });
  }
  candidates.sort((left, right) => compareVersions(right.version, left.version));
  return candidates[0] || { available: false };
}

export async function fetchDesktopManifest({ fetcher = fetch, token = '', pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)) } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(releaseApiUrl, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'GM-Manager-Release-Manifest', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 404) return { available: false };
      if (!response.ok) throw new Error(`Cannot inspect ready native installers (HTTP ${response.status}).`);
      return desktopManifestFromRelease(await response.json());
    } catch (error) {
      if (attempt === 2) throw error;
      await pause((attempt + 1) * 1000);
    }
  }
}

export async function writeDesktopManifest({ output = new URL('../public/desktop-version.json', import.meta.url), ...options } = {}) {
  const manifest = await fetchDesktopManifest(options);
  await writeFile(output, `${JSON.stringify(manifest)}\n`, 'utf8');
  return manifest;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const manifest = await writeDesktopManifest({ token: process.env.GITHUB_TOKEN || '' });
  console.log(manifest.available === false ? 'No completed versioned Windows installer is available.' : `Ready Windows installer: ${manifest.version}`);
}
