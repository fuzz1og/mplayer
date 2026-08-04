import React, { useState, useEffect } from 'react';
import { Music2, ListMusic } from 'lucide-react';

type CoverVariant = 'song' | 'playlist';

interface CoverImageProps {
  src?: string;
  alt?: string;
  style?: React.CSSProperties;
  variant?: CoverVariant;
  /** 图片加载失败时回调（fallback 仍显示）；持有 song 的层借此按 ID 重识别换新封面 */
  onError?: () => void;
}

const SongFallback: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <div
    style={{
      ...style,
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(145deg, #3D7BD9 0%, #1F4399 100%)',
      overflow: 'hidden',
    }}
  >
    <div style={{ position: 'absolute', width: '72%', height: '72%', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.14)' }} />
    <div style={{ position: 'absolute', width: '54%', height: '54%', borderRadius: '50%', background: 'rgba(255,255,255,0.08)' }} />
    <Music2 size={34} color="rgba(255,255,255,0.95)" />
  </div>
);

const PlaylistFallback: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <div
    style={{
      ...style,
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#0D1117',
      overflow: 'hidden',
    }}
  >
    <div
      style={{
        width: '74%',
        height: '74%',
        borderRadius: '50%',
        background: 'radial-gradient(circle at 34% 28%, #2A3342 0%, #0D1117 72%)',
        boxShadow: '0 8px 20px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.08)',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ position: 'absolute', inset: '12%', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.10)' }} />
      <div style={{ position: 'absolute', inset: '22%', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.08)' }} />
      <div
        style={{
          width: '34%',
          height: '34%',
          borderRadius: '50%',
          background: 'linear-gradient(145deg, #2F5FD0 0%, #1F4399 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ListMusic size={16} color="rgba(255,255,255,0.95)" />
      </div>
    </div>
  </div>
);

const CoverImage: React.FC<CoverImageProps> = ({ src, alt = '', style, variant = 'song', onError }) => {
  const [failed, setFailed] = useState(false);

  // src 变化（封面刷新换新 URL）时重置失败状态，否则新封面永远不会显示
  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    return variant === 'playlist'
      ? <PlaylistFallback style={style} />
      : <SongFallback style={style} />;
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => {
        setFailed(true);
        onError?.();
      }}
      style={style}
    />
  );
};

export default React.memo(CoverImage);
