import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compareVersions,
  needsUninstallGuidance,
  parseYmlVersion,
  checkLatestRelease,
} from '../services/appUpdate';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * 移动端更新通道服务（#262/#263）：
 * - 镜像 latest.yml 优先取版本号，GitHub API 仅兜底；
 * - 按通道（auto 测速 / 手动置顶）解析 APK 直链；
 * - debug→release 跨签名边界给出卸载迁移提示。
 */

const LATEST_YML = (v: string) => `version: ${v}
path: MPlayer.Setup.${v}.exe
sha512: xxx
releaseDate: '2026-01-01'
`;

const fakeOk = (body: string) => ({
  ok: true,
  status: 200,
  text: async () => body,
  // 探针走 arrayBuffer（core probeUpdateSources），元数据走 text
  arrayBuffer: async () => new ArrayBuffer(body.length),
});

/** fetch 按 URL 分流：镜像 yml / GitHub API */
function stubFetch(impl: (url: string) => Promise<{ ok: boolean; status?: number; text: () => Promise<string> }>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: { signal?: AbortSignal }) => {
    void init;
    return impl(String(url));
  }));
}

beforeEach(() => {
  useSettingsStore.setState({ updateChannel: 'auto' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('工具函数', () => {
  it('parseYmlVersion 抽取 semver，容忍 v 前缀与空白', () => {
    expect(parseYmlVersion('version: 1.7.3\npath: x')).toBe('1.7.3');
    expect(parseYmlVersion('\nversion:  v2.0.0 \n')).toBe('2.0.0');
    expect(parseYmlVersion('no version here')).toBeNull();
  });

  it('compareVersions 数值逐段比较', () => {
    expect(compareVersions('1.7.3', '1.7.10')).toBeLessThan(0);
    expect(compareVersions('v1.8.0', '1.7.9')).toBeGreaterThan(0);
    expect(compareVersions('1.7.3', 'v1.7.3')).toBe(0);
  });

  it('needsUninstallGuidance 只在 ≤1.7.1 → ≥1.7.2 边界为真（#263）', () => {
    expect(needsUninstallGuidance('1.7.1', '1.7.2')).toBe(true);
    expect(needsUninstallGuidance('1.7.0', '2.0.0')).toBe(true);
    expect(needsUninstallGuidance('1.7.2', '1.7.3')).toBe(false);
    expect(needsUninstallGuidance('1.7.1', '1.7.1')).toBe(false);
  });
});

describe('checkLatestRelease', () => {
  it('auto 通道：最快的成功镜像胜出，APK 直链走该镜像前缀', async () => {
    // 探针与元数据共用同一 stub：ghfast 即回、gh-proxy 慢一拍、直连失败
    stubFetch(async (url) => {
      const { hostname } = new URL(url);
      if (hostname === 'github.com') throw new Error('direct blocked'); // 直连整域失败
      if (hostname === 'ghfast.top') return fakeOk(LATEST_YML('1.8.0'));
      if (hostname === 'gh-proxy.com') {
        await new Promise((r) => setTimeout(r, 20));
        return fakeOk(LATEST_YML('1.8.0'));
      }
      if (hostname === 'ghproxy.net') throw new Error('down');
      if (hostname === 'api.github.com') {
        return fakeOk(JSON.stringify({ tag_name: 'v1.8.0', body: 'notes' }));
      }
      throw new Error('unexpected url: ' + url);
    });

    const result = await checkLatestRelease('1.7.1', 'auto');

    expect(result.state).toBe('available');
    expect(result.version).toBe('1.8.0');
    expect(result.apkUrl).toContain('https://ghfast.top/https://github.com/');
    const apk = new URL(result.apkUrl!);
    expect(apk.hostname).toBe('ghfast.top');
    expect(apk.pathname.endsWith('/releases/latest/download/MPlayer-v1.8.0.apk')).toBe(true);
    expect(result.sourceLabel).toContain('ghfast.top');
    expect(result.needsUninstallMigration).toBe(true);
  });

  it('手动通道置顶所选源；最新版时不触发 available', async () => {
    const seenOrder: string[] = [];
    stubFetch(async (url) => {
      if (new URL(url).pathname.endsWith('/latest.yml')) {
        seenOrder.push(new URL(url).host);
        return fakeOk(LATEST_YML('1.7.3'));
      }
      throw new Error('no api expected');
    });

    const result = await checkLatestRelease('1.7.3', 'github');

    // 手动 github 置顶 → 第一个被拉的 yml 就是原生地址
    expect(seenOrder[0]).toBe('github.com');
    expect(result.state).toBe('not-available'); // 本地已是最新
  });

  it('全部镜像失败时回落 GitHub Releases API 兜底', async () => {
    stubFetch(async (url) => {
      if (new URL(url).hostname === 'api.github.com') {
        return fakeOk(JSON.stringify({
          tag_name: 'v1.9.0',
          body: '- mirror fallback notes',
          assets: [{ name: 'MPlayer-v1.9.0.apk', browser_download_url: 'native-url' }],
        }));
      }
      throw new Error('all mirrors down'); // 四个源 + notes 补取全挂也 OK
    });

    const result = await checkLatestRelease('1.7.2', 'ghfast');

    expect(result.state).toBe('available');
    expect(result.version).toBe('1.9.0');
    expect(result.releaseNotes).toBe('- mirror fallback notes');
    expect(result.sourceLabel).toBe('GitHub 直连');
    expect(result.needsUninstallMigration).toBe(false);
  });
});
