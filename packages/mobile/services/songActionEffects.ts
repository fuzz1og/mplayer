import { Alert } from 'react-native';
import { router } from 'expo-router';
import type { Song } from '@mplayer/core';
import { SOURCE_LABELS } from '../stores/sourceStore';
import { usePlayerStore } from '../stores/playerStore';
import { useLogsStore } from '../stores/logsStore';
import type { SongActionEffects } from '../stores/songActionsStore';
import { playNextInQueue, playSong } from './audioPlayer';
import { downloadSong } from './downloadService';
import { applySwap, searchSwapCandidates } from './sourceSwap';

/**
 * song actions 的平台效果实现（#304）：Alert / 路由 / 播放器队列 / 下载 / 日志。
 * 控制器（stores/songActionsStore.ts）与换源会话只认识注入的接口，
 * 这里是两者与 react-native 的唯一接缝——弹层内容搬出 SongRow 后，
 * 「换源怎么落到队列」「下载完弹什么」都集中在这一处。
 */
export const nativeSongActionEffects: SongActionEffects = {
  search: searchSwapCandidates,
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

  /**
   * 「下一首播放」（#495）。
   *
   * 两个坑都在这里显式处理，目的是**不让用户看到静默无效**：
   * ① 失败冷却/新鲜度是按 key 的（`queuePrefetch`），刚失败过的歌若沿用补窗闸门会在 30s 内
   *    静默无效 → `playNextInQueue` 绕开这两个闸门，失败就立刻给文案；
   * ② 已在下一首位置 / 就是当前曲 = no-op（幂等），要告诉用户「已就位」而不是装作做了事。
   */
  insertNext: async (song: Song) => {
    const logs = useLogsStore.getState();
    try {
      const outcome = await playNextInQueue(song);
      if (outcome.queued) {
        if (outcome.noop) {
          // 幂等命中（已在下一首位置 / 就是当前曲）：队列一字未改，但要如实告知，
          // 不能让用户以为「点了没反应」。
          logs.setNotice('info', `《${song.name}》已经在下一首位置`);
        } else {
          const text = outcome.moved
            ? `已把《${song.name}》移到下一首`
            : `《${song.name}》已设为下一首`;
          logs.setNotice('info', text);
          logs.addLog('info', `下一首播放：《${song.name}》${outcome.moved ? '（移动）' : '（插入）'}`);
        }
      } else {
        const text = outcome.reason === 'unsupported'
          ? '当前播放器不支持改动队列，无法插队'
          : `《${song.name}》暂时无法插队（解析不到可播地址）`;
        logs.setNotice('error', text);
        logs.addLog('warn', `下一首播放失败：《${song.name}》reason=${outcome.reason ?? 'unknown'}`);
      }
      return outcome;
    } catch (error) {
      console.error('[player]', `下一首播放失败《${song.name}》:`, error);
      logs.setNotice('error', `《${song.name}》下一首播放失败`);
      return { queued: false, moved: false, reason: 'failed' as const };
    }
  },
};
