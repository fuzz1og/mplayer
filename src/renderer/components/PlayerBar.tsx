import React, { useCallback, useState } from 'react';
import { Heart, Download, Mic, ListMusic } from 'lucide-react';
import { usePlayerStore } from '@/renderer/store/playerStore';
import { useFavoriteStore } from '@/renderer/store/favoriteStore';
import AddToPlaylistModal from '@/renderer/components/AddToPlaylistModal';
import SongCover from '@/renderer/components/SongCover';
import { refreshSongCover } from '@/renderer/utils/songCoverRefresh';
import { useDownload } from '@/renderer/hooks/useDownload';
import PlayerControls from './PlayerControls';
import PlayerProgress from './PlayerProgress';
import PlayerVolume from './PlayerVolume';

interface PlayerBarProps {
  className?: string;
  onCoverClick?: () => void;
}

const PlayerBar: React.FC<PlayerBarProps> = ({ className, onCoverClick }) => {
  const currentSong = usePlayerStore(s => s.currentSong);
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const isLoading = usePlayerStore(s => s.isLoading); // #387 等待态
  const volume = usePlayerStore(s => s.volume);
  const playMode = usePlayerStore(s => s.playMode);
  const pause = usePlayerStore(s => s.pause);
  const resume = usePlayerStore(s => s.resume);
  const seek = usePlayerStore(s => s.seek);
  const setVolume = usePlayerStore(s => s.setVolume);
  const setPlayMode = usePlayerStore(s => s.setPlayMode);
  const playNext = usePlayerStore(s => s.playNext);
  const playPrevious = usePlayerStore(s => s.playPrevious);

  // 收藏态必须选**数据**（原生布尔）：选 store 上的 isFavorite 方法拿到的是稳定引用，
  // favoriteIds 变化不触发重渲染，心形永远停在旧值（#620，引入于 af107fb）。
  const fav = useFavoriteStore((s) => (currentSong ? s.favoriteIds.includes(currentSong.id) : false));
  const toggleFavorite = useFavoriteStore((s) => s.toggleFavorite);
  // 当前歌加入歌单弹窗（播放栏直达入口）
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const { download } = useDownload();

  const handlePlayPause = useCallback(() => {
    if (!currentSong) return;
    if (isPlaying) pause();
    else resume();
  }, [currentSong, isPlaying, pause, resume]);

  const handleVolumeChange = useCallback((vol: number) => {
    setVolume(vol);
  }, [setVolume]);

  const handleDownload = useCallback(() => {
    if (currentSong) {
      download(currentSong);
    }
  }, [currentSong, download]);

  // 播放栏封面加载失败 → 按 ID 重识别换新封面（上游 API 签名过期后同一 URL 永远失败）
  const handleCoverError = useCallback(() => {
    if (!currentSong) return;
    void refreshSongCover(currentSong).then((cover) => {
      if (!cover) return;
      usePlayerStore.setState((state) =>
        state.currentSong?.id === currentSong.id ? { currentSong: { ...state.currentSong, cover } } : state
      );
    });
  }, [currentSong]);

  return (
    <div className={className ? `player-bar ${className}` : 'player-bar'}>
      {/* 左侧 - 封面 + 歌曲信息 */}
      <div className="player-bar__now-playing">
        {/* 封面 */}
        <button
          onClick={onCoverClick}
          aria-label="查看歌词"
          className={onCoverClick ? 'player-bar__cover player-bar__cover--clickable' : 'player-bar__cover'}
        >
          <SongCover
            src={currentSong?.cover}
            alt={currentSong?.name || ''}
            variant="icon"
            iconSize={20}
            onError={handleCoverError}
          />
        </button>

        {/* 歌曲信息 */}
        <div className="player-bar__meta">
          <div className="player-bar__title-row">
            {isPlaying && currentSong && (
              <span className="player-bar__equalizer">
                <span />
                <span />
                <span />
              </span>
            )}
            <span className="player-bar__title">
              {currentSong?.name || '未播放'}
            </span>
          </div>
          <div className="player-bar__artist">
            {currentSong ? `${currentSong.artist}` : '—'}
          </div>
        </div>
      </div>

      {/* 中间 - 控制按钮 + 进度条 */}
      <div className="player-bar__center">
        <PlayerControls
          isPlaying={isPlaying}
          loading={isLoading}
          hasCurrentSong={!!currentSong}
          playMode={playMode}
          onPlayPause={handlePlayPause}
          onPrev={playPrevious}
          onNext={playNext}
          onModeChange={setPlayMode}
        />
        {/* 位置/时长不进播放栏：进度块自己订阅 playbackClock，tick 不重渲染 PlayerBar */}
        <PlayerProgress hasCurrentSong={!!currentSong} onSeek={seek} />
      </div>

      {/* 右侧 - 功能按钮 */}
      <div className="player-bar__actions">
        {/* 收藏按钮 */}
        <button
          onClick={() => currentSong && toggleFavorite(currentSong)}
          disabled={!currentSong}
          aria-label={fav ? '取消收藏' : '收藏'}
          aria-pressed={fav}
          className="player-btn player-bar__favorite"
        >
          <Heart size={16} fill={fav ? 'currentColor' : 'none'} />
        </button>

        {/* 加入歌单 */}
        <button
          onClick={() => setShowAddToPlaylist(true)}
          disabled={!currentSong}
          aria-label="加入歌单"
          className="player-btn"
        >
          <ListMusic size={16} />
        </button>

        {/* 歌词按钮 */}
        <button
          onClick={onCoverClick}
          disabled={!currentSong}
          aria-label="歌词"
          className="player-btn"
        >
          <Mic size={16} />
        </button>

        {/* 下载按钮 */}
        <button
          onClick={handleDownload}
          disabled={!currentSong}
          aria-label="下载"
          className="player-btn"
        >
          <Download size={16} />
        </button>

        {/* 音量控制 */}
        <PlayerVolume
          volume={volume}
          onVolumeChange={handleVolumeChange}
          onToggleMute={() => setVolume(volume === 0 ? 80 : 0)}
        />
      </div>

      {/* 加入歌单弹窗（对当前播放歌曲） */}
      {currentSong && (
        <AddToPlaylistModal
          song={currentSong}
          isVisible={showAddToPlaylist}
          onClose={() => setShowAddToPlaylist(false)}
        />
      )}
    </div>
  );
};

export default PlayerBar;
