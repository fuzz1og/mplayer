import React from 'react';
import { COVER_SIZE, coverThumbUrl } from '@mplayer/core';
import { Play, RefreshCw, Music2 } from 'lucide-react';
import type { Song } from '@mplayer/core';
import SongCover from './SongCover';
import '@/renderer/styles/songlist.css';

interface DailyRecommendProps {
  songs: Song[];
  loading: boolean;
  onPlay: (song: Song) => void;
  onRefresh: () => void;
}

interface SongRowMiniProps {
  song: Song;
  onPlay: (song: Song) => void;
}

const SongRowMini: React.FC<SongRowMiniProps> = ({ song, onPlay }) => {
  return (
    <div onDoubleClick={() => onPlay(song)} className="daily__row">
      <div className="daily__row-cover">
        <SongCover src={song.cover} alt={song.name} variant="icon" iconSize={16} />
      </div>
      <div className="daily__row-text">
        <div className="daily__row-name">{song.name}</div>
        <div className="daily__row-artist">{song.artist}</div>
      </div>
      <button onClick={() => onPlay(song)} className="daily__row-play" aria-label="播放">
        <Play size={13} fill="currentColor" />
      </button>
    </div>
  );
};

const DailyRecommend: React.FC<DailyRecommendProps> = ({ songs, loading, onPlay, onRefresh }) => {
  const featured = songs[0];
  const listSongs = songs.slice(0, 5);

  if (loading && songs.length === 0) {
    return (
      <div className="daily">
        <div className="skeleton-shimmer daily__sk-cover" />
        <div className="daily__sk-list">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="daily__sk-row">
              <div className="skeleton-shimmer daily__sk-thumb" />
              <div className="daily__sk-lines">
                <div className="skeleton-shimmer daily__sk-line daily__sk-line--title" />
                <div className="skeleton-shimmer daily__sk-line daily__sk-line--artist" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (songs.length === 0) {
    return (
      <div className="daily__empty">
        <Music2 size={20} className="daily__empty-icon" />
        暂无推荐歌曲
      </div>
    );
  }

  return (
    <div className="daily">
      <div onClick={() => featured && onPlay(featured)} className="daily__featured">
        {/* 封面用绝对定位的容器包住，SongCover 自身不需要新 prop */}
        <div className="daily__featured-cover">
          <SongCover
            src={featured?.cover ? coverThumbUrl(featured.cover, COVER_SIZE.hero) : featured?.cover}
            alt={featured?.name ?? ''}
            variant="gradient"
          />
        </div>
        <div className="daily__featured-scrim" />
        <div className="daily__featured-body">
          <div className="daily__badge">今日主打</div>
          <div className="daily__featured-title">{featured.name}</div>
          <div className="daily__featured-artist">{featured.artist}</div>
          <button onClick={(e) => { e.stopPropagation(); onPlay(featured); }} className="daily__featured-play" aria-label="播放">
            <Play size={16} fill="currentColor" />
          </button>
        </div>
      </div>

      <div className="daily__list">
        <div className="daily__list-head">
          <span className="daily__list-title">为你推荐</span>
          <button onClick={onRefresh} className="daily__refresh" title="换一批">
            <RefreshCw size={14} />
            换一批
          </button>
        </div>
        <div className="daily__list-body">
          {listSongs.map((song, index) => (
            <SongRowMini key={`${song.id}-${index}`} song={song} onPlay={onPlay} />
          ))}
        </div>
      </div>
    </div>
  );
};

export default DailyRecommend;
