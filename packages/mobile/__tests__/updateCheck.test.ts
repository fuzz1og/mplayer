import { describe, expect, it } from 'vitest';
import {
  GITEE_RELEASES_PAGE_URL,
  compareVersions,
  findApkAsset,
  getReleasePageUrl,
  pickLatestRelease,
} from '../services/updateCheck';

const release = (overrides: Record<string, unknown> = {}) => ({
  tag_name: 'v1.5.0',
  created_at: '2026-07-16T00:00:00+08:00',
  prerelease: false,
  html_url: 'https://gitee.com/aris3104/mplayer/releases/tag/v1.5.0',
  assets: [
    {
      name: 'app-release.apk',
      browser_download_url: 'https://gitee.com/aris3104/mplayer/releases/download/v1.5.0/app-release.apk',
      content_type: 'application/vnd.android.package-archive',
    },
  ],
  ...overrides,
});

describe('mobile update check', () => {
  it('按版本号选择最新 release，不受 API 返回顺序影响', () => {
    const older = release({ tag_name: 'v1.4.0', created_at: '2026-07-01T00:00:00+08:00' });
    const newer = release({ tag_name: 'v1.5.0' });
    const latest = pickLatestRelease([older, newer]);
    expect(latest?.tag_name).toBe('v1.5.0');
  });

  it('跳过 prerelease', () => {
    const prerelease = release({ tag_name: 'v2.0.0', prerelease: true });
    const stable = release({ tag_name: 'v1.5.0' });
    const latest = pickLatestRelease([prerelease, stable]);
    expect(latest?.tag_name).toBe('v1.5.0');
  });

  it('找到 APK 下载地址', () => {
    expect(findApkAsset(release())).toBe(
      'https://gitee.com/aris3104/mplayer/releases/download/v1.5.0/app-release.apk'
    );
  });

  it('没有 APK 资产时返回空，并回退到 release 页面', () => {
    const noApk = release({ assets: [] });
    expect(findApkAsset(noApk)).toBe('');
    expect(getReleasePageUrl(noApk)).toBe(noApk.html_url);
    expect(getReleasePageUrl(null)).toBe(GITEE_RELEASES_PAGE_URL);
  });

  it('版本比较忽略 v 前缀', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('v1.5.0', '1.5.0')).toBe(0);
  });
});
