import { describe, it, expect, vi, afterEach } from 'vitest';
import { isWslKernel, parseAppliedDpi, dpiToScaleFactor, envScaleOverride } from '@/main/hidpi';

describe('isWslKernel', () => {
  it('识别 WSL2 内核', () => {
    expect(isWslKernel('6.6.87.2-microsoft-standard-WSL2')).toBe(true);
    expect(isWslKernel('5.15.133.1-microsoft-standard-WSL2')).toBe(true);
  });

  it('拒绝普通 Linux 内核', () => {
    expect(isWslKernel('6.8.0-45-generic')).toBe(false);
    expect(isWslKernel('')).toBe(false);
  });
});

describe('parseAppliedDpi', () => {
  it('解析 reg.exe 十六进制输出（0x90 = 144 = 150%）', () => {
    const out = 'HKEY_CURRENT_USER\\Control Panel\\Desktop\\WindowMetrics\r\n    AppliedDPI    REG_DWORD    0x90\r\n';
    expect(parseAppliedDpi(out)).toBe(144);
  });

  it('兼容 UTF-8 BOM 与大小写', () => {
    expect(parseAppliedDpi('\uFEFF    appliedDPI    REG_DWORD    0X90')).toBe(144);
  });

  it('解析十进制输出', () => {
    expect(parseAppliedDpi('    AppliedDPI    REG_DWORD    144')).toBe(144);
  });

  it('无匹配时返回 null', () => {
    expect(parseAppliedDpi('')).toBeNull();
    expect(parseAppliedDpi('    nothing here')).toBeNull();
    expect(parseAppliedDpi('    AppliedDPI    REG_DWORD    ERROR')).toBeNull();
  });
});

describe('dpiToScaleFactor', () => {
  it('覆盖常见 Windows 缩放档位', () => {
    expect(dpiToScaleFactor(120)).toBe(1.25);
    expect(dpiToScaleFactor(144)).toBe(1.5);
    expect(dpiToScaleFactor(168)).toBe(1.75);
    expect(dpiToScaleFactor(192)).toBe(2);
  });

  it('100% 或非法值不需要强制', () => {
    expect(dpiToScaleFactor(96)).toBeNull();
    expect(dpiToScaleFactor(0)).toBeNull();
    expect(dpiToScaleFactor(500)).toBeNull();
  });
});

describe('envScaleOverride', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('读取有效覆盖值', () => {
    vi.stubEnv('MPLAYER_UI_SCALE', '1.5');
    expect(envScaleOverride()).toBe(1.5);
    vi.stubEnv('MPLAYER_UI_SCALE', '2');
    expect(envScaleOverride()).toBe(2);
  });

  it('忽略非法值', () => {
    vi.stubEnv('MPLAYER_UI_SCALE', 'abc');
    expect(envScaleOverride()).toBeNull();
    vi.stubEnv('MPLAYER_UI_SCALE', '1');
    expect(envScaleOverride()).toBeNull();
    vi.stubEnv('MPLAYER_UI_SCALE', '5');
    expect(envScaleOverride()).toBeNull();
  });

  it('未设置时返回 null', () => {
    expect(envScaleOverride()).toBeNull();
  });
});
