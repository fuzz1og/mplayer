import React from 'react';

interface SongListSkeletonProps {
  rowCount?: number;
  showCheckbox?: boolean;
  showIndex?: boolean;
}

const SkeletonRow: React.FC<{ showCheckbox: boolean; showIndex: boolean }> = ({ showCheckbox, showIndex }) => (
  <div style={{
    display: 'flex', alignItems: 'center', padding: '10px 16px', borderRadius: '6px',
  }}>
    {showCheckbox && (
      <div style={{ width: '40px', textAlign: 'center' }}>
        <div className="skeleton-shimmer" style={{ width: '16px', height: '16px', borderRadius: '3px', display: 'inline-block' }} />
      </div>
    )}
    {showIndex && (
      <div style={{ width: '50px', textAlign: 'center' }}>
        <div className="skeleton-shimmer" style={{ width: '18px', height: '12px', borderRadius: '3px', display: 'inline-block' }} />
      </div>
    )}
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
      <div className="skeleton-shimmer" style={{ width: '40px', height: '40px', borderRadius: '4px', flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div className="skeleton-shimmer" style={{ width: '45%', height: '14px', borderRadius: '3px' }} />
        <div className="skeleton-shimmer" style={{ width: '30%', height: '12px', borderRadius: '3px' }} />
      </div>
    </div>
  </div>
);

const SongListSkeleton: React.FC<SongListSkeletonProps> = ({
  rowCount = 10,
  showCheckbox = false,
  showIndex = true,
}) => (
  <div style={{ padding: '8px 0' }}>
    {Array.from({ length: rowCount }).map((_, i) => (
      <SkeletonRow key={i} showCheckbox={showCheckbox} showIndex={showIndex} />
    ))}
  </div>
);

export default SongListSkeleton;
