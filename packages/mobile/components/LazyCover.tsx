/**
 * 过闸封面：**先拿到槽位，再挂 `<Image>`**。闸门见 `services/coverLoadGate.ts`。
 *
 * 与裸 `<Image source={{ uri }}>` 的两点差异：
 * 1. 未拿到槽位时只渲染一块同 style 的空 `View`——与「Image 已挂、图还没到」在视觉上
 *    完全一致（各调用点的封面 style 本来就有底色/圆角），不会二次布局跳动；
 * 2. `onLoad` / `onError` / 卸载三处都归还槽位（闸门侧 `release()` 幂等）。
 *
 * **不经过它**的是首屏关键封面：Hero、迷你播放栏、全屏播放器。那几处一屏只有一张，
 * 过闸只会平白给首帧加一段排队等待。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import type { ImageStyle, StyleProp, ViewStyle } from 'react-native';
import { coverLoadGate, type CoverSlot } from '../services/coverLoadGate';

interface LazyCoverProps {
  /** 封面直链（空值只渲染占位，不占槽位——调用方一般已在外层判过空） */
  uri?: string;
  /** 与裸 `<Image>` 同形的样式；占位分支原样套在 `View` 上 */
  style?: StyleProp<ImageStyle>;
  /** 加载失败回调（埋点 / 兜底刷新） */
  onError?: () => void;
  resizeMode?: 'cover' | 'contain';
  accessibilityLabel?: string;
}

export default function LazyCover({
  uri,
  style,
  onError,
  resizeMode = 'cover',
  accessibilityLabel,
}: LazyCoverProps) {
  const [granted, setGranted] = useState(false);
  const slotRef = useRef<CoverSlot | null>(null);

  useEffect(() => {
    if (!uri) {
      setGranted(false);
      slotRef.current = null;
      return;
    }
    let alive = true;
    const slot = coverLoadGate.acquire();
    slotRef.current = slot;
    setGranted(false);
    void slot.ready.then(() => {
      // 卸载后才到手：不算「已占位」，直接还给队列，也不 setState
      if (!alive) { slot.release(); return; }
      setGranted(true);
    });
    return () => {
      alive = false;
      slot.release();
      if (slotRef.current === slot) slotRef.current = null;
    };
  }, [uri]);

  const finish = useCallback(() => {
    slotRef.current?.release();
    slotRef.current = null;
  }, []);

  if (!uri || !granted) {
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
      source={{ uri }}
      style={style}
      resizeMode={resizeMode}
      accessibilityLabel={accessibilityLabel}
      onLoad={finish}
      onError={() => { finish(); onError?.(); }}
    />
  );
}
