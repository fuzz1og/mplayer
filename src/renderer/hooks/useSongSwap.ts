import { useRef, useState } from 'react';
import { message } from 'antd';
import type { Song, SourceKey } from '@mplayer/core';
import { SWAP_SOURCES } from '@/renderer/components/SourceSwapModal';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { searchSwapCandidates, applySwap, type SwapCandidate } from '@/renderer/services/sourceSwap';

export interface SongSwapController {
  open: () => void;
  close: () => void;
  visible: boolean;
  loading: boolean;
  success: boolean;
  candidates: SwapCandidate[];
  onSelectSource: (source: SourceKey) => void;
  onSelectCandidate: (candidate: SwapCandidate) => void;
  onBack: () => void;
}

/**
 * 单曲换源的两阶段交互状态（选源 → 选候选），供列表行组件共用：
 * 换源成功后替换播放器队列（当前播放则续播），并通过 onSwapped 通知
 * 持有列表的页面更新行/持久化。
 */
export function useSongSwap(
  song: Song,
  onSwapped?: (original: Song, swapped: Song) => void
): SongSwapController {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [candidates, setCandidates] = useState<SwapCandidate[]>([]);
  const [source, setSource] = useState<SourceKey | null>(null);
  // 请求序号守卫：防止上一个源的慢搜索结果覆盖当前源候选（#391 后只剩搜索这一条异步）
  const requestSeqRef = useRef(0);

  const open = () => {
    requestSeqRef.current += 1;
    setSuccess(false);
    setLoading(false);
    setCandidates([]);
    setSource(null);
    setVisible(true);
  };

  const close = () => setVisible(false);

  /** 阶段 1：选目标源 → 搜索该源候选版本（前 3），交给用户选择 */
  const handleSelectSource = async (target: SourceKey) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setSuccess(false);
    const found = await searchSwapCandidates(song, target);
    if (seq !== requestSeqRef.current) return; // 期间已切换/关闭，丢弃过期结果
    setLoading(false);
    if (found.length === 0) {
      const label = SWAP_SOURCES.find(s => s.key === target)?.label || target;
      message.warning(`未在${label}找到可切换的版本`);
      return;
    }
    setSource(target);
    setCandidates(found);
  };

  /** 阶段 2：用户选中候选版本 → 应用换源（替换队列/续播/通知页面）。
   *  #391：探测删除后候选不再带可播性结论，也就没有「仍要切换吗」确认弹窗。 */
  const handleSelectCandidate = (candidate: SwapCandidate) => {
    void applyCandidate(candidate);
  };

  const applyCandidate = async (candidate: SwapCandidate) => {
    if (!source) return;
    setLoading(true);
    const swapped = applySwap(song, source, candidate);
    if (!swapped) {
      setLoading(false);
      message.error('换源失败，请重试');
      return;
    }
    setSuccess(true);
    try {
      await usePlayerStore.getState().replaceQueueSong(song.id, swapped);
      onSwapped?.(song, swapped);
    } catch (error) {
      console.error('换源应用失败（队列/列表更新）:', error);
      message.error('换源成功但列表更新失败，请重启应用后查看');
    } finally {
      setTimeout(() => {
        setVisible(false);
        setCandidates([]);
        setSource(null);
        setSuccess(false);
      }, 1200);
    }
  };

  const handleBack = () => {
    requestSeqRef.current += 1;
    setCandidates([]);
    setSource(null);
  };

  return {
    open, close, visible, loading, success, candidates,
    onSelectSource: handleSelectSource,
    onSelectCandidate: handleSelectCandidate,
    onBack: handleBack,
  };
}
