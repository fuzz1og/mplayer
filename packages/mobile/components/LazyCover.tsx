/**
 * **不做在飞闸门**（同日提出、实测后撤销，见 ADR `docs/adr/2026-09-30-mobile-cover-loading.md`）。
 * 为什么不设闸门：闸门「先拿槽位再挂图、靠 onLoad/onError 释放」的前提在 Android 上不成立——被裁剪
 * 的离屏 cell 根本不回调；请求失败/悬挂也不回调。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import type { ImageStyle, StyleProp, ViewStyle } from 'react-native';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';

/** 失败后重试的间隔（ms）：一次网络抖动不该在列表里永久留一块灰 */
export const COVER_RETRY_DELAY_MS = 1200;

interface LazyCoverProps {
  /** 封面直链（空值只渲染占位） */
  uri?: string;
  /** 与裸 `<Image>` 同形的样式；占位分支原样套在 `View` 上 */
  style?: StyleProp<ImageStyle>;
  /** 重试一次仍失败时回调（埋点 / 兜底刷新） */
  onError?: () => void;
  resizeMode?: 'cover' | 'contain';
  accessibilityLabel?: string;
  /** CDN 缩略图边长（默认 `COVER_THUMB_SIZE`）：卡片变大时可传更大的值 */
  thumbSize?: number;
}

export default function LazyCover({
  uri,
  style,
  onError,
  resizeMode = 'cover',
  accessibilityLabel,
  thumbSize = COVER_SIZE.thumb,
}: LazyCoverProps) {
  /** 第几次挂载：0 = 首挂，1 = 重试。作为 `key` 强制重新发起请求 */
  const [attempt, setAttempt] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 换图 = 换一次机会：重置重试状态，并清掉挂起的重试
  useEffect(() => {
    setAttempt(0);
    return () => {
      if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [uri]);

  const handleError = useCallback(() => {
    if (attempt === 0) {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => { timerRef.current = null; setAttempt(1); }, COVER_RETRY_DELAY_MS);
      return;
    }
    onError?.();
  }, [attempt, onError]);

  if (!uri) {
    // ImageStyle 与 ViewStyle 的差异只在 resizeMode / tintColor 这类图片专有字段，
    // 各调用点传的都是尺寸 / 圆角 / 底色 —— 运行时同形。
    return (
      <View
        style={style as StyleProp<ViewStyle>}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }

  return (
    <Image
      key={attempt}
      source={{ uri: coverThumbUrl(uri, thumbSize) }}
      style={style}
      resizeMode={resizeMode}
      accessibilityLabel={accessibilityLabel}
      onError={handleError}
    />
  );
}
