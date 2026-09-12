import { Alert } from 'react-native';
import { router } from 'expo-router';
import type { Song } from '@mplayer/core';
import { SOURCE_LABELS } from '../stores/sourceStore';
import { usePlayerStore } from '../stores/playerStore';
import { useLogsStore } from '../stores/logsStore';
import type { SongActionEffects } from '../stores/songActionsStore';
import { playSong } from './audioPlayer';
import { downloadSong } from './downloadService';
import { applySwap, probeSwapCandidates, searchSwapCandidates } from './sourceSwap';

/**
 * song actions 的平台效果实现（#304）：Alert / 路由 / 播放器队列 / 下载 / 日志。
 * 控制器（stores/songActionsStore.ts）与换源会话只认识注入的接口，
 * 这里是两者与 react-native 的唯一接缝——弹层内容搬出 SongRow 后，
 * 「换源怎么落到队列」「下载完弹什么」都集中在这一处。
 */
export const nativeSongActionEffects: SongActionEffects = {
  search: searchSwapCandidates,
  probe: probeSwapCandidates,
  apply: applySwap,

  /** 换源成功：替换队列（当前播放则续播）+ 诊断日志；未入队但正在播放的也续播 */
  onApplied: (song, swapped, candidate) => {
    const st = usePlayerStore.getState();
    const idx = st.queue.findIndex((s) => s.id === song.id);
    useLogsStore.getState().addLog(
      'info',
      `换源《${song.name}》: ${song.sourceType}→${swapped.sourceType}${candidate.exact ? '(完整版)' : ''}, 队列idx=${idx}, 当前播放id=${st.currentSong?.id}, 换源歌id=${song.id}`
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
  },

  onEmptySource: (source) => {
    Alert.alert('提示', `未在${SOURCE_LABELS[source]}找到可切换的版本`);
  },

  onApplyFailed: () => {
    Alert.alert('提示', '换源失败，请重试');
  },

  confirmUnplayable: (candidate, proceed) => {
    Alert.alert('提示', `《${candidate.song.name}》探测为不可播（链接可能失效），仍要切换吗？`, [
      { text: '取消', style: 'cancel' },
      { text: '仍要切换', onPress: proceed },
    ]);
  },

  /** 换源成功页停留 1.2s 再收起（会话侧带序号守卫，不会误关新弹层） */
  scheduleClose: (run) => { setTimeout(run, 1200); },

  download: (song: Song) => {
    downloadSong(song)
      .then(() => Alert.alert('提示', `《${song.name}》下载完成，可在本地歌曲页播放`))
      .catch((e) => {
        console.error('[player]', `下载失败《${song.name}》:`, e);
        Alert.alert('下载失败', `《${song.name}》: ${e instanceof Error ? e.message : String(e)}`);
      });
  },

  searchArtist: (song: Song) => {
    // type=artist：搜索结果页默认落在「歌手」次级 tab
    router.push(`/search?q=${encodeURIComponent(song.artist)}&type=artist`);
  },
};
