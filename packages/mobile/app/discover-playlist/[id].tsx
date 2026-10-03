import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Alert, Modal, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams } from 'expo-router';
import { getDirectClient, formatPlayCount, type Song } from '@mplayer/core';
import { Download } from 'lucide-react-native';
import type { DiscoverPlaylist } from '@mplayer/core';
import HeroSkeleton from '../../components/HeroSkeleton';
import CoverFallback from '../../components/CoverFallback';
import LoadMoreFooter from '../../components/LoadMoreFooter';
import SongRow from '../../components/SongRow';
import ScalePress from '../../components/ScalePress';
import CollapsingHero from '../../components/CollapsingHero';
import BottomSafePlayerBar from '../../components/BottomSafePlayerBar';
import { usePlayerStore } from '../../stores/playerStore';
import { playSong } from '../../services/audioPlayer';
import { replaceSongInList } from '../../services/songListOps';
import { usePlaylistStore } from '../../stores/playlistStore';
import { exportSongsToLocalPlaylist } from '../../services/playlistExport';
import { radius, spacing, textVariants } from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

const PAGE_SIZE = 50;

export default function DiscoverPlaylistDetailPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const [playlist, setPlaylist] = useState<DiscoverPlaylist | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);
  const createPlaylist = usePlaylistStore((s) => s.createPlaylist);
  const addSongs = usePlaylistStore((s) => s.addSongs);
  /** 导出进行中（防重复触发；hero 的 navRight 因此置灰） */
  const [exporting, setExporting] = useState(false);
  /** 已取回全量、等用户确认的待导出歌单（null = 未在确认中） */
  const [exportConfirm, setExportConfirm] = useState<{ name: string; songs: Song[] } | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    offsetRef.current = 0;
    (async () => {
      try {
        // 元数据与第一页歌曲并行（weapi 直连，歌曲含已解析播放 URL）
        const [p, page] = await Promise.all([
          getDirectClient('netease')!.getPlaylistDetail!(Number(id)),
          getDirectClient('netease')!.getPlaylistSongs!(Number(id), 0, PAGE_SIZE),
        ]);
        if (cancelled) return;
        setPlaylist(p);
        setSongs(page.songs);
        setHasMore(page.songs.length < page.total);
        offsetRef.current = PAGE_SIZE;
        // 后台补齐缺失 URL（weapi by-ID 批量直链），完成后触发重渲染
        void getDirectClient('netease')!.resolvePlayableUrls!(page.songs).then(() => {
          if (!cancelled) {
            setSongs([...page.songs]);
          }
        });
      } catch (e: any) {
        console.error('[DiscoverPlaylistDetail] load error:', e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const loadMore = async () => {
    if (loadingMore || !hasMore || !id) return;
    setLoadingMore(true);
    try {
      const page = await getDirectClient('netease')!.getPlaylistSongs!(Number(id), offsetRef.current, PAGE_SIZE);
      if (page.songs.length > 0) {
        setSongs(prev => [...prev, ...page.songs]);
        offsetRef.current += PAGE_SIZE;
        setHasMore(offsetRef.current < page.total);
        // 后台补齐本页缺失 URL（weapi by-ID 批量直链），完成后触发重渲染
        void getDirectClient('netease')!.resolvePlayableUrls!(page.songs).then(() => {
          setSongs(prev => [...prev]);
        });
      } else {
        setHasMore(false);
      }
    } catch (e: any) {
      console.error('[DiscoverPlaylistDetail] loadMore error:', e.message);
    } finally {
      setLoadingMore(false);
    }
  };

  // 单曲换源后更新列表。useCallback（#411）：此前是 renderItem 里的内联箭头，
  // 每帧新引用会把 SongRow 的 memo 击穿。
  // ⚠️ 必须落在下面两处 early return **之前**：hook 在早返回之后被调用会改变 hook 顺序，
  // 首屏 loading 返回骨架、数据到达后这一行才被执行 → 「Rendered more hooks than during
  // the previous render」整页崩（#448 真机验收发现；门禁见 eslint react-hooks/rules-of-hooks）。
  const handleSwap = useCallback((original: Song, swapped: Song) => {
    setSongs((prev) => replaceSongInList(prev, original.id, swapped));
  }, []);

  /**
   * 导出确认后的落库：一次 addSongs = 一次 set = 一次持久化（stores/playlistStore.ts），
   * 绝不照抄桌面的逐首 playlist:addSong。
   */
  const handleExport = async (target: { name: string; songs: Song[] }) => {
    // 注意：**不能**在这里再判 `exporting`。取歌阶段那面旗是在 finally 里落的，
    // 与「确认弹层渲染完成 → 用户点导出」是同一条时间线——真机实测：弹层渲染得够快时
    // 该旗仍为 true，确认会被静默吞掉（点了「导出」什么也不发生）。
    // 这段本身是同步落库，不需要旗；防重复由弹层「点一次即关」+ 按钮 disabled 承担。
    try {
      // #552：落库走 core 写入编排（adapter 内），失败已回滚；added 是真实新增数（#554）。
      const result = await exportSongsToLocalPlaylist({ createPlaylist, addSongs }, target.name, target.songs);
      if (!result.ok) {
        Alert.alert('导出失败', result.rolledBack ? '写入失败，已撤销新建的歌单' : result.error || '请稍后重试');
        return;
      }
      Alert.alert('导出完成', `已导出 ${result.added} 首到「${target.name}」`);
    } catch (e: any) {
      Alert.alert('导出失败', e?.message ?? '请稍后重试');
    }
  };

  /**
   * hero 右上角「导出到本地歌单」（#492）：取歌复用导入腿的全量取，
   * 确认框与桌面同构（曲目数 + 歌单名）。按票面决定走「全量重取一次」，
   * 不干扰页面自身按 PAGE_SIZE 的分页状态。
   */
  const handleExportToLocal = async () => {
    if (exporting || !playlist) return;
    setExporting(true);
    try {
      const client = getDirectClient('netease');
      if (!client?.getPlaylistSongs) throw new Error('网易歌单能力不可用');
      // limit <= 0 = 全量（getPlaylistSongs 合一语义，#278）
      const full = await client.getPlaylistSongs(Number(id), 0, 0);
      const all = full.songs ?? [];
      if (all.length === 0) {
        Alert.alert('导出失败', '歌单不存在或没有歌曲');
        return;
      }
      setExportConfirm({ name: playlist.name, songs: all });
    } catch (e: any) {
      Alert.alert('导出失败', e?.message ?? '请稍后重试');
    } finally {
      setExporting(false);
    }
  };

  // 骨架与真实首屏同源（#465）：Hero 占屏约 40%，此前只画列表骨架 → 数据到达时整页跳一次
  if (loading) return <HeroSkeleton rows={8} showSource />;
  if (!playlist) {
    return (
      <View style={styles.empty}>
        <Stack.Screen
          options={{
            title: '歌单详情',
            headerShown: true,
            headerStyle: { backgroundColor: colors.bgSurface },
            headerTintColor: colors.textPrimary,
            headerShadowVisible: false,
          }}
        />
        <Text style={{ ...textVariants.callout, color: colors.textSecondary }}>歌单不存在</Text>
      </View>
    );
  }

  const handlePlayAll = () => {
    if (songs.length === 0) return;
    usePlayerStore.getState().setQueue(songs, 0);
    playSong(songs[0]);
  };

  const moreButton = (
    <ScalePress
      style={styles.moreBtn}
      onPress={() => void handleExportToLocal()}
      disabled={exporting}
      hitSlop={{ left: 8, right: 8, top: 8, bottom: 8 }}
    >
      <Download size={22} color={colors.textSecondary} />
    </ScalePress>
  );

  return (
    <View style={styles.container}>
      <SafeAreaView edges={[]} style={{ flex: 1 }}>
        <Stack.Screen options={{ title: playlist.name, headerShown: false }} />
        <CollapsingHero
          cover={playlist.coverImgUrl}
          coverFallback={<CoverFallback name={playlist.name} />}
          navTitle={playlist.name}
          title={playlist.name}
          subtitle={playlist.creator?.nickname ?? '未知'}
          meta={`播放: ${formatPlayCount(playlist.playCount)} · 歌曲: ${playlist.trackCount}首`}
          tags={playlist.tags}
          actionLabel="播放全部"
          onAction={handlePlayAll}
          navRight={moreButton}
          data={songs}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          renderItem={({ item }) => (
            <SongRow song={item} showSource queueSongs={songs} onSwap={handleSwap} />
          )}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={<LoadMoreFooter loadingMore={loadingMore} hasMore={hasMore} hasData={songs.length > 0} />}
        />
      </SafeAreaView>
      <BottomSafePlayerBar />

      {/* 导出确认：文案与桌面同构（曲目数 + 歌单名） */}
      <Modal
        visible={exportConfirm !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setExportConfirm(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setExportConfirm(null)}>
          <Pressable style={styles.modalContent} onPress={() => {}}>
            <Text style={styles.modalTitle}>导出到本地歌单</Text>
            <Text style={styles.modalBody}>
              {exportConfirm
                ? `确定将歌单「${exportConfirm.name}」（${exportConfirm.songs.length} 首歌曲）导出为一个新的本地歌单吗？`
                : ''}
            </Text>
            <View style={styles.modalActions}>
              <ScalePress style={styles.cancelBtn} onPress={() => setExportConfirm(null)}>
                <Text style={styles.cancelText}>取消</Text>
              </ScalePress>
              <ScalePress
                style={styles.confirmBtn}
                onPress={() => {
                  const target = exportConfirm;
                  setExportConfirm(null);
                  if (target) void handleExport(target);
                }}
              >
                <Text style={styles.confirmText}>导出</Text>
              </ScalePress>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  empty: { flex: 1, backgroundColor: colors.bgBase, justifyContent: 'center', alignItems: 'center' },

  moreBtn: { marginRight: spacing[2] },

  // 导出确认弹窗（对齐本地歌单页的重命名弹窗样式）
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.bgOverlay,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    padding: spacing[6],
    width: '82%',
  },
  modalTitle: {
    ...textVariants.title,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing[3],
    textAlign: 'center',
  },
  modalBody: { ...textVariants.callout, color: colors.textSecondary, textAlign: 'center' },
  modalActions: { flexDirection: 'row', marginTop: spacing[5], gap: spacing[3] },
  cancelBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.bgHover,
    alignItems: 'center',
  },
  cancelText: { ...textVariants.body, fontWeight: '400', color: colors.textSecondary },
  confirmBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  confirmText: { ...textVariants.body, fontWeight: '600', color: colors.textInverse },
});
