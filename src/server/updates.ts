export interface ReleaseUpdate {
  currentVersion: string; latestVersion: string; available: boolean; releaseUrl: string;
  desktop: boolean;
}
export function parseVersion(value: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}
export function isNewer(current: string, latest: string): boolean {
  const a = parseVersion(current); const b = parseVersion(latest);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) { if (b[i] !== a[i]) return b[i] > a[i]; }
  return false;
}
export async function checkRelease(currentVersion: string, desktop: boolean, fetcher: typeof fetch = fetch): Promise<ReleaseUpdate> {
  const response = await fetcher('https://api.github.com/repos/MimiClous/chatiffy/releases/latest', {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Chatiffy' }, signal: AbortSignal.timeout(10000)
  });
  if (response.status === 404) return { currentVersion, latestVersion: currentVersion, available: false, desktop, releaseUrl: 'https://github.com/MimiClous/chatiffy/releases' };
  if (!response.ok) throw new Error(`GitHub вернул ${response.status}. Попробуйте позже.`);
  const data = await response.json() as { tag_name?: unknown; draft?: boolean; prerelease?: boolean; assets?: { name?: string; browser_download_url?: string }[] };
  if (typeof data.tag_name !== 'string' || !parseVersion(data.tag_name) || data.draft || data.prerelease) throw new Error('Некорректный стабильный релиз');
  const latestVersion = data.tag_name.replace(/^v/, '');
  const zip = `Chatiffy-${latestVersion}-windows-x64.zip`;
  const expected = `https://github.com/MimiClous/chatiffy/releases/download/${data.tag_name}/`;
  const complete = [zip, `${zip}.sha256`].every(name => data.assets?.some(asset => asset.name === name && asset.browser_download_url === expected + name));
  if (!complete) throw new Error('В релизе пока нет готового Windows-архива и контрольной суммы.');
  return { currentVersion, latestVersion, available: isNewer(currentVersion, latestVersion), desktop,
    releaseUrl: `https://github.com/MimiClous/chatiffy/releases/tag/${data.tag_name}` };
}
