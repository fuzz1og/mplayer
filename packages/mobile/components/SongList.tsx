import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactElement } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { ListRenderItemInfo, RefreshControlProps, StyleProp, ViewStyle } from 'react-native';
import type { LyricsHydrationCandidate, Song } from '@mplayer/core';
import { cancelLyricsHydration, enqueueLyricsHydration } from '@mplayer/core';
import { spacing, textVariants } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import SongRow from './SongRow';
import ScalePress from './ScalePress';
import { listWindowProps } from './listWindow';
import { computeSongListLayout } from './songListLayout';
import type { SongListRow } from './songListLayout';
import { createViewportLyricsSettler, lyricsCandidateKey } from './songListHydration';
import type { ViewportLyricsSettler } from './songListHydration';

/**
 * 视口回调只在**真正读到的那部分**上收口：ViewToken 的形状由 react-native 决定，
 * 这里结构化声明，免得把 @react-native/virtualized-lists 这个传递依赖引进来。
 */
interface ViewableRowToken<T> {
  item: T;
}
interface ViewableRowsInfo<T> {
  viewableItems: ViewableRowToken<T>[];
}

// 行模型与布局算术在 songListLayout.ts（不依赖 react-native，可被单测直接覆盖）。
// 这里只 re-export **类型**：调用方（各列表页）建 rows 时需要它；布局函数由测试直接
// import 深模块，不再从这里转发（多一层转发只会多一个没人用的出口）。
export type { SongListRow } from './songListLayout';

/**
 * 歌曲列表深模块（#411）。
 *
 * 背景：9 个列表页 / 11 个 FlatList 各自决定虚拟化粒度——固定行高却不给
 * `getItemLayout`、行组件不 memo、回调全内联（即使加了 memo 也会被新函数击穿）、
 * key 混入 index、搜索页干脆把「组」当 cell 在组内 `map` 全量渲染（绕过虚拟化）。
 *
 * 这里把**列表该负责的事**收进来，页面只描述数据：
 * - **扁平化的行模型**（`SongListRow`：分区头 / 组头 / 歌曲行）。搜索页那种「组内
 *   map」被拍平后，虚拟化才真正生效——一个 30 首的组不再一次性挂 30 行。
 * - **`getItemLayout`**：行高固定（见 `songListLayout` 的三个常量），按行类型累加偏移。
 *   注意只有**不含 `ListHeaderComponent`** 时偏移语义才明确，所以传了就自动放弃它
 *   （错的偏移比没有更糟）。
 * - **窗口档位**：与 `CollapsingHero` 共用 `components/listWindow.ts`，页面不再各走默认。
 * - **稳定 key**：由调用方给 `row.key`；本模块从不把 index 拼进 key。
 * - **稳定回调**：对外只暴露 `onPress(song)`（**不带 index**）——带 index 就必须在
 *   `renderItem` 里包一层箭头函数，`SongRow` 的 memo 会被逐帧击穿。需要下标的页面
 *   自己用 `songs.findIndex(s => s.id === song.id)` 换算（点击是低频操作）。
 */
interface Props {
  rows: SongListRow[];
  /** 稳定回调（**不带 index**，见文件头注释）：页面用 useCallback 包好。 */
  onPress?: (song: Song) => void;
  onRemove?: (song: Song) => void;
  onSwap?: (original: Song, swapped: Song) => void;
  /**
   * 只允许加**底部**内距（列表尾巴留白）。顶部内距会与 `getItemLayout` 的偏移冲突
   * ——需要顶部内容请用 `sectionHeader` 行或 `ListHeaderComponent`（后者会关掉
   * `getItemLayout`）。
   */
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** 提供后放弃 `getItemLayout`（偏移语义不再明确）。 */
  ListHeaderComponent?: ReactElement | null;
  ListFooterComponent?: ReactElement | null;
  ListEmptyComponent?: ReactElement | null;
  onEndReached?: () => void;
  onEndReachedThreshold?: number;
  refreshControl?: ReactElement<RefreshControlProps>;
  testID?: string;
}

export default function SongList({
  rows,
  onPress,
  onRemove,
  onSwap,
  contentContainerStyle,
  ListHeaderComponent,
  ListFooterComponent,
  ListEmptyComponent,
  onEndReached,
  onEndReachedThreshold,
  refreshControl,
  testID,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const { offsets, lengths } = useMemo(() => computeSongListLayout(rows), [rows]);

  const getItemLayout = useCallback(
    (_data: ArrayLike<SongListRow> | null | undefined, index: number) => ({
      length: lengths[index] ?? 0,
      offset: offsets[index] ?? 0,
      index,
    }),
    [lengths, offsets],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<SongListRow>) => {
      if (item.kind === 'sectionHeader') {
        return <SectionHeaderRow row={item} styles={styles} />;
      }
      if (item.kind === 'groupHeader') {
        return <GroupHeaderRow row={item} styles={styles} />;
      }
      return (
        <SongRow
          song={item.song}
          rank={item.rank}
          showSource={item.showSource}
          queueSongs={item.queueSongs}
          onPress={onPress}
          onRemove={onRemove}
          onSwap={onSwap}
        />
      );
    },
    [onPress, onRemove, onSwap, styles],
  );

  const keyExtractor = useCallback((row: SongListRow) => row.key, []);

  /**
   * 「行进入视口」= 预取该行歌词（#429）：点开播放器时歌词已在 core 缓存里，不必再等
   * 一次 RTT。接线只到这里——去重 / single-flight / 取消 / 预算在 core
   * `shared/lyricsHydrator`，并发与每 host 限速在 transport 双层闸门（#408）。
   *
   * - 回调**必须是稳定引用**：RN 不支持热换 `onViewableItemsChanged`（换了会重设
   *   视口追踪），所以用 useRef 持有一份；候选只来自本次回调拿到的行，不闭包 `rows`。
   * - 真正入队的是 `settler`：可见集合**停稳** `VIEWPORT_SETTLE_MS` 后才交付（#421），
   *   滑动期间滚过的行不入队——一次甩动不会把整份歌单打出去。
   * - 收回也在同一拍：停稳时算出「本次离开可见集合的 key」交给 `cancelLyricsHydration`。
   *   滑出视口的行不该继续占着出网机会，且排队的取词会被 transport 从队列摘除。
   */
  // 本列表入队过的候选（key → 候选）：卸载时要按 key 收回（hydrator 是全局单例，
  // 不能整体清场）；行滑出可见集合时也在同一本账上划掉。
  const enqueuedRef = useRef(new Map<string, LyricsHydrationCandidate>());
  const settlerRef = useRef<ViewportLyricsSettler | null>(null);
  if (settlerRef.current === null) {
    settlerRef.current = createViewportLyricsSettler({
      enqueue: (candidates) => {
        for (const candidate of candidates) {
          const key = lyricsCandidateKey(candidate);
          if (key !== null) enqueuedRef.current.set(key, candidate);
        }
        enqueueLyricsHydration(candidates);
      },
      // 停稳那一拍算出的「本次离开可见集合的 key」：从账本划掉并收回。排队中的取词
      // 从 transport 闸门摘除、绝不进入底层传输（#408 的协作式取消）；已结算的 key
      // 在 hydrator 里本就跳过，故成本只是 O(离开行数)。
      cancel: (candidates) => {
        for (const candidate of candidates) {
          const key = lyricsCandidateKey(candidate);
          if (key !== null) enqueuedRef.current.delete(key);
        }
        cancelLyricsHydration(candidates);
      },
    });
  }
  const onViewableItemsChanged = useRef(({ viewableItems }: ViewableRowsInfo<SongListRow>) => {
    settlerRef.current?.onViewableRows(viewableItems.map((token) => token.item));
  }).current;
  // 只设阈值、不设 minimumViewTime：RN 的 minimumViewTime 只是**推迟**报告那次快照
  // （快照里的行可能早已滑出屏幕），停稳判定统一由 settler 一处负责。
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

  // 卸载时先丢掉待交付项，再收回本列表入队过、尚未结算的预取。
  // ⚠️ 已知取舍：hydrator 按 songId 全局在飞、**没有调用方身份**，所以「收回」是 key 级的——
  // 若另一个列表此刻也在飞同一首歌，这次取消会一并 abort 它（代价是那次预取白做，
  // 重新进入视口会再来一次，不会发错数据）。要按调用方隔离得给 hydrator 加 owner 维度，
  // 本 PR 不做。
  useEffect(
    () => () => {
      settlerRef.current?.dispose();
      cancelLyricsHydration([...enqueuedRef.current.values()]);
    },
    []
  );

  return (
    <FlatList
      testID={testID}
      data={rows}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      // 传了 ListHeaderComponent 就不给 getItemLayout：偏移会与表头高度打架
      getItemLayout={ListHeaderComponent ? undefined : getItemLayout}
      {...listWindowProps}
      contentContainerStyle={contentContainerStyle}
      ListHeaderComponent={ListHeaderComponent ?? undefined}
      ListFooterComponent={ListFooterComponent ?? undefined}
      ListEmptyComponent={ListEmptyComponent ?? undefined}
      onEndReached={onEndReached}
      onEndReachedThreshold={onEndReachedThreshold}
      refreshControl={refreshControl}
      viewabilityConfig={viewabilityConfig}
      onViewableItemsChanged={onViewableItemsChanged}
    />
  );
}

const SectionHeaderRow = memo(function SectionHeaderRow({
  row,
  styles,
}: {
  row: Extract<SongListRow, { kind: 'sectionHeader' }>;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionHeaderTitle}>{row.title}</Text>
      {row.action && (
        <ScalePress onPress={row.action.onPress} style={styles.sectionHeaderAction}>
          <Text style={row.action.danger ? styles.sectionActionDanger : styles.sectionAction}>
            {row.action.label}
          </Text>
        </ScalePress>
      )}
    </View>
  );
});

const GroupHeaderRow = memo(function GroupHeaderRow({
  row,
  styles,
}: {
  row: Extract<SongListRow, { kind: 'groupHeader' }>;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Text style={row.quiet ? styles.groupHeaderQuiet : styles.groupHeader}>
      {row.title}
      {row.subtitle ? <Text style={styles.groupArtist}> — {row.subtitle}</Text> : null}
      {row.note ? <Text style={styles.groupNote}>· {row.note}</Text> : null}
    </Text>
  );
});

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // 分区头（对齐 iOS inset grouped；行高与 songListLayout.SECTION_HEADER_HEIGHT 同源）
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: 12,
  },
  sectionHeaderTitle: { ...textVariants.sectionHeader, fontWeight: '600', color: colors.textPrimary },
  sectionHeaderAction: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sectionAction: { ...textVariants.subhead, fontWeight: '400', color: colors.textPrimary },
  sectionActionDanger: { ...textVariants.subhead, fontWeight: '400', color: colors.dangerText },
  // 搜索页组头：沟槽对齐的静默标签（无卡片底），行保持全出血
  groupHeader: {
    ...textVariants.subhead,
    fontWeight: '600',
    color: colors.textPrimary,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: 4,
  },
  groupHeaderQuiet: {
    ...textVariants.footnote,
    fontWeight: '600',
    color: colors.textPrimary,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: 4,
  },
  groupArtist: { ...textVariants.caption, color: colors.textTertiary },
  groupNote: { ...textVariants.caption, color: colors.textTertiary },
});
