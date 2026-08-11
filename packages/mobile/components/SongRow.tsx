import { useEffect, useRef, useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, StyleSheet,
  Modal, Alert,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type Song, SourceKey } from '@mplayer/core';
import { usePlayerStore } from '../stores/playerStore';
import { useFavoriteStore } from '../stores/favoriteStore';
import { useAudioTagStore, tagKey } from '../stores/audioTagStore';
import { useLogsStore } from '../stores/logsStore';
import { SOURCE_LABELS } from '../stores/sourceStore';
import AddToPlaylistModal from './AddToPlaylistModal';
import SourceSwapModal from './SourceSwapModal';
import { playSong } from '../services/audioPlayer';
import { downloadSong } from '../services/downloadService';
import { searchSwapCandidates, applySwap, probeSwapCandidates } from '../services/sourceSwap';
import type { SwapCandidate } from '../services/sourceSwap';
import { searchStrictMatch } from '../services/songResources';

// 封面失效兜底搜索：限并发（手机网络带宽有限，避免整列表失效时并发打满）
let activeCoverSearches = 0;
const MAX_COVER_SEARCHES = 4;
const coverSearchWaiters: (() => void)[] = [];
async function withCoverSearchSlot(fn: () => Promise<void>): Promise<void> {
  if (activeCoverSearches >= MAX_COVER_SEARCHES) {
    await new Promise<void>((r) => coverSearchWaiters.push(r));
  }
  activeCoverSearches++;
  try {
    await fn();
  } finally {
    activeCoverSearches--;
    coverSearchWaiters.shift()?.();
  }
}

interface SongRowProps {
  song: Song;
  rank?: number;
  onPress?: (song: Song) => void;
  showSource?: boolean;
  queueSongs?: Song[];
  /** 换源成功回调：父组件用它更新自己的列表 state（歌单页同时持久化） */
  onSwap?: (original: Song, swapped: Song) => void;
}

const SOURCE_COLORS: Record<SourceKey, string> = {
  netease: '#e74c3c',
  qq: '#3498db',
  kugou: '#9b59b6',
  kuwo: '#1abc9c',
  qianqian: '#95a5a6',
  soda: '#2ecc71',
  local: '#7f8c8d',
};

export default function SongRow({
  song,
  rank,
  onPress,
  showSource = false,
  queueSongs,
  onSwap,
}: SongRowProps) {
  const isFav = useFavoriteStore((s) => s.isFavorite(song.id));
  const addFavorite = useFavoriteStore((s) => s.addFavorite);
  const removeFavorite = useFavoriteStore((s) => s.removeFavorite);
  const insets = useSafeAreaInsets();
  // 按 (sourceType:id) 订阅探测标签:每批探测完成只重渲染对应的行,标签渐进式出现
  const audioTag = useAudioTagStore((s) => s.tags[tagKey(song)]);

  const favorited = isFav;
  const [showActions, setShowActions] = useState(false);
  const [pressingAction, setPressingAction] = useState(false);
  const [showPlaylistModal, setShowPlaylistModal] = useState(false);

  // 封面失效兜底：缓存 URL 挂了 → 搜索重载（每行最多一次，严格匹配防翻唱封面）
  const [cover, setCover] = useState(song.cover);
  const coverFallbackUsed = useRef(false);
  useEffect(() => {
    setCover(song.cover);
    coverFallbackUsed.current = false;
  }, [song.cover]);

  const handleCoverError = () => {
    if (coverFallbackUsed.current || !song.name) return;
    coverFallbackUsed.current = true;
    setCover('');
    void withCoverSearchSlot(async () => {
      try {
        const fresh = await searchStrictMatch(song);
        if (fresh?.cover?.startsWith('http')) setCover(fresh.cover);
      } catch {
        // 封面兜底失败保留占位
      }
    });
  };

  const handleMore = () => {
    setShowActions(true);
    setPressingAction(true);
    setTimeout(() => setPressingAction(false), 100);
  };

  const handleDownload = () => {
    setShowActions(false);
    downloadSong(song)
      .then(() => Alert.alert('提示', `《${song.name}》下载完成，可在下载页播放`))
      .catch(() => Alert.alert('提示', `《${song.name}》下载失败，请重试`));
  };

  const handleSearchArtist = () => {
    setShowActions(false);
    // type=artist：搜索结果页默认落在「歌手」次级 tab
    router.push(`/search?q=${encodeURIComponent(song.artist)}&type=artist`);
  };

  // 单曲换源状态（两阶段：选源 → 候选选择）
  const [swapVisible, setSwapVisible] = useState(false);
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapSuccess, setSwapSuccess] = useState(false);
  const [swapCandidates, setSwapCandidates] = useState<SwapCandidate[]>([]);
  const [swapSource, setSwapSource] = useState<SourceKey | null>(null);

  /** 阶段 1：选目标源 → 搜索该源候选版本（前 3），交给用户选择 */
  const handleSelectSource = async (source: SourceKey) => {
    setSwapLoading(true);
    setSwapSuccess(false);
    const candidates = await searchSwapCandidates(song, source);
    setSwapLoading(false);
    if (candidates.length === 0) {
      Alert.alert('提示', `未在${SOURCE_LABELS[source]}找到可切换的版本`);
      return;
    }
    setSwapSource(source);
    setSwapCandidates(candidates);
    // 异步探测可播性：候选先显示（检测中），探测完成渐进更新标记
    void probeSwapCandidates(candidates).then((probed) => {
      setSwapCandidates(probed);
    });
  };

  /** 阶段 2：用户选中候选版本 → 应用换源（替换队列/续播/持久化） */
  const handleSelectCandidate = async (candidate: SwapCandidate) => {
    if (!swapSource) return;
    if (candidate.playable === false) {
      // 探测为失效：确认后再切换（用户可能想试）
      Alert.alert('提示', `《${candidate.song.name}》探测为不可播（链接可能失效），仍要切换吗？`, [
        { text: '取消', style: 'cancel' },
        { text: '仍要切换', onPress: () => { void applyCandidate(candidate); } },
      ]);
      return;
    }
    void applyCandidate(candidate);
  };

  const applyCandidate = async (candidate: SwapCandidate) => {
    if (!swapSource) return;
    setSwapLoading(true);
    const swapped = applySwap(song, swapSource, candidate);
    if (!swapped) {
      setSwapLoading(false);
      Alert.alert('提示', '换源失败，请重试');
      return;
    }
    setSwapSuccess(true);
    const st = usePlayerStore.getState();
    const idx = st.queue.findIndex((s) => s.id === song.id);
    useLogsStore.getState().addLog(
      'info',
      `换源《${song.name}》: ${song.sourceType}→${swapSource}${candidate.exact ? '(完整版)' : ''}, 队列idx=${idx}, 当前播放id=${st.currentSong?.id}, 换源歌id=${song.id}`
    );
    if (idx >= 0) {
      const queue = [...st.queue];
      queue[idx] = swapped;
      if (st.currentSong?.id === song.id) {
        // 正在播放的就是这首：替换队列并立即用完整版续播
        st.setQueue(queue, idx);
        playSong(swapped);
      } else {
        // 非当前歌曲：只替换队列，不调用 setQueue（会劫持播放）
        usePlayerStore.setState({ queue });
      }
    } else if (st.currentSong?.id === song.id) {
      // 不在队列但正在播放：直接续播
      playSong(swapped);
    }
    // 父组件更新自己的列表（歌单页同时持久化）
    onSwap?.(song, swapped);
    setTimeout(() => {
      setSwapVisible(false);
      setSwapCandidates([]);
      setSwapSource(null);
    }, 1200);
  };

  const handleSwapBack = () => {
    setSwapCandidates([]);
    setSwapSource(null);
  };

  const MORE_ACTIONS = [
    { key: 'playlist', icon: 'list-outline', label: '加入歌单', onPress: () => { setShowActions(false); setShowPlaylistModal(true); } },
    { key: 'download', icon: 'download-outline', label: '下载', onPress: handleDownload },
    { key: 'swap', icon: 'swap-horizontal', label: '换源完整版', onPress: () => { setShowActions(false); setSwapSuccess(false); setSwapLoading(false); setSwapCandidates([]); setSwapSource(null); setSwapVisible(true); } },
    { key: 'artist', icon: 'person-outline', label: '搜索歌手', onPress: handleSearchArtist },
  ];

  const handlePress = () => {
    if (pressingAction) return;
    console.log(`[SongRow] handlePress: id=${song.id}, name=${song.name}`);
    if (onPress) {
      onPress(song);
    } else if (queueSongs) {
      const idx = queueSongs.findIndex(s => s.id === song.id);
      usePlayerStore.getState().setQueue(queueSongs, Math.max(0, idx));
      playSong(song);
    } else {
      usePlayerStore.getState().setQueue([song], 0);
      playSong(song);
    }
  };

  const handleFavorite = () => {
    setPressingAction(true);
    setTimeout(() => setPressingAction(false), 100);
    if (favorited) {
      removeFavorite(song.id);
    } else {
      addFavorite(song);
    }
  };

  const sourceKey = song.sourceType as SourceKey;

  return (
    <>
      <TouchableOpacity
      style={styles.container}
      onPress={handlePress}
      activeOpacity={0.6}
    >
      {rank !== undefined && (
        <Text style={styles.rank}>{rank}</Text>
      )}

      {cover ? (
        <Image source={{ uri: cover }} style={styles.cover} onError={handleCoverError} />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]}>
          <Ionicons name="musical-note" size={22} color="#555" />
        </View>
      )}

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {song.name}
        </Text>
        <Text style={styles.artist} numberOfLines={1}>
          {song.artist}
        </Text>
      </View>

      {showSource && (
        <View style={[styles.sourceBadge, { backgroundColor: SOURCE_COLORS[sourceKey] || '#666' }]}>
          <Text style={styles.sourceText}>
            {SOURCE_LABELS[sourceKey] || sourceKey}
          </Text>
        </View>
      )}

      {audioTag === 'preview' && (
        <View style={styles.tagBadgePreview}>
          <Text style={styles.tagText}>短时长</Text>
        </View>
      )}
      {audioTag === 'invalid' && (
        <View style={styles.tagBadgeInvalid}>
          <Text style={styles.tagText}>无效</Text>
        </View>
      )}

      <TouchableOpacity
        onPress={handleFavorite}
        style={styles.favoriteBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons
          name={favorited ? 'heart' : 'heart-outline'}
          size={20}
          color={favorited ? '#e74c3c' : '#666'}
        />
      </TouchableOpacity>
      <TouchableOpacity onPress={handleMore} style={styles.moreBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="ellipsis-vertical" size={18} color="#666" />
      </TouchableOpacity>
    </TouchableOpacity>

    <Modal visible={showActions} animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={() => setShowActions(false)}>
      <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowActions(false)}>
        <View style={[styles.actionSheet, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.actionSheetTitle} numberOfLines={1}>{song.name}</Text>
          {MORE_ACTIONS.map(a => (
            <TouchableOpacity key={a.key} style={styles.actionItem} onPress={a.onPress}>
              <Ionicons name={a.icon as any} size={22} color="#fff" />
              <Text style={styles.actionLabel}>{a.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.actionCancel} onPress={() => setShowActions(false)}>
            <Text style={styles.cancelText}>取消</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
    <AddToPlaylistModal
      visible={showPlaylistModal}
      song={song}
      onClose={() => setShowPlaylistModal(false)}
    />
    <SourceSwapModal
      visible={swapVisible}
      songName={song.name}
      currentSource={song.sourceType}
      candidates={swapCandidates}
      loading={swapLoading}
      success={swapSuccess}
      onSelectSource={handleSelectSource}
      onSelectCandidate={handleSelectCandidate}
      onBack={handleSwapBack}
      onClose={() => setSwapVisible(false)}
    />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#1a1a2e',
  },
  rank: {
    color: '#888',
    fontSize: 14,
    fontWeight: '600',
    width: 28,
    textAlign: 'center',
    marginRight: 4,
  },
  cover: {
    width: 44,
    height: 44,
    borderRadius: 6,
    marginRight: 12,
  },
  coverPlaceholder: {
    backgroundColor: '#16213e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  info: {
    flex: 1,
    marginRight: 8,
  },
  name: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  artist: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  sourceBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 8,
  },
  sourceText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  tagBadgePreview: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 8,
    backgroundColor: '#e67e22',
  },
  tagBadgeInvalid: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 8,
    backgroundColor: '#e74c3c',
  },
  tagText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  favoriteBtn: {
    padding: 4,
  },
  moreBtn: {
    padding: 4,
    marginLeft: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  actionSheet: {
    backgroundColor: '#16213e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 32,
  },
  actionSheetTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 16,
    textAlign: 'center',
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a4a',
  },
  actionLabel: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 12,
  },
  actionCancel: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#2a2a4a',
    alignItems: 'center',
  },
  cancelText: {
    color: '#888',
    fontSize: 16,
  },
});
