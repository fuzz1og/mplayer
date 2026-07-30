import React from 'react';

interface Album {
  id: number | string;
  name: string;
  picUrl: string;
  artist: string;
}

interface AlbumScrollProps {
  albums: Album[];
  loading: boolean;
  error: string | null;
  area: string;
  onAreaChange: (area: string) => void;
  onRetry: () => void;
}

const AREAS = [
  { label: '全部', value: 'ALL' },
  { label: '华语', value: 'ZH' },
  { label: '欧美', value: 'EA' },
  { label: '韩国', value: 'KR' },
  { label: '日本', value: 'JP' },
];

const AlbumScroll: React.FC<AlbumScrollProps> = ({ albums, loading, error, area, onAreaChange, onRetry }) => {
  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
        <div>{error}</div>
        <button onClick={onRetry} style={{ marginTop: '12px', padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', background: 'transparent', cursor: 'pointer', color: 'var(--text-secondary)' }}>
          重试
        </button>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Area filter tabs */}
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-5)', flexShrink: 0 }}>
        {AREAS.map((a) => (
          <button
            key={a.value}
            onClick={() => onAreaChange(a.value)}
            style={{
              padding: '6px 16px',
              border: '1px solid var(--border-color)',
              borderRadius: '20px',
              background: area === a.value ? 'var(--accent-color)' : 'transparent',
              color: area === a.value ? '#fff' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
              fontWeight: area === a.value ? 600 : 400,
              transition: 'all 0.15s',
            }}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* Scrollable album cards */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ display: 'flex', gap: 'var(--space-4)', paddingBottom: '12px' }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ flexShrink: 0, width: '120px' }}>
                <div className="skeleton-shimmer" style={{ width: '120px', height: '120px', borderRadius: '10px', marginBottom: '8px' }} />
                <div className="skeleton-shimmer" style={{ width: '100px', height: '14px', borderRadius: '2px' }} />
              </div>
            ))}
          </div>
        ) : albums.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-tertiary)' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>💿</div>
            <div>暂无新碟数据</div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 'var(--space-5)', flexFlow: 'row wrap' }}>
            {albums.map((album) => (
              <div key={album.id} style={{ flexShrink: 0, width: '120px' }}>
                <div style={{ width: '120px', height: '120px', borderRadius: '10px', overflow: 'hidden', backgroundColor: 'var(--hover-bg)', marginBottom: '8px' }}>
                  {album.picUrl ? (
                    <img src={album.picUrl} alt={album.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} loading="lazy" />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '40px', background: 'linear-gradient(135deg, #f093fb, #f5576c)' }}>🎵</div>
                  )}
                </div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>
                  {album.name}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {album.artist || ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AlbumScroll;
