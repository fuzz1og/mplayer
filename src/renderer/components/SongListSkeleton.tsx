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
      <div className="skeleton-shimmer" style={{ width: '120px', height: '12px', borderRadius: '3px', display: 'none' }} />
    </div>
  </div>
);

const SongListSkeleton: React.FC<SongListSkeletonProps> = ({
  rowCount = 10,
  showCheckbox = false,
  showIndex = true,
}) => (
  <>
    <style>{`
      .skeleton-shimmer {
        background: linear-gradient(90deg, var(--hover-bg) 25%, rgba(200,200,200,0.15) 50%, var(--hover-bg) 75%);
        background-size: 200% 100%;
        animation: shimmer 1.5s ease-in-out infinite;
      }
      @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `}</style>
    <div style={{ padding: '8px 0' }}>
      {Array.from({ length: rowCount }).map((_, i) => (
        <SkeletonRow key={i} showCheckbox={showCheckbox} showIndex={showIndex} />
      ))}
    </div>
  </>
);

export default SongListSkeleton;
