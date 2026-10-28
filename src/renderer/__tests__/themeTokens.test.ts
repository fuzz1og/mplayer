import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** #698 语义 token 契约：三套主题块都要有强调色文字/媒体叠字/真反色文字，暗色浮层亮于卡片，滚动条走 token。
 * 读 token 事实源守门；实际渲染对比度由 shots-698 的 Playwright 脚本测。 */
const testDir = dirname(fileURLToPath(String(import.meta.url)));
const css = readFileSync(join(testDir, '..', 'styles', 'global.css'), 'utf8');

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function blockOf(selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error('缺少主题块：' + selector);
  let depth = 0;
  let opened = false;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') {
      depth += 1;
      opened = true;
    } else if (css[i] === '}') {
      depth -= 1;
      if (opened && depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error('主题块未闭合：' + selector);
}

const light = blockOf(':root {');
const darkSystem = blockOf(":root:not([data-theme='light'])");
const darkManual = blockOf(":root[data-theme='dark']");

function token(block: string, name: string): string {
  const match = block.match(new RegExp('--' + name + ':\\s*([^;]+);'));
  if (!match) throw new Error('缺少 token：--' + name);
  return match[1].trim();
}

function resolve(value: string, block: string): string {
  let current = value.trim();
  for (let i = 0; i < 5; i++) {
    const reference = current.match(/^var\((--[\w-]+)\)$/);
    if (!reference) break;
    const local = block.match(new RegExp('--' + reference[1].slice(2) + ':\\s*([^;]+);'));
    const root = light.match(new RegExp('--' + reference[1].slice(2) + ':\\s*([^;]+);'));
    const next = local?.[1].trim() ?? root?.[1].trim();
    if (!next) break;
    current = next;
  }
  return current;
}

function parseColor(raw: string): Rgba {
  const value = raw.trim();
  const hex = value.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3) digits = digits.split('').map((c) => c + c).join('');
    const channel = (offset: number) => parseInt(digits.slice(offset, offset + 2), 16);
    return {
      r: channel(0),
      g: channel(2),
      b: channel(4),
      a: digits.length === 8 ? channel(6) / 255 : 1,
    };
  }
  const rgba = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  if (!rgba) throw new Error('无法解析颜色：' + raw);
  return {
    r: Number(rgba[1]),
    g: Number(rgba[2]),
    b: Number(rgba[3]),
    a: rgba[4] === undefined ? 1 : Number(rgba[4]),
  };
}

function luminance(color: Rgba): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  return {
    r: foreground.r * foreground.a + background.r * (1 - foreground.a),
    g: foreground.g * foreground.a + background.g * (1 - foreground.a),
    b: foreground.b * foreground.a + background.b * (1 - foreground.a),
    a: 1,
  };
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function colorOf(block: string, name: string): Rgba {
  return parseColor(resolve(token(block, name), block));
}

describe('语义 token（#698）', () => {
  it('浅色/系统暗色/手动暗色三处都定义强调色文字、媒体文字与真反色文字', () => {
    for (const block of [light, darkSystem, darkManual]) {
      for (const name of ['accent-text', 'text-on-media', 'text-on-accent']) {
        expect(token(block, name), '--' + name + ' 缺失').toBeTruthy();
      }
    }
    // 媒体叠字在浅色主题下不能是深色（封面/hero 图上的白字）
    expect(luminance(colorOf(light, 'text-on-media'))).toBeGreaterThan(0.7);
    expect(luminance(colorOf(darkSystem, 'text-on-media'))).toBeGreaterThan(0.7);
    expect(luminance(colorOf(darkManual, 'text-on-media'))).toBeGreaterThan(0.7);
    // 真反色文字在 accent 实底上必须是浅色
    expect(luminance(colorOf(light, 'text-on-accent'))).toBeGreaterThan(0.7);
    expect(luminance(colorOf(darkSystem, 'text-on-accent'))).toBeGreaterThan(0.7);
    expect(luminance(colorOf(darkManual, 'text-on-accent'))).toBeGreaterThan(0.7);
  });

  it('暗色浮层表面亮于其下卡片：bg-elevated 与 material-overlay 都高于 surface-card', () => {
    for (const block of [darkSystem, darkManual]) {
      const card = colorOf(block, 'surface-card');
      const elevated = colorOf(block, 'bg-elevated');
      const overlay = composite(colorOf(block, 'material-overlay'), colorOf(block, 'surface-content'));
      expect(luminance(elevated), '--bg-elevated 必须亮于 --surface-card').toBeGreaterThan(luminance(card));
      expect(luminance(overlay), '--material-overlay 必须亮于 --surface-card').toBeGreaterThan(luminance(card));
    }
  });

  it('滚动条使用语义 token，暗色不再复用 gray-300', () => {
    for (const block of [light, darkSystem, darkManual]) {
      expect(token(block, 'scrollbar-thumb')).toBeTruthy();
      expect(token(block, 'scrollbar-thumb-hover')).toBeTruthy();
    }
    for (const block of [darkSystem, darkManual]) {
      expect(token(block, 'scrollbar-thumb')).not.toContain('gray-300');
      expect(token(block, 'scrollbar-thumb-hover')).not.toContain('gray-300');
    }
  });

  it('强调色文字在浅色/暗色卡片上的对比度都不低于 4.5:1', () => {
    expect(contrast(colorOf(light, 'accent-text'), colorOf(light, 'surface-card'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colorOf(darkSystem, 'accent-text'), colorOf(darkSystem, 'surface-card'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colorOf(darkManual, 'accent-text'), colorOf(darkManual, 'surface-card'))).toBeGreaterThanOrEqual(4.5);
  });

  it('accent 实底上的真反色文字（暗色主按钮）对比度不低于 4.5:1', () => {
    for (const block of [light, darkSystem, darkManual]) {
      expect(contrast(colorOf(block, 'text-on-accent'), colorOf(block, 'accent-fill'))).toBeGreaterThanOrEqual(4.5);
    }
  });
});
