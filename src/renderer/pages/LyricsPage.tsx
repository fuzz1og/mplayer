import React, { useEffect, useMemo } from 'react';
import { ArrowLeft, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { CSSProperties } from 'react';
import LyricsDisplay from '@/renderer/components/LyricsDisplay';
import SongCover from '@/renderer/components/SongCover';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { Button } from '@/renderer/ui';
import '@/renderer/styles/player.css';

interface LyricsPageProps {
  onBack: () => void;
}

/**
 * 全屏播放器（1.9.0 的签名帧）：封面取色生成环境光，歌词是主体，头部保留返回与传输控制。
 * 环境光只用两团低饱和径向渐变，无封面时透明——不做发光描边、不做渐变按钮。
 */
const LyricsPage: React.FC<LyricsPageProps> = ({ onBack }) => {
  const lyrics = usePlayerStore((s) => s.lyrics);
  const lyricsLoading = usePlayerStore((s) => s.lyricsLoading);
  const currentSong = usePlayerStore((s) => s.currentSong);
  const seek = usePlayerStore((s) => s.seek);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const pause = usePlayerStore((s) => s.pause);
  const resume = usePlayerStore((s) => s.resume);
  const playPrevious = usePlayerStore((s) => s.playPrevious);
  const playNext = usePlayerStore((s) => s.playNext);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

  const handleLyricClick = (time: number) => {
    seek(time);
  };

  const handleCoverError = () => {
    if (!currentSong) return;
    void refreshSongCover(currentSong).then((cover) => {
      if (!cover) return;
      usePlayerStore.setState((state) =>
        state.currentSong?.id === currentSong.id ? { currentSong: { ...state.currentSong, cover } } : state
      );
    });
  };

  /**
   * 环境光取色：从封面 URL 的哈希推两种色相（避免为了取色引入 canvas 与跨域问题），
   * 无封面时不设变量 → CSS 里回退 transparent，视觉上就是纯色底。
   */
  const ambientStyle = useMemo<CSSProperties>(() => {
    const cover = currentSong?.cover;
    if (!cover) return {};
    let hash = 0;
    for (let i = 0; i < cover.length; i += 1) hash = (hash * 31 + cover.charCodeAt(i)) % 360;
    const hueA = hash;
    const hueB = (hash + 48) % 360;
    return {
      '--stage-glow-a': `hsl(${hueA} 42% 46% / 0.55)`,
      '--stage-glow-b': `hsl(${hueB} 38% 38% / 0.45)`,
    } as CSSProperties;
  }, [currentSong?.cover]);

  if (!currentSong) {
    return (
      <div className="lyrics-page">
        <div className="lyrics-page__empty">
          <span className="lyrics-page__empty-text">暂无播放中的歌曲</span>
          <Button variant="primary" onClick={onBack}>
            返回
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="lyrics-page">
      <div className="lyrics-page__ambient" style={ambientStyle} aria-hidden="true" />

      <div className="lyrics-page__content">
        <div className="lyrics-page__header">
          <button onClick={onBack} className="lyrics-page__back" aria-label="返回">
            <ArrowLeft size={16} />
            <span>返回</span>
          </button>

          <div className="lyrics-page__cover">
            <SongCover src={currentSong.cover} variant="icon" iconSize={18} onError={handleCoverError} />
          </div>

          <div className="lyrics-page__meta">
            <div className="lyrics-page__title">{currentSong.name}</div>
            <div className="lyrics-page__artist">{currentSong.artist}</div>
          </div>

          <div className="lyrics-page__controls">
            <button onClick={playPrevious} className="player-btn" aria-label="上一首">
              <SkipBack size={16} fill="currentColor" />
            </button>
            <button
              onClick={() => (isPlaying ? pause() : resume())}
              aria-label={isPlaying ? '暂停' : '播放'}
              className="lyrics-page__play"
            >
              {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
            </button>
            <button onClick={playNext} className="player-btn" aria-label="下一首">
              <SkipForward size={16} fill="currentColor" />
            </button>
          </div>
        </div>

        <div className="lyrics-page__body">
          {lyricsLoading ? (
            <div className="lyrics-page__loading">歌词加载中…</div>
          ) : (
            <>
              {/* 当前时间由 LyricsDisplay 自己订阅 playbackClock：页面不随采样 tick 重渲染 */}
              <LyricsDisplay lrcContent={lyrics || ''} onLyricClick={handleLyricClick} />
              {!lyrics && <div className="lyrics-page__none">当前歌曲暂无歌词</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LyricsPage;
