// WSLg 下 Electron 窗口 HiDPI 修复
//
// 背景：WSLg（Weston）不会把 Windows 的显示缩放透传给客户端（weston.log
// 恒为 `scale:1, clientScale:1.00`，见 microsoft/wslg#1335、#23），导致
// 4K 屏 + Windows 150% 缩放时 Chromium 拿到 scaleFactor=1，1400×900 的
// 窗口以 1:1 物理像素渲染在 4K 屏上，看起来极小。
//
// 解法：读取 Windows 注册表 `HKCU\Control Panel\Desktop\WindowMetrics`
// 的 AppliedDPI（144=150%），换算为缩放系数，用 --force-device-scale-factor
// 强制 Chromium 原生按该系数光栅化（文字清晰，不是 Xwayland 事后放大）。
//
// 仅在 Linux + WSL 下生效；纯 Linux 桌面 Chromium 能自动检测缩放，跳过。
// 兜底：环境变量 MPLAYER_UI_SCALE=1.5 可手动覆盖缩放系数。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { app } from 'electron';

/** 内核版本串中识别 WSL 的标记（WSL2 形如 "6.6.87.2-microsoft-standard-WSL2"） */
export const WSL_KERNEL_MARKER = /microsoft/i;

/** 纯函数：内核版本串是否为 WSL（便于单测） */
export function isWslKernel(kernel: string): boolean {
  return WSL_KERNEL_MARKER.test(kernel);
}

/** 读取 /proc/sys/kernel/osrelease 判断是否运行在 WSL 中 */
export function isWsl(): boolean {
  try {
    return isWslKernel(fs.readFileSync('/proc/sys/kernel/osrelease', 'utf8'));
  } catch {
    return false;
  }
}

/**
 * 解析 reg.exe 输出中的 AppliedDPI 值。
 * 例：`    AppliedDPI    REG_DWORD    0x90` → 144
 * 兼容十六进制（REG_DWORD 默认 0x…）与十进制、UTF-8 BOM、CRLF。
 */
export function parseAppliedDpi(regOutput: string): number | null {
  const clean = regOutput.replace(/^\uFEFF/, '');
  const line = clean.split(/\r?\n/).find((l) => /AppliedDPI/i.test(l));
  if (!line) return null;
  const match = line.match(/0[xX]([0-9a-fA-F]+)|\b(\d{2,4})\b/);
  if (!match) return null;
  const dpi = Number.parseInt(match[1] ?? match[2], match[1] ? 16 : 10);
  return Number.isFinite(dpi) && dpi > 0 ? dpi : null;
}

/**
 * Windows DPI → Chromium 缩放系数。
 * 96=100% / 120=125% / 144=150% / 192=200%；≤100% 或超出 (1, 4] 返回 null（无需强制）。
 */
export function dpiToScaleFactor(dpi: number): number | null {
  const scale = Math.round((dpi / 96) * 100) / 100;
  return scale > 1.01 && scale <= 4 ? scale : null;
}

/** 手动覆盖：MPLAYER_UI_SCALE=1.5（注册表读取失败等场景的兜底） */
export function envScaleOverride(): number | null {
  const raw = process.env.MPLAYER_UI_SCALE;
  if (!raw) return null;
  const scale = Number(raw);
  return Number.isFinite(scale) && scale > 1.01 && scale <= 4 ? scale : null;
}

/** 读取 Windows 当前 DPI 缩放（AppliedDPI），失败返回 null */
export function readWindowsAppliedDpi(): number | null {
  // WSL 非交互 shell 的 PATH 未必包含 Windows 目录，先试全路径
  const fullPath = '/mnt/c/Windows/System32/reg.exe';
  const candidates = fs.existsSync(fullPath) ? [fullPath, 'reg.exe'] : ['reg.exe'];
  for (const cmd of candidates) {
    try {
      const out = execFileSync(
        cmd,
        ['query', 'HKCU\\Control Panel\\Desktop\\WindowMetrics', '/v', 'AppliedDPI'],
        { encoding: 'utf8', timeout: 2000, windowsHide: true }
      );
      const dpi = parseAppliedDpi(out);
      if (dpi !== null) return dpi;
    } catch {
      // 尝试下一个候选
    }
  }
  return null;
}

/**
 * 入口：app ready 之前同步调用。
 * WSL + Windows 缩放 >100% 时设置 --force-device-scale-factor 并返回系数；
 * 其他环境（非 Linux / 非 WSL / 100% 缩放 / 读取失败）跳过，返回 null。
 */
export function applyWslHidpiFix(): number | null {
  if (process.platform !== 'linux' || !isWsl()) return null;

  const scale = envScaleOverride() ?? (() => {
    const dpi = readWindowsAppliedDpi();
    return dpi === null ? null : dpiToScaleFactor(dpi);
  })();

  if (scale === null) return null;
  // 防御：测试环境（vitest 的 electron mock）可能没有 commandLine
  if (!app.commandLine || typeof app.commandLine.appendSwitch !== 'function') return null;
  app.commandLine.appendSwitch('force-device-scale-factor', String(scale));
  console.log(`[hidpi] WSL 检测到 Windows 缩放 ${Math.round(scale * 100)}%，强制 device-scale-factor=${scale}`);
  return scale;
}
