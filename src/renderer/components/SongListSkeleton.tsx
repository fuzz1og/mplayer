import React from 'react';
import '@/renderer/styles/songlist.css';
import { COL_CHECKBOX, COL_INDEX, COL_ALBUM, COL_ACTIONS, colWidth } from '@/renderer/components/songTableColumns';

interface SongListSkeletonProps {
  rowCount?: number;
  showCheckbox?: boolean;
  showIndex?: boolean;
  /**
   * 真实列表会不会显示专辑列。骨架屏必须与之一致——以前骨架屏缺专辑列和操作列，
   * 于是「加载态比加载后窄」，这类列错位在数据到达前根本看不见。
   */
  showAlbum?: boolean;
}

const SkeletonRow: React.FC<{ showCheckbox: boolean; showIndex: boolean; showAlbum: boolean }> = ({
  showCheckbox, showIndex, showAlbum,
}) => (
  <div className="song-skeleton__row">
    {showCheckbox && (
      <div className="song-skeleton__col" style={colWidth(COL_CHECKBOX)}>
        <div className="skeleton-shimmer song-skeleton__box song-skeleton__box--check" />
      </div>
    )}
    {showIndex && (
      <div className="song-skeleton__col" style={colWidth(COL_INDEX)}>
        <div className="skeleton-shimmer song-skeleton__box song-skeleton__box--index" />
      </div>
    )}
    <div className="song-skeleton__main">
      <div className="skeleton-shimmer song-skeleton__box song-skeleton__box--cover" />
      <div className="song-skeleton__lines">
        <div className="skeleton-shimmer song-skeleton__box song-skeleton__box--title" />
        <div className="skeleton-shimmer song-skeleton__box song-skeleton__box--artist" />
      </div>
    </div>
    {showAlbum && (
      <div className="song-skeleton__col" style={colWidth(COL_ALBUM)}>
        <div className="skeleton-shimmer song-skeleton__box song-skeleton__box--album" />
      </div>
    )}
    <div className="song-skeleton__actions" style={colWidth(COL_ACTIONS)}>
      <div className="skeleton-shimmer song-skeleton__box song-skeleton__box--action" />
      <div className="skeleton-shimmer song-skeleton__box song-skeleton__box--action" />
      <div className="skeleton-shimmer song-skeleton__box song-skeleton__box--action" />
    </div>
  </div>
);

const SongListSkeleton: React.FC<SongListSkeletonProps> = ({
  rowCount = 10,
  showCheckbox = false,
  showIndex = true,
  showAlbum = false,
}) => (
  <div className="song-skeleton">
    {Array.from({ length: rowCount }).map((_, i) => (
      <SkeletonRow key={i} showCheckbox={showCheckbox} showIndex={showIndex} showAlbum={showAlbum} />
    ))}
  </div>
);

export default SongListSkeleton;
