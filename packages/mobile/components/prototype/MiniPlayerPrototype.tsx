/**
 * PROTOTYPE — 迷你播放栏三种结构变体（wayfinder 布局重构）
 *
 * 问题：「迷你播放栏」除了现在的平铺 hairline 条，还能长什么样？
 * 三个结构不同的变体，通过底部任意页 ?variant=A|B|C 切换：
 *   A 毛玻璃条（Glass）   — 材质变化：半透明模糊透出列表，播放时歌名旁声音条跳动
 *   B 合并 Dock（一体）    — 播放信息与底部 tab 合并成一个控制面板（Apple Music 式）
 *   C 唱机胶囊（Turntable）— 深色圆角胶囊悬浮在 tab 上方，靠明暗对比区分（无阴影）
 *
 * 验收后：获胜变体折入正式 PlayerBar，本文件移到 throwaway 分支。
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { router } from 'expo-router';
import {
  ChevronLeft,
  ChevronRight,
  Compass,
  Flame,
  Download,
  Music,
  CirclePause,
  CirclePlay,
  SkipForward,
  ListMusic,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayerStore } from '../../stores/playerStore';
import { togglePlay, playSong, fetchLrcInBackground } from '../../services/audioPlayer';
import { colors, radius, spacing, turntable } from '../../theme/tokens';

export type MiniPlayerVariant = 'A' | 'B' | 'C';

export const MINI_VARIANT_NAMES: Record<MiniPlayerVariant, string> = {
  A: '毛玻璃条',
  B: '合并 Dock',
  C: '唱机胶囊',
};

/** 播放中声音条（desktop soundBar 同款三根跳动竖线） */
function SoundBars({ color }: { color: string }) {
  const bars = [useRef(new Animated.Value(0.4)).current, useRef(new Animated.Value(1)).current, useRef(new Animated.Value(0.6)).current];
  useEffect(() => {
    const loops = bars.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: 420 + i * 90, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.3, duration: 420 + i * 90, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []);
  return (
    <View style={soundBarsStyles.row}>
      {bars.map((v, i) => (
        <Animated.View
          key={i}
          style={[
            soundBarsStyles.bar,
            { backgroundColor: color, transform: [{ scaleY: v }] },
          ]}
        />
      ))}
    </View>
  );
}

const soundBarsStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 12, marginRight: 6 },
  bar: { width: 2.5, height: 12, borderRadius: 1 },
});

/** 封面 + 失败兜底（与正式 PlayerBar 同机制） */
function MiniCover({ song, size }: { song: ReturnType<typeof usePlayerStore.getState>['currentSong']; size: number }) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [song?.cover]);
  if (song?.cover && !failed) {
    return (
      <Image
        source={{ uri: song.cover }}
        style={{ width: size, height: size, borderRadius: radius.sm }}
        onError={() => {
          setFailed(true);
          if (song) void fetchLrcInBackground(song, true);
        }}
      />
    );
  }
  return (
    <View style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: colors.bgHover, alignItems: 'center', justifyContent: 'center' }}>
      <Music size={size * 0.5} color={colors.textTertiary} />
    </View>
  );
}

/* ═══════════ 变体 A：毛玻璃条 ═══════════ */
export function VariantAGlass({ onOpen }: { onOpen: () => void }) {
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  return (
    <TouchableOpacity style={glassStyles.container} onPress={onOpen} activeOpacity={0.8} disabled={!currentSong}>
      {/* Android 12+ 用 RenderEffect（DLS）实现真模糊；低版本退化为半透明兜底 */}
      <BlurView intensity={40} tint="light" blurMethod="dimezisBlurViewSdk31Plus" style={glassStyles.blur}>
        <View style={glassStyles.row}>
          <MiniCover song={currentSong} size={44} />
          <View style={glassStyles.info}>
            <View style={glassStyles.titleRow}>
              {isPlaying && currentSong && <SoundBars color={colors.accent} />}
              <Text style={glassStyles.title} numberOfLines={1}>
                {currentSong ? currentSong.name : '未在播放'}
              </Text>
            </View>
            <Text style={glassStyles.artist} numberOfLines={1}>
              {currentSong ? currentSong.artist : '选择一个歌曲开始播放'}
            </Text>
          </View>
          {currentSong && (
            <TouchableOpacity
              style={glassStyles.playBtn}
              onPress={(e) => { e.stopPropagation(); togglePlay(); }}
            >
              {isPlaying
                ? <CirclePause size={38} color={colors.accent} />
                : <CirclePlay size={38} color={colors.accent} />}
            </TouchableOpacity>
          )}
        </View>
      </BlurView>
    </TouchableOpacity>
  );
}

const glassStyles = StyleSheet.create({
  container: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
    overflow: 'hidden',
  },
  blur: {
    backgroundColor: 'rgba(255,255,255,0.82)', // dls 不可用时的兜底
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  info: { flex: 1, marginLeft: spacing[3], marginRight: spacing[2] },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  artist: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  playBtn: { padding: spacing[1] },
});

/* ═══════════ 变体 B：合并 Dock（播放信息 + tab 一体） ═══════════ */
export function VariantBDock({
  onOpen,
  tabState,
  onTabPress,
}: {
  onOpen: () => void;
  tabState: { routes: { key: string; name: string }[]; index: number };
  onTabPress: (name: string) => void;
}) {
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const next = usePlayerStore((s) => s.next);

  return (
    <View style={dockStyles.container}>
      {/* 上半：播放信息（点击展开播放器） */}
      <TouchableOpacity style={dockStyles.player} onPress={onOpen} activeOpacity={0.8} disabled={!currentSong}>
        <MiniCover song={currentSong} size={40} />
        <View style={dockStyles.info}>
          <Text style={dockStyles.title} numberOfLines={1}>
            {currentSong ? currentSong.name : '未在播放'}
          </Text>
          <Text style={dockStyles.artist} numberOfLines={1}>
            {currentSong ? currentSong.artist : '选择一个歌曲开始播放'}
          </Text>
        </View>
        {currentSong && (
          <View style={dockStyles.controls}>
            <TouchableOpacity
              style={dockStyles.btn}
              onPress={(e) => { e.stopPropagation(); togglePlay(); }}
            >
              {isPlaying
                ? <CirclePause size={32} color={colors.accent} />
                : <CirclePlay size={32} color={colors.accent} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={dockStyles.btn}
              onPress={(e) => {
                e.stopPropagation();
                next();
                const s = usePlayerStore.getState().currentSong;
                if (s) playSong(s);
              }}
            >
              <SkipForward size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
      {/* 下半：tab 行 */}
      <TabRow state={tabState} onTabPress={onTabPress} />
    </View>
  );
}

const dockStyles = StyleSheet.create({
  container: {
    backgroundColor: colors.bgSurface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  player: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  info: { flex: 1, marginLeft: spacing[3], marginRight: spacing[2] },
  title: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  artist: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  controls: { flexDirection: 'row', alignItems: 'center' },
  btn: { padding: spacing[1] },
});

/* ═══════════ 变体 C：唱机胶囊（深色悬浮，无阴影） ═══════════ */
export function VariantCTurntable({ onOpen }: { onOpen: () => void }) {
  const currentSong = usePlayerStore((s) => s.currentSong);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  return (
    <TouchableOpacity style={pillStyles.container} onPress={onOpen} activeOpacity={0.85} disabled={!currentSong}>
      <MiniCover song={currentSong} size={38} />
      <View style={pillStyles.info}>
        <Text style={pillStyles.title} numberOfLines={1}>
          {currentSong ? currentSong.name : '未在播放'}
        </Text>
        <Text style={pillStyles.artist} numberOfLines={1}>
          {currentSong ? currentSong.artist : '选择一个歌曲开始播放'}
        </Text>
      </View>
      {currentSong && (
        <View style={pillStyles.controls}>
          <TouchableOpacity
            style={pillStyles.playBtn}
            onPress={(e) => { e.stopPropagation(); togglePlay(); }}
          >
            {isPlaying
              ? <CirclePause size={26} color="#fff" />
              : <CirclePlay size={26} color="#fff" />}
          </TouchableOpacity>
          <TouchableOpacity
            style={pillStyles.btn}
            onPress={(e) => { e.stopPropagation(); onOpen(); }}
          >
            <ListMusic size={18} color="rgba(255,255,255,0.65)" />
          </TouchableOpacity>
        </View>
      )}
    </TouchableOpacity>
  );
}

const pillStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: turntable.plinth,
    borderRadius: radius.xl,
    marginHorizontal: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  info: { flex: 1, marginLeft: spacing[3], marginRight: spacing[2] },
  title: { color: '#fff', fontSize: 14, fontWeight: '600' },
  artist: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 2 },
  controls: { flexDirection: 'row', alignItems: 'center' },
  playBtn: { padding: spacing[1] },
  btn: { padding: spacing[1] },
});

/* ═══════════ 悬浮切换条（仅 dev） ═══════════ */
export function MiniPrototypeSwitcher({ current }: { current: MiniPlayerVariant }) {
  const cycle = (dir: 1 | -1) => {
    const keys: MiniPlayerVariant[] = ['A', 'B', 'C'];
    const idx = keys.indexOf(current);
    const nextKey = keys[(idx + dir + keys.length) % keys.length];
    router.setParams({ variant: nextKey });
  };
  return (
    <View style={switchStyles.wrap} pointerEvents="box-none">
      <View style={switchStyles.bar}>
        <TouchableOpacity onPress={() => cycle(-1)} style={switchStyles.btn} hitSlop={8}>
          <ChevronLeft size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={switchStyles.label}>{current} — {MINI_VARIANT_NAMES[current]}</Text>
        <TouchableOpacity onPress={() => cycle(1)} style={switchStyles.btn} hitSlop={8}>
          <ChevronRight size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const switchStyles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 92, alignItems: 'center', zIndex: 99 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(20,20,40,0.9)',
    borderRadius: radius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    gap: spacing[2],
  },
  btn: { padding: spacing[1] },
  label: { color: '#fff', fontSize: 13, fontWeight: '600', minWidth: 118, textAlign: 'center' },
});

/** tab 行（A/C 变体共用；B 内嵌同一行） */
function TabRow({
  state,
  onTabPress,
}: {
  state: { routes: { key: string; name: string }[]; index: number };
  onTabPress: (name: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const icons: Record<string, LucideIcon> = {
    index: Compass, recommend: Flame, playlists: ListMusic, download: Download,
  };
  const labels: Record<string, string> = { index: '发现', recommend: '推荐', playlists: '歌单', download: '下载' };
  return (
    <View style={[tabRowStyles.row, { paddingBottom: Math.max(0, insets.bottom - 8) }]}>
      {state.routes.map((route, i) => {
        if (route.name === 'search') return null;
        const focused = state.index === i;
        const Icon = icons[route.name];
        return (
          <TouchableOpacity key={route.key} style={tabRowStyles.tab} onPress={() => onTabPress(route.name)}>
            <Icon size={22} color={focused ? colors.accent : colors.textSecondary} />
            <Text style={{ color: focused ? colors.accent : colors.textSecondary, fontSize: 11, marginTop: 2, lineHeight: 13 }}>
              {labels[route.name]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const tabRowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderDefault,
    paddingTop: 6,
    backgroundColor: colors.bgSurface,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

/** 原型入口：渲染当前变体（B 需要 tab 行，直接替换整个底部结构） */
export default function MiniPlayerPrototype({
  variant,
  onOpen,
  tabState,
  onTabPress,
}: {
  variant: MiniPlayerVariant;
  onOpen: () => void;
  tabState: { routes: { key: string; name: string }[]; index: number };
  onTabPress: (name: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const tabRowHeight = 6 + 22 + 15 + Math.max(0, insets.bottom - 8);
  return (
    <View>
      {variant === 'A' && <VariantAGlass onOpen={onOpen} />}
      {variant === 'B' && <VariantBDock onOpen={onOpen} tabState={tabState} onTabPress={onTabPress} />}
      {variant === 'C' && (
        <>
          {/* 胶囊悬浮在 tab 行上方，靠深色与浅色背景对比区分（无阴影） */}
          <View style={{ position: 'relative' }}>
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: tabRowHeight + 8, zIndex: 10 }}>
              <VariantCTurntable onOpen={onOpen} />
            </View>
            <TabRow state={tabState} onTabPress={onTabPress} />
          </View>
        </>
      )}
      <MiniPrototypeSwitcher current={variant} />
    </View>
  );
}
