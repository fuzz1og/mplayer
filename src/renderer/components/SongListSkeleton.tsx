import React from 'react';
import { COL_CHECKBOX, COL_INDEX, COL_ALBUM, COL_ACTIONS, colStyle } from '@/renderer/components/songTableColumns';

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
  <div style={{
    display: 'flex', alignItems: 'center', padding: '10px 16px', borderRadius: '8px',
  }}>
    {showCheckbox && (
      <div style={{ ...colStyle(COL_CHECKBOX), textAlign: 'center' }}>
        <div className="skeleton-shimmer" style={{ width: '16px', height: '16px', borderRadius: '3px', display: 'inline-block' }} />
      </div>
    )}
    {showIndex && (
      <div style={{ ...colStyle(COL_INDEX), textAlign: 'center' }}>
        <div className="skeleton-shimmer" style={{ width: '18px', height: '12px', borderRadius: '3px', display: 'inline-block' }} />
      </div>
    )}
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
      <div className="skeleton-shimmer" style={{ width: '44px', height: '44px', borderRadius: '8px', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div className="skeleton-shimmer" style={{ width: '45%', height: '14px', borderRadius: '3px' }} />
        <div className="skeleton-shimmer" style={{ width: '30%', height: '12px', borderRadius: '3px' }} />
      </div>
    </div>
    {showAlbum && (
      <div style={colStyle(COL_ALBUM)}>
        <div className="skeleton-shimmer" style={{ width: '70%', height: '12px', borderRadius: '3px' }} />
      </div>
    )}
    <div style={{ ...colStyle(COL_ACTIONS), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
      <div className="skeleton-shimmer" style={{ width: '28px', height: '28px', borderRadius: '50%' }} />
      <div className="skeleton-shimmer" style={{ width: '28px', height: '28px', borderRadius: '50%' }} />
      <div className="skeleton-shimmer" style={{ width: '28px', height: '28px', borderRadius: '50%' }} />
    </div>
  </div>
);

const SongListSkeleton: React.FC<SongListSkeletonProps> = ({
  rowCount = 10,
  showCheckbox = false,
  showIndex = true,
  showAlbum = false,
}) => (
  <div style={{ padding: '8px 0' }}>
    {Array.from({ length: rowCount }).map((_, i) => (
      <SkeletonRow key={i} showCheckbox={showCheckbox} showIndex={showIndex} showAlbum={showAlbum} />
    ))}
  </div>
);

export default SongListSkeleton;
