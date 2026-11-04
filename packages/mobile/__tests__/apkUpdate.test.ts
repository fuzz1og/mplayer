import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 移动端更新包下载校验（#725）：md5sum 行解析 / 哈希比对 / 四通道下载重试 / intent 安装。
 * 与 scripts/__tests__/apk-md5.test.js 同口径：发布侧产出的行必须能被这里解析。
 */

const h = vi.hoisted(() => ({
  downloadLog: [] as { url: string; name: string; idempotent: boolean }[],
  deleteLog: [] as string[],
  infoQueue: [] as ({ md5: string | null; size: number | null } | Error)[],
  downloadFailures: [] as string[],
  fetchUrls: [] as string[],
  started: [] as { action: string; params: Record<string, unknown> }[],
}));

vi.mock('expo-file-system', () => {
  class FakeFile {
    static downloadFileAsync = vi.fn(async (url: string, file: any, options: any) => {
      h.downloadLog.push({ url, name: file.name, idempotent: !!options?.idempotent });
      options?.onProgress?.({ bytesWritten: 1024, totalBytes: 4096 });
      if (h.downloadFailures.some((needle) => url.includes(needle))) throw new Error('下载中断');
      return file;
    });
    name: string;
    contentUri: string;
    constructor(_parent: unknown, name: string) {
      this.name = name;
      this.contentUri = `content://com.mplayer.mobile.FileSystemFileProvider/cache/${name}`;
    }
    info(_options: { md5?: boolean }) {
      const next = h.infoQueue.shift();
      if (next instanceof Error) throw next;
      return { exists: true, md5: next?.md5 ?? null, size: next?.size ?? null };
    }
    delete() { h.deleteLog.push(this.name); }
  }
  return { File: FakeFile, Paths: { cache: { uri: 'file:///cache' } } };
});

vi.mock('expo-intent-launcher', () => ({
  startActivityAsync: vi.fn(async (action: string, params: Record<string, unknown>) => {
    h.started.push({ action, params });
    return { resultCode: -1 };
  }),
}));

import {
  apkAssetName,
  checksumAssetName,
  orderSourcesForChannel,
  parseExpectedMd5,
  md5Matches,
  formatBytes,
  downloadAndVerifyApk,
  launchApkInstaller,
  ApkIntegrityError,
} from '../services/appUpdate';
import { UPDATE_SOURCE_DEFS } from '@mplayer/core';

const EXPECTED = '0123456789abcdef0123456789abcdef';
const BAD = 'ffffffffffffffffffffffffffffffff';
const md5Line = (hash: string = EXPECTED) => `${hash}  MPlayer-v1.9.1.apk\n`;

const ok = (body: string) => ({ ok: true, status: 200, text: async () => body });

function stubFetch(impl: (url: string) => Promise<ReturnType<typeof ok>>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: { signal?: AbortSignal }) => {
    void init;
    const resolved = String(url);
    h.fetchUrls.push(resolved);
    return impl(resolved);
  }));
}

beforeEach(() => {
  h.downloadLog.length = 0;
  h.deleteLog.length = 0;
  h.infoQueue.length = 0;
  h.downloadFailures.length = 0;
  h.fetchUrls.length = 0;
  h.started.length = 0;
  stubFetch(async (url) => (url.includes('.apk.md5') ? ok(md5Line()) : ok('')));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('发布资产命名与通道顺序（#725）', () => {
  it('APK 与 .apk.md5 同名前缀', () => {
    expect(apkAssetName('1.9.1')).toBe('MPlayer-v1.9.1.apk');
    expect(checksumAssetName('1.9.1')).toBe('MPlayer-v1.9.1.apk.md5');
  });

  it('手动通道置顶所选源，auto 与未知通道用静态顺序', () => {
    expect(orderSourcesForChannel('ghfast').map((d) => d.id)).toEqual(['ghfast', 'gh-proxy', 'ghproxynet', 'github']);
    expect(orderSourcesForChannel('auto').map((d) => d.id)).toEqual(UPDATE_SOURCE_DEFS.map((d) => d.id));
    expect(orderSourcesForChannel('nope').map((d) => d.id)).toEqual(UPDATE_SOURCE_DEFS.map((d) => d.id));
  });
});

describe('md5sum 行解析与哈希比对（#725）', () => {
  it('解析发布侧脚本产出的行（两空格 + basename），归一为小写 hex', () => {
    expect(parseExpectedMd5(md5Line())).toBe(EXPECTED);
    expect(parseExpectedMd5('d41d8cd98f00b204e9800998ecf8427e  empty.apk\n')).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });

  it('容忍大写哈希、CRLF 与多行；忽略 HTML / 短 hex', () => {
    expect(parseExpectedMd5('ABCDEF0123456789ABCDEF0123456789  x.apk\r\n')).toBe('abcdef0123456789abcdef0123456789');
    expect(parseExpectedMd5('bad\n0123456789abcdef0123456789abcdef  y.apk\n')).toBe(EXPECTED);
    expect(parseExpectedMd5('<html>404</html>')).toBeNull();
    expect(parseExpectedMd5('0123  x.apk')).toBeNull();
    expect(parseExpectedMd5('')).toBeNull();
  });

  it('实际哈希缺失或不一致一律判不符', () => {
    expect(md5Matches(EXPECTED, EXPECTED)).toBe(true);
    expect(md5Matches(EXPECTED, EXPECTED.toUpperCase())).toBe(true);
    expect(md5Matches(EXPECTED, BAD)).toBe(false);
    expect(md5Matches(EXPECTED, null)).toBe(false);
    expect(md5Matches(EXPECTED, undefined)).toBe(false);
    expect(md5Matches(EXPECTED, '')).toBe(false);
  });

  it('字节数文案：未知 / B / MB', () => {
    expect(formatBytes(null)).toBe('未知');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(54975190)).toMatch(/^52\.\d{2} MB$/);
  });
});

describe('应用内下载 + 校验（#725）', () => {
  it('校验通过返回报告：大小 + 预期/实际哈希，下载用 idempotent', async () => {
    h.infoQueue.push({ md5: EXPECTED, size: 54975190 });
    const report = await downloadAndVerifyApk('1.9.1', 'ghfast');
    expect(report.expectedMd5).toBe(EXPECTED);
    expect(report.actualMd5).toBe(EXPECTED);
    expect(report.sizeBytes).toBe(54975190);
    expect(report.sourceId).toBe('ghfast');
    expect(report.attempts.map((a) => a.status)).toEqual(['ok']);
    expect(h.downloadLog).toHaveLength(1);
    expect(h.downloadLog[0].url).toContain('MPlayer-v1.9.1.apk');
    expect(h.downloadLog[0].idempotent).toBe(true);
    expect(h.started).toHaveLength(0);
  });

  it('MD5 不符：删坏包、换下一通道、成功后返回第二通道', async () => {
    h.infoQueue.push({ md5: BAD, size: 54975190 });
    h.infoQueue.push({ md5: EXPECTED, size: 54975190 });
    const report = await downloadAndVerifyApk('1.9.1', 'ghfast');
    expect(report.sourceId).toBe('gh-proxy');
    expect(report.attempts.map((a) => a.status)).toEqual(['md5-mismatch', 'ok']);
    expect(h.deleteLog).toContain('mplayer-update-ghfast.apk');
    expect(h.downloadLog).toHaveLength(2);
  });

  it('四通道全部坏包 → 抛 ApkIntegrityError，不交给安装器', async () => {
    for (let i = 0; i < 4; i += 1) h.infoQueue.push({ md5: BAD, size: 54975190 });
    try {
      await downloadAndVerifyApk('1.9.1', 'auto');
      expect.unreachable('坏包必须被拦下');
    } catch (e) {
      expect(e).toBeInstanceOf(ApkIntegrityError);
      expect((e as ApkIntegrityError).message).toBe('下载文件损坏，请换通道重试');
      expect((e as ApkIntegrityError).attempts).toHaveLength(4);
      expect((e as ApkIntegrityError).attempts.every((a) => a.status === 'md5-mismatch')).toBe(true);
    }
    expect(h.deleteLog).toHaveLength(4);
    expect(h.started).toHaveLength(0);
  });

  it('取不到 .apk.md5 的通道被跳过，换下一通道', async () => {
    stubFetch(async (url) => (url.includes('ghfast.top') ? ok('<html>404</html>') : ok(md5Line())));
    h.infoQueue.push({ md5: EXPECTED, size: 1024 });
    const report = await downloadAndVerifyApk('1.9.1', 'ghfast');
    expect(report.sourceId).toBe('gh-proxy');
    expect(report.attempts[0].status).toBe('checksum-unavailable');
    expect(h.downloadLog).toHaveLength(1);
  });

  it('下载失败的通道删残留文件并换下一通道', async () => {
    h.downloadFailures.push('ghfast.top');
    h.infoQueue.push({ md5: EXPECTED, size: 1024 });
    const report = await downloadAndVerifyApk('1.9.1', 'ghfast');
    expect(report.sourceId).toBe('gh-proxy');
    expect(report.attempts[0].status).toBe('download-failed');
    expect(h.deleteLog).toContain('mplayer-update-ghfast.apk');
  });

  it('原生 info 抛错按 info-failed 记录并换通道', async () => {
    h.infoQueue.push(new Error('native info failed'));
    h.infoQueue.push({ md5: EXPECTED, size: 1024 });
    const report = await downloadAndVerifyApk('1.9.1', 'ghfast');
    expect(report.attempts[0].status).toBe('info-failed');
    expect(h.deleteLog).toContain('mplayer-update-ghfast.apk');
  });

  it('onProgress / onAttempt 上报下载比例与每通道结果', async () => {
    h.infoQueue.push({ md5: EXPECTED, size: 1024 });
    const progress: number[] = [];
    const seen: string[] = [];
    await downloadAndVerifyApk('1.9.1', 'ghfast', {
      onProgress: (r) => progress.push(r),
      onAttempt: (a) => seen.push(a.status),
    });
    expect(progress).toEqual([0.25]);
    expect(seen).toEqual(['ok']);
  });

  it('.apk.md5 能从 4 个更新源按前缀拼接取到', async () => {
    stubFetch(async () => ok('<html>无校验文件</html>'));
    try { await downloadAndVerifyApk('1.9.1', 'auto'); } catch { /* 全部取不到，预期抛错 */ }
    expect(h.fetchUrls).toHaveLength(4);
    expect(h.fetchUrls.every((u) => u.endsWith('MPlayer-v1.9.1.apk.md5'))).toBe(true);
    expect(new Set(h.fetchUrls.map((u) => new URL(u).hostname)).size).toBe(4);
    expect(h.downloadLog).toHaveLength(0);
  });
});

describe('交给系统安装器（#725）', () => {
  it('ACTION_VIEW + APK MIME + contentUri + FLAG_GRANT_READ_URI_PERMISSION', async () => {
    const file = {
      contentUri: 'content://com.mplayer.mobile.FileSystemFileProvider/cache/base.apk',
    } as unknown as Parameters<typeof launchApkInstaller>[0];
    await launchApkInstaller(file);
    expect(h.started).toEqual([{
      action: 'android.intent.action.VIEW',
      params: {
        type: 'application/vnd.android.package-archive',
        data: 'content://com.mplayer.mobile.FileSystemFileProvider/cache/base.apk',
        flags: 1,
      },
    }]);
  });
});
