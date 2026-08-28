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
 * 封面来源由调用方决定（自建歌单=第一首歌、专辑=专辑图、歌手=头像、
 * 网络歌单=自己的封面）；加载失败自动切占位图标，并回调 onCoverError
 * 供调用方做刷新。
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Animated,
  FlatList,
} from 'react-native';
import type { ListRenderItem } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Music2, Play, ArrowLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { radius, spacing, typography } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

const AnimatedArrowLeft = Animated.createAnimatedComponent(ArrowLeft);

/** 封面底缘雾化条高度：bgBase 向上淡出的过渡带（#259 真机原型定稿值） */
const COVER_FOG_H = 64;

interface CollapsingHeroProps<T> {
  /** 封面 URL（调用方决定来源） */
  cover?: string;
  /** 封面加载失败回调（可刷新封面） */
  onCoverError?: () => void;
  /** 无封面/加载失败占位图标（默认音符） */
  fallbackIcon?: React.ReactNode;
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
  navTitle,
  navRight,
  title,
  subtitle,
  meta,
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
  const scrollY = useRef(new Animated.Value(0)).current;
  const [statusStyle, setStatusStyle] = useState<'light' | 'dark'>('light');
  const [coverFailed, setCoverFailed] = useState(false);

  useEffect(() => setCoverFailed(false), [cover]);

  const NAV_H = 52;
  const COVER_H = 300 + insets.top; // 全出血：含状态栏高度
  const collapseAt = COVER_H - NAV_H - insets.top; // 导航栏完全实心化的滚动点

  const navBg = scrollY.interpolate({
    inputRange: [0, collapseAt],
    outputRange: ['rgba(255,255,255,0)', colors.bgSurface],
    extrapolate: 'clamp',
  });
  const titleOpacity = scrollY.interpolate({
    inputRange: [collapseAt - 30, collapseAt],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const backColor = scrollY.interpolate({
    inputRange: [collapseAt - 30, collapseAt],
    outputRange: ['#FFFFFF', colors.textPrimary], // design-lint: ok 动画插值端点白：唱机收缩消失时的兜底色
    extrapolate: 'clamp',
  });

  useEffect(() => {
    const id = scrollY.addListener(({ value }) => {
      setStatusStyle(value > collapseAt - 30 ? 'dark' : 'light');
    });
    return () => scrollY.removeListener(id);
  }, [collapseAt, scrollY]);

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
          { paddingTop: insets.top, height: NAV_H + insets.top, backgroundColor: navBg },
        ]}
      >
        <TouchableOpacity style={styles.navBack} onPress={() => router.back()} hitSlop={8}>
          <AnimatedArrowLeft size={22} color={backColor} />
        </TouchableOpacity>
        <Animated.Text style={[styles.navTitle, { opacity: titleOpacity }]} numberOfLines={1}>
          {navTitle}
        </Animated.Text>
        {/* 页面动作插槽（如歌单重命名铅笔）：原 headerShown:false 后 Stack headerRight 不渲染 */}
        {navRight}
      </Animated.View>

      {/* 列表：封面是列表第一块内容（含状态栏区域），随滚动滚出屏幕 */}
      <FlatList
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
          useNativeDriver: false,
        })}
        scrollEventThrottle={16}
        onEndReached={onEndReached}
        onEndReachedThreshold={onEndReachedThreshold}
        ListFooterComponent={ListFooterComponent}
        ListEmptyComponent={ListEmptyComponent}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <View>
            {/* 全出血封面（底缘雾化条与信息区/页面底色衔接） */}
            <View style={{ height: COVER_H }}>
              {showCover ? (
                <Image
                  source={{ uri: cover }}
                  style={styles.coverImg}
                  resizeMode="cover"
                  onError={handleCoverError}
                />
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
            <View style={styles.info}>
              <Text style={styles.title} numberOfLines={2}>{title}</Text>
              {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
              {meta ? <Text style={styles.meta}>{meta}</Text> : null}
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
                <TouchableOpacity style={styles.playBtn} onPress={onAction}>
                  <Play size={18} color={colors.textInverse} fill={colors.textInverse} />
                  <Text style={styles.playText}>{actionLabel}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
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
  title: { color: colors.textPrimary, fontSize: typography.sizes['3xl'], fontWeight: '800' },
  subtitle: { color: colors.textSecondary, fontSize: typography.sizes.base, marginTop: spacing[1] },
  meta: { color: colors.textSecondary, fontSize: typography.sizes.sm, marginTop: spacing[1] },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] },
  tag: {
    backgroundColor: colors.bgHover,
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: 3,
  },
  tagText: { color: colors.textSecondary, fontSize: 11 },
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
