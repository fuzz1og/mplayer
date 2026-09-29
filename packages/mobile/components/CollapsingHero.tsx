/**
 * 通用折叠 Hero — 详情页全出血封面方案（歌单 D 变体推广到专辑/歌手/网络歌单）
 *
 * 结构（自上而下）：
 *   1. 大封面全出血到状态栏/灵动岛安全区后面，随列表滚动滚出屏幕；
 *      底缘叠 bgBase 雾化条向上淡出（#259 决议转正，硬切 → 雾化渐隐）
 *   2. 悬浮导航栏：顶部透明（盖在封面上）→ 下滑盖过封面后逐渐变为
 *      实心正常标题栏（标题淡入、返回按钮变深色），上滑恢复
 *   3. 信息区在封面下方独立实心区域（不叠封面、不透明）
 *   4. 可选表头（如「歌曲 / 操作」）+ 列表
 *
 * 分层：阈值数学/边沿检测在 components/collapsingChrome.ts（纯逻辑，node 可测），
 * 滚动 → chrome 的原生驱动接线在 hooks/useCollapsingChrome.ts，本文件只剩结构与样式。
 *
 * 封面来源由调用方决定（自建歌单=第一首歌、专辑=专辑图、歌手=头像、
 * 网络歌单=自己的封面）；加载失败自动切占位图标，并回调 onCoverError
 * 供调用方做刷新。
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Animated,
} from 'react-native';
import type { FlatListProps, ListRenderItem } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Music2, Play, ArrowLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { radius, spacing, typography } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { COVER_FOG_H } from './collapsingChrome';
import { useCollapsingChrome } from '../hooks/useCollapsingChrome';
import ScalePress from './ScalePress';
import { listWindowProps } from './listWindow';

/** 返回图标压在封面上的颜色（旧 color 插值起点色；深色主题下 textInverse 是深色，不能替代） */
const BACK_ICON_ON_COVER = '#FFFFFF'; // design-lint: ok 折叠头部返回图标起点色：白

/**
 * Animated.FlatList 的 AnimatedProps 条件类型在泛型组件里推不出 data（T[] 被判成
 * ArrayLike<T> 的映射类型），按 FlatListProps<T> 收口；运行时仍是 Animated.FlatList ——
 * VirtualizedList 要求 native onScroll 的宿主组件包这一层（详见组件内注释）。
 */
const HeroFlatList = Animated.FlatList as unknown as <T>(props: FlatListProps<T>) => React.ReactElement;

interface CollapsingHeroProps<T> {
  /** 封面 URL（调用方决定来源） */
  cover?: string;
  /** 封面加载失败回调（可刷新封面） */
  onCoverError?: () => void;
  /** 无封面/加载失败占位图标（默认音符） */
  fallbackIcon?: React.ReactNode;
  /**
   * 整块兜底封面（#465）：`cover` 为空或加载失败时**铺满封面区**渲染它，优先于 `fallbackIcon`。
   * 用于「该源根本没有封面」（如 Q 音榜单：榜单索引接口匿名恒拒）——给一张生成封面，
   * 而不是一个居中的音符图标。
   */
  coverFallback?: React.ReactNode;
  /** 折叠后的导航标题 */
  navTitle: string;
  /** 悬浮导航栏右侧动作插槽（铅笔等页面动作；headerShown:false 后 Stack headerRight 不渲染） */
  navRight?: React.ReactNode;
  /** 信息区大标题 */
  title: string;
  /** 副标题（歌手/创建者） */
  subtitle?: string;
  /** 元信息（"8 首"、"2024 · 8 首"） */
  meta?: string;
  /**
   * 指标行（#406 二期）：与 `meta` 同位置，但按 ` · ` 拆成多项并挂
   * `tabular-nums`（"2025 · 15 首 · 52 分钟" 这类含数字的排，等宽数字才不会跳列）。
   * 给了 `metaItems` 就忽略 `meta`。
   */
  metaItems?: string[];
  /** 章节头（#406 二期）：信息区与列表之间的「歌曲 · N 首」，用来收口灰/白接缝 */
  sectionHeader?: string;
  /**
   * 信息区改用 `bgSurface`（#406 二期）。默认 false = 保持既有四页观感不变；
   * 专辑页置真，消除「信息区灰底 → 第一行白底」的横向灰带。
   */
  surface?: boolean;
  /** 标签行（网络歌单） */
  tags?: string[];
  /** 播放按钮文字 */
  actionLabel?: string;
  /** 播放回调 */
  onAction?: () => void;
  /** 列表数据 */
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: ListRenderItem<T>;
  /** 表头（歌曲/操作） */
  listHeader?: React.ReactElement | null;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  ListFooterComponent?: React.ReactElement | null;
  /** 空列表兜底（列表为空且无封面时仍显示信息区） */
  ListEmptyComponent?: React.ReactElement | null;
}

export default function CollapsingHero<T>({
  cover,
  onCoverError,
  fallbackIcon,
  coverFallback,
  navTitle,
  navRight,
  title,
  subtitle,
  meta,
  metaItems,
  sectionHeader,
  surface,
  tags,
  actionLabel,
  onAction,
  data,
  keyExtractor,
  renderItem,
  listHeader,
  onEndReached,
  onEndReachedThreshold,
  ListFooterComponent,
  ListEmptyComponent,
}: CollapsingHeroProps<T>) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { chrome, onScroll, navBg, fade, statusStyle } = useCollapsingChrome();
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => setCoverFailed(false), [cover]);

  const handleCoverError = () => {
    setCoverFailed(true);
    onCoverError?.();
  };

  const showCover = cover && !coverFailed;

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={statusStyle} />

      {/* 悬浮导航栏：顶部透明（盖在封面上）→ 下滑后实心正常标题栏 */}
      <Animated.View
        style={[
          styles.nav,
          { paddingTop: insets.top, height: chrome.navH + insets.top, backgroundColor: navBg },
        ]}
      >
        <ScalePress style={styles.navBack} onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          {/* 返回图标换色 = 两层同形图标叠加：底层恒为不透明白，上层 textPrimary 用
              原生驱动的 opacity 0→1 覆盖。合成色 = 白·(1-p) + textPrimary·p，
              与旧的 color 插值逐值相同，但颜色插值只在原生侧结算，不再每帧重建组件。 */}
          <View>
            <ArrowLeft size={22} color={BACK_ICON_ON_COVER} />
            <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: fade }]}>
              <ArrowLeft size={22} color={colors.textPrimary} />
            </Animated.View>
          </View>
        </ScalePress>
        <Animated.Text style={[styles.navTitle, { opacity: fade }]} numberOfLines={1}>
          {navTitle}
        </Animated.Text>
        {/* 页面动作插槽（如歌单重命名铅笔）：原 headerShown:false 后 Stack headerRight 不渲染 */}
        {navRight}
      </Animated.View>

      {/* 列表：封面是列表第一块内容（含状态栏区域），随滚动滚出屏幕。
          Animated.FlatList + 原生驱动 scrollY：VirtualizedList 要求 native onScroll
          的宿主组件由 Animated.createAnimatedComponent 包一层。 */}
      <HeroFlatList
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        // 窗口档位与 SongList 同源（#411）。这里**不给 getItemLayout**：
        // 列表头是可折叠 Hero（高度随封面/标签/滚动变），算错的偏移比不给更糟。
        {...listWindowProps}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onEndReached={onEndReached}
        onEndReachedThreshold={onEndReachedThreshold}
        ListFooterComponent={ListFooterComponent ?? undefined}
        ListEmptyComponent={ListEmptyComponent ?? undefined}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <View>
            {/* 全出血封面（底缘雾化条与信息区/页面底色衔接） */}
            <View style={{ height: chrome.coverH }}>
              {showCover ? (
                <Image
                  source={{ uri: cover }}
                  style={styles.coverImg}
                  resizeMode="cover"
                  onError={handleCoverError}
                />
              ) : coverFallback ? (
                <View style={styles.coverImg}>{coverFallback}</View>
              ) : (
                <View style={styles.coverFallback}>
                  {fallbackIcon ?? <Music2 size={72} color={colors.textInverse} />}
                </View>
              )}
              <LinearGradient
                pointerEvents="none"
                colors={['transparent', colors.bgBase]}
                style={styles.coverFog}
              />
            </View>
            {/* 信息区：封面下方独立实心区域（不叠封面、不透明） */}
            <View style={[styles.info, surface ? styles.infoSurface : null]}>
              <Text style={styles.title} numberOfLines={2}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
              {metaItems && metaItems.length > 0 ? (
                <Text style={styles.metaItems} numberOfLines={1}>{metaItems.join(' · ')}</Text>
              ) : meta ? (
                <Text style={styles.meta}>{meta}</Text>
              ) : null}
              {tags && tags.length > 0 ? (
                <View style={styles.tagsRow}>
                  {tags.map((t) => (
                    <View key={t} style={styles.tag}>
                      <Text style={styles.tagText}>{t}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              {actionLabel && onAction ? (
                <ScalePress style={styles.playBtn} onPress={onAction}>
                  <Play size={18} color={colors.textInverse} fill={colors.textInverse} />
                  <Text style={styles.playText}>{actionLabel}</Text>
                </ScalePress>
              ) : null}
            </View>
            {sectionHeader ? (
              <View style={[styles.sectionHeader, surface ? styles.sectionHeaderSurface : null]}>
                <Text style={styles.sectionHeaderText}>{sectionHeader}</Text>
              </View>
            ) : null}
            {listHeader}
          </View>
        }
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  coverImg: {
    width: '100%',
    height: '100%',
  },
  coverFog: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: COVER_FOG_H,
  },
  coverFallback: {
    flex: 1,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nav: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    zIndex: 5,
  },
  navBack: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    flex: 1,
    marginRight: spacing[6],
    textAlign: 'center',
    color: colors.textPrimary,
    fontSize: typography.sizes.lg,
    fontWeight: '600',
  },
  info: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
  },
  // 字重回到 token 标尺（#406）：原先硬编码 800，而 weights 只有 400/500/600/700
  title: { color: colors.textPrimary, fontSize: typography.sizes['3xl'], fontWeight: typography.weights.bold },
  subtitle: { color: colors.textSecondary, fontSize: typography.sizes.base, marginTop: spacing[1] },
  meta: { color: colors.textSecondary, fontSize: typography.sizes.sm, marginTop: spacing[1] },
  metaItems: {
    color: colors.textSecondary,
    fontSize: typography.sizes.sm,
    marginTop: spacing[1],
    fontVariant: ['tabular-nums'],
  },
  infoSurface: { backgroundColor: colors.bgSurface },
  sectionHeader: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
  },
  sectionHeaderSurface: { backgroundColor: colors.bgSurface },
  sectionHeaderText: { color: colors.textSecondary, fontSize: typography.sizes.sm, fontWeight: typography.weights.semibold },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] },
  tag: {
    backgroundColor: colors.bgHover,
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
  },
  tagText: { color: colors.textSecondary, fontSize: typography.sizes.xs },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[2],
    backgroundColor: colors.accent,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[2],
    borderRadius: radius.full,
    marginTop: spacing[3],
  },
  playText: { color: colors.textInverse, fontSize: typography.sizes.base, fontWeight: '600' },
});
