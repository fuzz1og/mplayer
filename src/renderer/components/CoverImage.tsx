import React, { useState, useEffect } from 'react';
import { Music2, ListMusic } from 'lucide-react';
import { isSessionProtectedEndpoint } from '@mplayer/core';
import { resolveCoverUrl } from '@/renderer/services/coverUrlResolver';

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
  // 会话保护的封面端点（api.php）→ JS 层解析成 CDN 直链，<img> 才能直接加载
  // 首帧就跳过保护端点：解析完成前渲染必失败（无 cookie），onError 会抢占解析结果
  const [resolvedSrc, setResolvedSrc] = useState(() =>
    src && !isSessionProtectedEndpoint(src) ? src : ''
  );
  const [resolvingProtected, setResolvingProtected] = useState(
    () => !!src && isSessionProtectedEndpoint(src)
  );

  // src 变化（封面刷新换新 URL）时重置失败状态，否则新封面永远不会显示
  useEffect(() => {
    setFailed(false);
    if (!src) {
      setResolvingProtected(false);
      setResolvedSrc('');
      return;
    }
    // 会话保护端点先渲染必失败（无 cookie）：解析完成前不渲染 img，
    // 避免 onError 抢占解析结果（否则 CDN 直链到达时封面已被标记失败）
    if (isSessionProtectedEndpoint(src)) {
      setResolvingProtected(true);
      setResolvedSrc('');
      let cancelled = false;
      resolveCoverUrl(src)
        .then((r) => {
          if (!cancelled) {
            setResolvedSrc(r);
            setResolvingProtected(false);
          }
        })
        .catch(() => {
          // 解析失败回退原 URL，交给 onError 占位图兜底（保留既有兜底行为）
          if (!cancelled) {
            setResolvedSrc(src);
            setResolvingProtected(false);
          }
        });
      return () => {
        cancelled = true;
      };
    }
    setResolvingProtected(false);
    setResolvedSrc(src);
  }, [src]);

  if (!resolvedSrc || resolvingProtected || failed) {
    return variant === 'playlist'
      ? <PlaylistFallback style={style} />
      : <SongFallback style={style} />;
  }

  return (
    <img
      src={resolvedSrc}
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
