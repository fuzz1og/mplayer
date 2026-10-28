import React from 'react';
import '@/renderer/styles/songlist.css';
import {
  COL_CHECKBOX,
  COL_INDEX,
  COL_INDEX_LIBRARY,
  COL_ALBUM,
  COL_ACTIONS,
  COL_ACTIONS_COMPACT,
  COL_DURATION,
  COL_DURATION_LIBRARY,
  colWidth,
} from '@/renderer/components/songTableColumns';
import { songRowCoverSize, songRowHeight, type SongListDensity } from '@/renderer/components/songRowMetrics';

interface SongListSkeletonProps {
  rowCount?: number;
  showCheckbox?: boolean;
  showIndex?: boolean;
  /**
   * 真实列表会不会显示专辑列。骨架屏必须与之一致——以前骨架屏缺专辑列和操作列，
   * 于是「加载态比加载后窄」，这类列错位在数据到达前根本看不见。
   */
  showAlbum?: boolean;
  /** 与 SongList 的 density 一致：library 行高 46 / 封面 30 / 单个紧凑操作 */
  density?: SongListDensity;
  /** 与 SongList 的 showDuration 一致：library 资料库行有时长列 */
  showDuration?: boolean;
  /** 与 SongRow 的 indexWidth 一致（榜单预览 24px）；缺省按密度取 28 / 50 */
  indexWidth?: number;
}

const SkeletonRow: React.FC<{
  showCheckbox: boolean;
  showIndex: boolean;
  showAlbum: boolean;
  density: SongListDensity;
  showDuration: boolean;
  indexWidth?: number;
}> = ({ showCheckbox, showIndex, showAlbum, density, showDuration, indexWidth }) => {
  const library = density === 'library';
  return (
    <div
      className="song-skeleton__row"
      data-variant={library ? 'library' : undefined}
      style={{ '--song-row-height': `${songRowHeight(density)}px`,
        '--song-row-cover': `${songRowCoverSize(density)}px` } as React.CSSProperties}
    >
      {showCheckbox && (
        <div className="song-skeleton__col" style={colWidth(COL_CHECKBOX)}>
          <div className="skeleton-shimmer song-skeleton__box song-skeleton__box--check" />
        </div>
      )}
      {showIndex && (
        <div className="song-skeleton__col" style={colWidth(indexWidth ?? (library ? COL_INDEX_LIBRARY : COL_INDEX))}>
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
      {showDuration && (
        <div className="song-skeleton__col" style={colWidth(library ? COL_DURATION_LIBRARY : COL_DURATION)}>
          <div className="skeleton-shimmer song-skeleton__box song-skeleton__box--duration" />
        </div>
      )}
      <div
        className="song-skeleton__actions"
        style={colWidth(library ? COL_ACTIONS_COMPACT : COL_ACTIONS)}
      >
        {library ? (
          <div className="skeleton-shimmer song-skeleton__box song-skeleton__box--action" />
        ) : (
          <>
            <div className="skeleton-shimmer song-skeleton__box song-skeleton__box--action" />
            <div className="skeleton-shimmer song-skeleton__box song-skeleton__box--action" />
            <div className="skeleton-shimmer song-skeleton__box song-skeleton__box--action" />
          </>
        )}
      </div>
    </div>
  );
};

const SongListSkeleton: React.FC<SongListSkeletonProps> = ({
  rowCount = 10,
  showCheckbox = false,
  showIndex = true,
  showAlbum = false,
  density = 'standard',
  showDuration = false,
  indexWidth,
}) => (
  <div className="song-skeleton" data-density={density}>
    {Array.from({ length: rowCount }).map((_, i) => (
      <SkeletonRow
        key={i}
        showCheckbox={showCheckbox}
        showIndex={showIndex}
        showAlbum={showAlbum}
        density={density}
        showDuration={showDuration}
        indexWidth={indexWidth}
      />
    ))}
  </div>
);

export default SongListSkeleton;
