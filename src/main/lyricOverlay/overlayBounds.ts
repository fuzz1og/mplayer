import type { Display, Rectangle } from 'electron';

/** `floatingLyricsBounds`：键 = display.id 字符串，值 = getBounds() 外框（#761 / #769）。 */
export type FloatingLyricsBoundsRecord = Record<string, Rectangle>;

/** 默认位距离 workArea 底边的留白（实现值，视觉微调不需要新 ADR）。 */
export const LYRIC_OVERLAY_BOTTOM_MARGIN = 24;

export function defaultBoundsForDisplay(
  workArea: Rectangle,
  size: { width: number; height: number },
): Rectangle {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + workArea.height - height - LYRIC_OVERLAY_BOTTOM_MARGIN,
    width,
    height,
  };
}

export function clampBoundsToWorkArea(bounds: Rectangle, workArea: Rectangle): Rectangle {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const x = Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width);
  const y = Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height);
  return { x, y, width, height };
}

/** 恢复：记录左上角 + 当前字号档位的新尺寸，再夹进该屏 workArea；无记录走默认位。 */
export function resolveBounds(
  record: Rectangle | undefined,
  workArea: Rectangle,
  size: { width: number; height: number },
): Rectangle {
  if (!record) return defaultBoundsForDisplay(workArea, size);
  return clampBoundsToWorkArea({ x: record.x, y: record.y, ...size }, workArea);
}

/** 窗口中心所在显示器；中心落空按相交；再兜底主屏。 */
export function displayContainingBounds(
  bounds: Rectangle,
  displays: readonly Display[],
  fallback: Display,
): Display {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const containsCenter = (display: Display): boolean => {
    const area = display.workArea;
    return (
      centerX >= area.x &&
      centerX <= area.x + area.width &&
      centerY >= area.y &&
      centerY <= area.y + area.height
    );
  };
  const intersects = (display: Display): boolean => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  };
  return displays.find(containsCenter) ?? displays.find(intersects) ?? fallback;
}

function isFiniteRectangle(value: unknown): value is Rectangle {
  if (!value || typeof value !== 'object') return false;
  const rect = value as Record<string, unknown>;
  return (['x', 'y', 'width', 'height'] as const).every(
    (key) => typeof rect[key] === 'number' && Number.isFinite(rect[key]),
  );
}

/** 坏数据 / 未知显示器一律按无记录处理（#769）。 */
export function sanitizeStoredBounds(value: unknown): FloatingLyricsBoundsRecord {
  if (!value || typeof value !== 'object') return {};
  const record: FloatingLyricsBoundsRecord = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!isFiniteRectangle(entry)) continue;
    if (entry.width <= 0 || entry.height <= 0) continue;
    record[key] = { x: entry.x, y: entry.y, width: entry.width, height: entry.height };
  }
  return record;
}
