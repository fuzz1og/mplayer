import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkTrustedSenderFrame, isTrustedSenderUrl } from '@/main/ipc/trustedSender';

const DIST = process.platform === 'win32' ? 'C:\\app\\dist' : '/app/dist';
const fileUrl = (target: string): string => pathToFileURL(target).href;
const distFile = (name: string): string => fileUrl(path.join(DIST, name));

function frame(url: string): Electron.WebFrameMain {
  return { url } as Electron.WebFrameMain;
}

describe('IPC sender 收紧：dist / dev 同源（#766）', () => {
  it('接受 dist 下的 file:// 页面', () => {
    expect(isTrustedSenderUrl(distFile('index.html'), { distDir: DIST })).toBe(true);
    expect(isTrustedSenderUrl(distFile('lyric-overlay.html'), { distDir: DIST })).toBe(true);
  });

  it('拒绝 dist 之外的 file:// 与同前缀伪装目录', () => {
    expect(isTrustedSenderUrl(fileUrl(path.resolve(DIST, '..', 'evil.html')), { distDir: DIST })).toBe(false);
    expect(isTrustedSenderUrl(fileUrl(`${DIST}-evil${path.sep}index.html`), { distDir: DIST })).toBe(false);
    expect(isTrustedSenderUrl(fileUrl(DIST), { distDir: DIST })).toBe(false);
  });

  it('dev 只认同源，前缀伪装与其它端口都不行', () => {
    const options = { devServerUrl: 'http://localhost:5174', distDir: DIST };
    expect(isTrustedSenderUrl('http://localhost:5174/#/hotlist', options)).toBe(true);
    expect(isTrustedSenderUrl('http://localhost:5174.evil.example/', options)).toBe(false);
    expect(isTrustedSenderUrl('http://localhost:5175/', options)).toBe(false);
    expect(isTrustedSenderUrl('https://localhost:5174/', options)).toBe(false);
  });

  it('无 URL / 非 http(s) 协议不信任', () => {
    expect(isTrustedSenderUrl('', { distDir: DIST })).toBe(false);
    expect(isTrustedSenderUrl('about:blank', { distDir: DIST })).toBe(false);
    expect(isTrustedSenderUrl('not a url', { distDir: DIST })).toBe(false);
  });

  it('无 senderFrame（测试直调）放行，有 frame 越界返回错误', () => {
    expect(checkTrustedSenderFrame(null, { distDir: DIST })).toBeNull();
    const outside = fileUrl(path.resolve(DIST, '..', 'evil.html'));
    expect(checkTrustedSenderFrame(frame(outside), { distDir: DIST })).toContain('不受信任');
  });
});
