import React from 'react';
import { Radio as RadioIcon } from 'lucide-react';
import { formatPlayCount, type DjRadio } from '@mplayer/core';
import CoverCard from './CoverCard';
import '@/renderer/styles/songlist.css';

interface DjRadioGridProps {
  radios: DjRadio[];
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onSelect?: (radio: DjRadio) => void;
  emptyText?: string;
}

const SKELETON_COUNT = 6;

const DjRadioGrid: React.FC<DjRadioGridProps> = ({
  radios,
  loading = false,
  error = null,
  onRetry,
  onSelect,
  emptyText = '暂无电台',
}) => {
  if (loading) {
    return (
      <div className="card-grid">
        {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
          <div key={i} className="cover-card cover-card--skeleton">
            <div className="cover-card__media" />
            <div className="cover-card__text">
              <div className="cover-card__sk-line" />
              <div className="cover-card__sk-line cover-card__sk-line--meta" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="card-state card-state--error">
        <div>{error}</div>
        {onRetry && <button onClick={onRetry} className="card-state__retry">重试</button>}
      </div>
    );
  }

  if (radios.length === 0) {
    return (
      <div className="card-state">
        <RadioIcon size={26} className="card-state__icon" />
        <div>{emptyText}</div>
      </div>
    );
  }

  return (
    <div className="card-grid">
      {radios.map((radio) => (
        <CoverCard
          key={radio.id}
          title={radio.name}
          subtitle={radio.dj.nickname || undefined}
          cover={radio.picUrl}
          badge={radio.subCount ? formatPlayCount(radio.subCount) : undefined}
          onClick={() => onSelect?.(radio)}
        />
      ))}
    </div>
  );
};

export default DjRadioGrid;
