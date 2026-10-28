import React, { useEffect, useRef } from 'react';
import '@/renderer/styles/songlist.css';
import { useNavigate } from 'react-router-dom';
import { Play, Trash2, RefreshCw, User, ListPlus, CirclePlus } from 'lucide-react';
import type { Song } from '@mplayer/core';
import SourceBadge from '@/renderer/components/SourceBadge';
import AudioTagBadge from '@/renderer/components/AudioTagBadge';
import SourceSwapModal from '@/renderer/components/SourceSwapModal';
import SongCover from '@/renderer/components/SongCover';
import { type RowActionItem } from '@/renderer/components/RowActionMenu';
import RowActionButtons from '@/renderer/components/RowActionButtons';
import { COL_CHECKBOX, COL_ALBUM, COL_DURATION, COL_DURATION_LIBRARY, colWidth, songIndexWidth } from '@/renderer/components/songTableColumns';
import { songRowCoverSize, songRowHeight } from '@/renderer/components/songRowMetrics';
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
  /** 当前展示队列（点播契约 #697）：行只回传，不写 playerStore */
  queue: Song[];
  onPlay: (song: Song, queue: Song[], index: number) => void;
  onToggleFavorite?: (song: Song) => void;
  onDownload?: (song: Song) => void;
  onAddToPlaylist?: (song: Song) => void;
  /** 「下一首播放」（#491）：把该曲挪/插到当前曲之后，不打断当前播放 */
  onPlayNext?: (song: Song) => void;
  onRemoveFromPlaylist?: (song: Song) => void;
  /** 换源成功回调：父组件用它更新自己的列表 state（收藏/歌单页同时持久化） */
  onSwap?: (original: Song, swapped: Song) => void;
  onToggleSelect?: (songId: string) => void;
  onToggleDropdown?: (songId: string, e: React.MouseEvent) => void;
  onCloseDropdown?: () => void;
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
  /** 行密度变体：standard = 通用列表（64px），library = 资料库密度（46px、行操作 hover 才出现） */
  variant?: 'standard' | 'library';
  /** 是否显示时长列（固定 50px，library 密度资料库行使用） */
  showDuration?: boolean;
  /**
   * 序号列宽（场景覆盖）：缺省按密度取 28/50，榜单预览用 24。
   * 列宽按场景配置（规格 L127），行不改排版。
   */
  indexWidth?: number;
  /**
   * 行尾插槽（渲染函数，不是元素）：渲染在操作按钮之前，如搜索结果的「N 个版本」。
   * 传元素会让每帧新建的 ReactNode 击穿行的 memo，与 renderActions 同理。
   */
  renderActionsLead?: (song: Song, index: number) => React.ReactNode;
  /** 行尾只保留单个 28px「更多」按钮，下载 / 收藏收进菜单 */
  compactActions?: boolean;
  style?: React.CSSProperties;
}

/** 秒 → m:ss；缺失 / 非法值显示 --:--（沿用资料库行尾原口径）。 */
const formatDuration = (seconds?: number): string => {
  if (!seconds || !Number.isFinite(seconds)) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins + ':' + secs.toString().padStart(2, '0');
};

const SongRow: React.FC<SongRowProps> = ({
  song, index, isCurrentSong = false, isPlaying = false, isFavorite = false,
  showIndex = true, showCheckbox = false, isSelected = false, showRemoveFromPlaylist = false,
  moreOpen = false, queue, onPlay, onToggleFavorite, onDownload,
  onAddToPlaylist, onPlayNext, onRemoveFromPlaylist, onToggleSelect,
  onToggleDropdown, onCloseDropdown, onCoverError, onSwap, showAlbum = true, albumWidth = COL_ALBUM,
  fillTitle = false, dragHandle, actions, rowRef, compact = false,
  variant = 'standard', showDuration = false, compactActions = false, style,
  indexWidth, renderActionsLead,
}) => {
  const dropdownTriggerRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  // 空封面挂载触发一次（StrictMode 下 effect 双跑，用 ref 防重复）
  const coverRefreshFired = useRef(false);

  const swap = useSongSwap(song, onSwap);
  const library = variant === 'library';
  // 列宽按密度取契约值：序号 28 / 时长 44（资料库），调用方可用 indexWidth 覆盖（榜单预览 24）
  const indexColWidth = indexWidth ?? songIndexWidth(library ? 'library' : 'standard', showIndex);
  const durationColWidth = library ? COL_DURATION_LIBRARY : COL_DURATION;

  /** 查看歌手：以歌手名为关键词搜索并落在歌手 tab（与移动端一致） */
  const handleViewArtist = () => {
    if (!song.artist) return;
    useSearchStore.getState().setPreferredTab('artists');
    void searchService.search(song.artist);
    navigate('/discover');
  };

  // 操作统一收进「更多」菜单：下一首播放（#491，提供处理器才有入口）、加入歌单、换源、查看歌手、
  // 从歌单移除（危险项居末）；本地文件不提供换源（spec 范围外）
  const menuItems: RowActionItem[] = [];
  if (onPlayNext) {
    menuItems.push({ key: 'playNext', label: '下一首播放', icon: <ListPlus size={14} />, onClick: () => onPlayNext(song) });
  }
  if (onAddToPlaylist) {
    menuItems.push({ key: 'playlist', label: '加入歌单', icon: <CirclePlus size={14} />, onClick: () => onAddToPlaylist(song) });
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

  // 1.9.0：结构/状态色全部走 songlist.css 的类；这里只下发密度协议的行高/封面变量
  // （自定义属性允许内联，design-lint 白名单）与调用方传入的 style（拖拽位移等动态值）。
  return (
    <div
      ref={rowRef}
      className="song-row"
      data-variant={library ? 'library' : undefined}
      data-compact={compact || undefined}
      data-current={isCurrentSong || undefined}
      onDoubleClick={() => onPlay(song, queue, index)}
      style={{ '--song-row-height': `${songRowHeight(variant)}px`,
        '--song-row-cover': `${songRowCoverSize(variant)}px`, ...style } as React.CSSProperties}
    >
      {showCheckbox && (
        <div className="song-row__check" style={colWidth(COL_CHECKBOX)}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => { e.stopPropagation(); onToggleSelect?.(song.id); }}
          />
        </div>
      )}
      {(showIndex || dragHandle) && (
        <div className="song-row__index" style={colWidth(indexColWidth)}>
          {dragHandle}
          {showIndex && (isCurrentSong && isPlaying ? (
            <div className="song-row__bars">
              <span className="song-row__bar" />
              <span className="song-row__bar" />
              <span className="song-row__bar" />
            </div>
          ) : (
            <span className="song-row__number" data-current={isCurrentSong || undefined}>
              {index + 1}
            </span>
          ))}
        </div>
      )}
      {/* Song info */}
      <div className="song-row__main" data-fill={fillTitle ? 'true' : 'false'}>
        <div className="song-row__cover">
          <SongCover src={song.cover} alt={song.name} variant="gradient" onError={() => onCoverError?.(song)} />
          <div className="song-row__cover-play" onClick={() => onPlay(song, queue, index)}>
            <Play size={16} color="white" fill="white" />
          </div>
        </div>
        <div className="song-row__text">
          <div className="song-row__title" data-current={isCurrentSong || undefined}>
            {song.name}
          </div>
          <div className="song-row__meta">
            <span className="song-row__artist">{song.artist}</span>
            <SourceBadge sourceType={song.sourceType} />
            {song.audioTag === 'preview' && <AudioTagBadge tag="preview" />}
            {song.audioTag === 'invalid' && <AudioTagBadge tag="invalid" />}
          </div>
        </div>
      </div>
      {/* 弹性占位：把专辑列和操作列推到右侧，标题区限宽后剩余空间留白（标题撑满时不需要） */}
      {!fillTitle && <div className="song-row__spacer" />}
      {/* Album */}
      {!compact && showAlbum && (
        <div className="song-row__album" style={colWidth(albumWidth)}>
          {song.album}
        </div>
      )}
      {showDuration && (
        <div className="song-row__duration" style={colWidth(durationColWidth)}>
          {formatDuration(song.duration)}
        </div>
      )}
      {/* 行尾轻量按钮插槽（如搜索结果「N 个版本」）：常驻可见，不进 hover 才出现的操作区 */}
      {renderActionsLead?.(song, index)}
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
          compact={compactActions}
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
