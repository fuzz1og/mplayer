import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Trash2, ListMusic, RefreshCw, User } from 'lucide-react';
import type { Song } from '@mplayer/core';
import SourceBadge from '@/renderer/components/SourceBadge';
import AudioTagBadge from '@/renderer/components/AudioTagBadge';
import SourceSwapModal from '@/renderer/components/SourceSwapModal';
import SongCover from '@/renderer/components/SongCover';
import { type RowActionItem } from '@/renderer/components/RowActionMenu';
import RowActionButtons from '@/renderer/components/RowActionButtons';
import { useSongSwap } from '@/renderer/hooks/useSongSwap';
import { useSearchStore } from '@/renderer/store/searchStore';
import { searchService } from '@/renderer/services/searchService';

interface SongRowProps {
  song: Song;
  index: number;
  isCurrentSong?: boolean;
  isPlaying?: boolean;
  isFavorite?: boolean;
  showIndex?: boolean;
  showCheckbox?: boolean;
  isSelected?: boolean;
  showRemoveFromPlaylist?: boolean;
  /** 「更多」菜单是否开在本行：由列表模块把 activeDropdown 折算成布尔量，避免开一个菜单重渲染整表 */
  moreOpen?: boolean;
  onPlay: (song: Song) => void;
  onToggleFavorite?: (song: Song) => void;
  onDownload?: (song: Song) => void;
  onAddToPlaylist?: (song: Song) => void;
  onRemoveFromPlaylist?: (song: Song) => void;
  /** 换源成功回调：父组件用它更新自己的列表 state（收藏/歌单页同时持久化） */
  onSwap?: (original: Song, swapped: Song) => void;
  onToggleSelect?: (songId: string) => void;
  onToggleDropdown?: (songId: string, e: React.MouseEvent) => void;
  onCloseDropdown?: (e: React.MouseEvent) => void;
  /** 封面加载失败时回调，由持有歌曲列表的层按 ID 重识别换新封面 */
  onCoverError?: (song: Song) => void;
  /** 是否显示专辑列（列表层按整列是否有专辑判断，无专辑列表整列塌缩） */
  showAlbum?: boolean;
  /** 专辑列宽（默认 180px；队列页沿用 120px） */
  albumWidth?: number;
  /**
   * 标题区是否吸收剩余宽度：默认按「固定标题列 + 弹性留白 + 专辑列 + 操作列」的表格布局，
   * 置 true 时标题撑满（无专辑列、行尾按钮自带宽度的场景，如队列页/本地歌单页）
   */
  fillTitle?: boolean;
  /** 拖拽句柄插槽：渲染在序号列内（有句柄时序号列与句柄同格，队列页/歌单页拖拽排序用） */
  dragHandle?: React.ReactNode;
  /** 行尾操作区插槽：缺省用共享的 RowActionButtons（下载/收藏/更多） */
  actions?: React.ReactNode;
  /** 行根节点 ref：供 dnd-kit 等外部能力挂载 */
  rowRef?: React.Ref<HTMLDivElement>;
  compact?: boolean;
  style?: React.CSSProperties;
}

const SongRow: React.FC<SongRowProps> = ({
  song, index, isCurrentSong = false, isPlaying = false, isFavorite = false,
  showIndex = true, showCheckbox = false, isSelected = false, showRemoveFromPlaylist = false,
  moreOpen = false, onPlay, onToggleFavorite, onDownload,
  onAddToPlaylist, onRemoveFromPlaylist, onToggleSelect,
  onToggleDropdown, onCloseDropdown, onCoverError, onSwap, showAlbum = true, albumWidth = 180,
  fillTitle = false, dragHandle, actions, rowRef, compact = false, style,
}) => {
  const dropdownTriggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  // 空封面挂载触发一次（StrictMode 下 effect 双跑，用 ref 防重复）
  const coverRefreshFired = useRef(false);

  const swap = useSongSwap(song, onSwap);

  /** 查看歌手：以歌手名为关键词搜索并落在歌手 tab（与移动端一致） */
  const handleViewArtist = () => {
    if (!song.artist) return;
    useSearchStore.getState().setPreferredTab('artists');
    void searchService.search(song.artist);
    navigate('/discover');
  };

  // 操作统一收进「更多」菜单：加入歌单（提供处理器才有入口）、换源、查看歌手、从歌单移除（危险项居末）；
  // 本地文件不提供换源（spec 范围外）
  const menuItems: RowActionItem[] = [];
  if (onAddToPlaylist) {
    menuItems.push({ key: 'playlist', label: '加入歌单', icon: <ListMusic size={14} />, onClick: () => onAddToPlaylist(song) });
  }
  if (song.sourceType !== 'local') {
    menuItems.push({ key: 'swap', label: '换源完整版', ariaLabel: '换源完整版', icon: <RefreshCw size={14} />, onClick: swap.open });
  }
  if (song.artist) {
    menuItems.push({ key: 'artist', label: '查看歌手', ariaLabel: '查看歌手', icon: <User size={14} />, onClick: handleViewArtist });
  }
  if (showRemoveFromPlaylist && onRemoveFromPlaylist) {
    menuItems.push({ key: 'remove', label: '从歌单移除', icon: <Trash2 size={14} />, danger: true, onClick: () => onRemoveFromPlaylist(song) });
  }

  // cover 为空（如收藏/历史里从未存过封面）时挂载即触发一次刷新，显示层不依赖 onError
  useEffect(() => {
    if (!song.cover && !coverRefreshFired.current) {
      coverRefreshFired.current = true;
      onCoverError?.(song);
    }
    // 仅挂载时触发：封面刷新后 song.cover 变化会自然进入正常渲染路径
  }, []);

  return (
    <div
      ref={rowRef}
      className="song-row"
      onDoubleClick={() => onPlay(song)}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: compact ? '8px 12px' : '10px 16px',
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        backgroundColor: isCurrentSong ? 'rgba(47, 95, 208, 0.10)' : 'transparent',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!isCurrentSong) {
          e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isCurrentSong) {
          e.currentTarget.style.backgroundColor = 'transparent';
        }
      }}
    >
      {showCheckbox && (
        <div style={{ width: '40px', textAlign: 'center' }}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => { e.stopPropagation(); onToggleSelect?.(song.id); }}
            style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: 'var(--accent)' }}
          />
        </div>
      )}
      {(showIndex || dragHandle) && (
        <div style={{ width: showIndex ? '50px' : '30px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
          {dragHandle}
          {showIndex && (isCurrentSong && isPlaying ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
              <span style={{ width: '3px', height: '12px', backgroundColor: 'var(--accent)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0s' }} />
              <span style={{ width: '3px', height: '16px', backgroundColor: 'var(--accent)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0.1s' }} />
              <span style={{ width: '3px', height: '10px', backgroundColor: 'var(--accent)', animation: 'soundBar 0.5s ease-in-out infinite', animationDelay: '0.2s' }} />
            </div>
          ) : (
            <span style={{ fontSize: '14px', color: isCurrentSong ? 'var(--accent)' : 'var(--text-tertiary)', fontWeight: isCurrentSong ? 600 : 400 }}>
              {index + 1}
            </span>
          ))}
        </div>
      )}
      {/* Song info */}
      <div style={fillTitle
        ? { flex: 1, display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }
        : { width: '38%', maxWidth: '380px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
        <div style={{ width: '44px', height: '44px', borderRadius: '8px', overflow: 'hidden', backgroundColor: 'var(--bg-hover)', flexShrink: 0, position: 'relative' }}>
          <SongCover src={song.cover} alt={song.name} variant="gradient" onError={() => onCoverError?.(song)} />
          <div
            style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.15s ease' }}
            onClick={() => onPlay(song)}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0'; }}
          >
            <Play size={16} color="white" fill="white" />
          </div>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '15px', fontWeight: isCurrentSong ? 600 : 400, color: isCurrentSong ? 'var(--accent)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {song.name}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.artist}</span>
            <SourceBadge sourceType={song.sourceType} />
            {song.audioTag === 'preview' && <AudioTagBadge tag="preview" />}
            {song.audioTag === 'invalid' && <AudioTagBadge tag="invalid" />}
          </div>
        </div>
      </div>
      {/* 弹性占位：把专辑列和操作列推到右侧，标题区限宽后剩余空间留白（标题撑满时不需要） */}
      {!fillTitle && <div style={{ flex: 1, minWidth: 0 }} />}
      {/* Album */}
      {!compact && showAlbum && (
        <div style={{ width: `${albumWidth}px`, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {song.album}
        </div>
      )}
      {/* Actions：缺省用共享操作区，调用方可整块替换（如队列页的加入歌单/移除） */}
      {actions ?? (
        <RowActionButtons
          song={song}
          isFavorite={isFavorite}
          onToggleFavorite={onToggleFavorite}
          onDownload={onDownload}
          moreOpen={moreOpen}
          moreTriggerRef={dropdownTriggerRef}
          onToggleMore={(e) => onToggleDropdown?.(song.id, e)}
          onCloseMore={onCloseDropdown ?? (() => {})}
          menuItems={menuItems}
        />
      )}
      <SourceSwapModal
        open={swap.visible}
        songName={song.name}
        currentSource={song.sourceType}
        candidates={swap.candidates}
        loading={swap.loading}
        success={swap.success}
        onSelectSource={swap.onSelectSource}
        onSelectCandidate={swap.onSelectCandidate}
        onBack={swap.onBack}
        onClose={swap.close}
      />
    </div>
  );
};

export default React.memo(SongRow);
