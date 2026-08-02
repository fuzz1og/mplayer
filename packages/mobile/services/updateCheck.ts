export interface GiteeReleaseAsset {
  name?: string;
  browser_download_url?: string;
  content_type?: string;
}

export interface GiteeRelease {
  tag_name?: string;
  body?: string;
  html_url?: string;
  created_at?: string;
  prerelease?: boolean;
  assets?: GiteeReleaseAsset[];
}

export const GITEE_OWNER = 'aris3104';
export const GITEE_REPO = 'mplayer';
export const GITEE_RELEASES_URL = `https://gitee.com/api/v5/repos/${GITEE_OWNER}/${GITEE_REPO}/releases?per_page=100`;
export const GITEE_RELEASES_PAGE_URL = `https://gitee.com/${GITEE_OWNER}/${GITEE_REPO}/releases?per_page=100`;

export function normalizeVersionTag(tag: string): string {
  return tag.replace(/^[vV]/, '');
}

export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^[vV]/, '').split('.').map(Number);
  const pb = b.replace(/^[vV]/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export function pickLatestRelease(releases: GiteeRelease[]): GiteeRelease | null {
  const published = (releases || []).filter(release => release && !release.prerelease);
  if (published.length === 0) return null;
  return [...published].sort((a, b) => {
    const byVersion = compareVersions(
      normalizeVersionTag(b.tag_name || ''),
      normalizeVersionTag(a.tag_name || '')
    );
    if (byVersion !== 0) return byVersion;
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  })[0] ?? null;
}

export function findApkAsset(release: GiteeRelease | null): string {
  if (!release?.assets) return '';
  const asset = release.assets.find(a =>
    (a.name || '').toLowerCase().endsWith('.apk') ||
    (a.content_type || '').toLowerCase().includes('apk')
  );
  return asset?.browser_download_url || '';
}

export function getReleasePageUrl(release: GiteeRelease | null): string {
  return release?.html_url || GITEE_RELEASES_PAGE_URL;
}
