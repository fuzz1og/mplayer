import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  describeDjRadioSearchFailure,
  describeDjRadioFailure,
  isRateLimitedCode,
  isRateLimitedMessage,
  upstreamCodeHint,
} from '../djRadioErrors.js';

const ROOT = path.resolve(__dirname, '..');

describe('DJ 电台错误归因单一落点（#742）', () => {
  it('405/406 共用同一份限流文案，其余 code 保留上游提示', () => {
    expect(isRateLimitedCode(405)).toBe(true);
    expect(isRateLimitedCode(406)).toBe(true);
    expect(isRateLimitedCode(400)).toBe(false);
    expect(upstreamCodeHint(405, 'upstream')).toBe('操作频繁，请稍后重试');
    expect(upstreamCodeHint(406, 'upstream')).toBe('操作频繁，请稍后重试');
    expect(upstreamCodeHint(400, '参数错误')).toBe('参数错误');
  });

  it('三态失败按 404 / 406 / 网络错误 / unsupported 分屏', () => {
    expect(describeDjRadioFailure('not-found')).toBe('电台不存在');
    expect(describeDjRadioFailure('failed', 'code=406 操作频繁')).toBe('操作频繁，请稍后重试');
    expect(describeDjRadioFailure('failed', 'ECONNRESET')).toBe('加载失败');
    expect(describeDjRadioFailure('unsupported')).toBe('源不支持');
    expect(isRateLimitedMessage('cloudsearch code=405')).toBe(true);
  });

  it('搜索失败区分限流、源不支持与网络错误', () => {
    expect(describeDjRadioSearchFailure('cloudsearch code=406 操作频繁，请稍后重试'))
      .toBe('操作频繁，请稍后重试');
    expect(describeDjRadioSearchFailure('源 netease 未实现内容能力 searchDjRadios'))
      .toBe('源不支持');
    expect(describeDjRadioSearchFailure('client.searchDjRadios is not a function'))
      .toBe('源不支持');
    expect(describeDjRadioSearchFailure('network down')).toBe('network down');
  });

  it('neteaseDirect 不再手写 405/406 归因或 firstArray 旧名', () => {
    const source = fs.readFileSync(path.join(ROOT, 'neteaseDirect.ts'), 'utf8');
    expect(source).not.toMatch(/code === 405\s*\|\|/);
    expect(source).not.toMatch(/\bfirstArray\(/);
    expect(source).toContain('firstArrayField');
    expect(source).toContain('isRateLimitedCode');
  });
});
