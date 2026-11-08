/** 网易 body.code 限流归因：405/406 同属「操作频繁」，文案只在这里定义。 */
export function isRateLimitedCode(code: unknown): boolean {
  const value = Number(code) || 0;
  return value === 405 || value === 406;
}

/** IPC/门面可能只带错误 message；从 body.code 文案里恢复限流语义。 */
export function isRateLimitedMessage(message: unknown): boolean {
  const text = String(message ?? '');
  const code = Number(/code=(\d+)/.exec(text)?.[1]);
  return isRateLimitedCode(code) || text.includes('操作频繁');
}

/** cloudsearch 与 djradio 的 body.code 失败共用一份可读提示。 */
export function upstreamCodeHint(code: unknown, upstream: unknown): string {
  if (isRateLimitedCode(code)) return '操作频繁，请稍后重试';
  return typeof upstream === 'string' ? upstream.trim() : '';
}

const UNSUPPORTED_MARKERS = [
  '未实现内容能力',
  'is not a function',
  'Cannot read properties of undefined',
];

/** 搜索腿只带 message；限流、源不支持与网络失败各给一类可读文案。 */
export function describeDjRadioSearchFailure(message: unknown): string {
  const text = String(message ?? '').trim();
  if (isRateLimitedMessage(text)) return '操作频繁，请稍后重试';
  if (UNSUPPORTED_MARKERS.some((marker) => text.includes(marker))) return '源不支持';
  return text || '加载失败';
}

export function upstreamCodeError(operation: string, code: unknown, upstream?: unknown): Error {
  const hint = upstreamCodeHint(code, upstream);
  const normalizedCode = Number(code) || 0;
  return new Error(`${operation} (code=${normalizedCode}${hint ? `, ${hint}` : ''})`);
}

/** DJ 电台三态失败的双端文案：404 / 406 / 网络失败 / 不支持各走一屏。 */
export function describeDjRadioFailure(
  reason: 'unsupported' | 'not-found' | 'failed' | undefined,
  message?: unknown,
): string {
  if (reason === 'not-found') return '电台不存在';
  if (reason === 'unsupported') return '源不支持';
  if (isRateLimitedMessage(message)) return '操作频繁，请稍后重试';
  return '加载失败';
}
