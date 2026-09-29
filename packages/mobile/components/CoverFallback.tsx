/**
 * 兜底封面（#465）：给「源拿不到封面」的实体**生成**一张确定性封面。
 *
 * 为什么是生成而不是塞一张位图：需要一个处处可用、主题自适应、不随裁切比例失真的缺省视觉。
 * 典型来源是 Q 音榜单——它的榜单索引接口匿名恒拒（code 500005，qqDirect 实测记录），
 * 只有日更接口的 update_time，没有封面字段。**空封面不是加载失败**，不该渲染成破图或错误态。
 *
 * 确定性算法在 coverFallbackSeed.ts（纯内核、node 可测）；这里只做渲染。
 */
import React, { useMemo } from 'react';
import { Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { coverGlyph, pickFallbackPalette } from './coverFallbackSeed';

export default function CoverFallback({ name, label }: { name: string; label?: string }) {
  const palette = useMemo(() => pickFallbackPalette(name), [name]);
  const glyph = useMemo(() => coverGlyph(name), [name]);

  return (
    <LinearGradient
      colors={[palette[0], palette[1]]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.fill}
    >
      <Text style={styles.glyph}>{glyph}</Text>
      {label ? <Text style={styles.label} numberOfLines={1}>{label}</Text> : null}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fill: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  glyph: { color: 'rgba(255,255,255,0.92)', fontSize: 96, fontWeight: '700' }, // design-lint: ok 压在生成封面插画上的前景字（非主题表面色）
  label: { position: 'absolute', left: 16, bottom: 16, fontSize: 12, color: 'rgba(255,255,255,0.85)' }, // design-lint: ok 同上
});
