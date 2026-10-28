import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { SourceKey } from '@mplayer/core';
import type { SwapCandidate } from '@/renderer/services/sourceSwap';
import { SOURCE_COLORS } from '@/renderer/constants/sourceConfig';
import { Dialog, Row } from '@/renderer/ui';

export const SWAP_SOURCES: { key: SourceKey; label: string; color: string }[] = [
  { key: 'netease', label: '网易云', color: SOURCE_COLORS.netease },
  { key: 'qq', label: 'QQ音乐', color: SOURCE_COLORS.qq },
  { key: 'kugou', label: '酷狗', color: SOURCE_COLORS.kugou },
  { key: 'kuwo', label: '酷我', color: SOURCE_COLORS.kuwo },
  { key: 'qianqian', label: '千千', color: SOURCE_COLORS.qianqian },
];

interface SourceSwapModalProps {
  open: boolean;
  songName?: string;
  /** 当前歌曲来源：列表中禁用该源（避免选回当前源白搜） */
  currentSource?: SourceKey;
  /** 候选列表非空时展示候选选择（两阶段：选源 → 选候选） */
  candidates: SwapCandidate[];
  loading?: boolean;
  success?: boolean;
  onSelectSource: (source: SourceKey) => void;
  onSelectCandidate: (candidate: SwapCandidate) => void;
  onBack: () => void;
  onClose: () => void;
}

/**
 * #391：探测删除后不再有「可播 / 短时长 / 失效 / 检测中」徽标——那些标记来自已被证伪的直连探测判据。
 * 1.9.0 改自建 Dialog：焦点陷阱与 ESC 由原生 dialog 负责，候选行复用 Row。
 */
const SourceSwapModal: React.FC<SourceSwapModalProps> = ({
  open, songName, currentSource, candidates, loading, success,
  onSelectSource, onSelectCandidate, onBack, onClose,
}) => {
  const title = success
    ? '换源完整版'
    : candidates.length > 0
      ? '选择要切换的版本'
      : '换源完整版';

  return (
    <Dialog open={open} title={title} onClose={onClose} size="sm">
      {songName ? <div className="swap__song">{songName}</div> : null}

      {success ? (
        <div className="swap__success">
          <CheckCircle2 size={44} color="var(--success)" aria-hidden="true" />
          <div className="swap__success-text">已替换为完整版</div>
        </div>
      ) : loading ? (
        <div className="swap__loading">正在搜索可切换版本…</div>
      ) : candidates.length > 0 ? (
        <div className="swap__list">
          {candidates.map((c, i) => (
            <Row
              key={`${c.song.id}-${i}`}
              ariaLabel={c.song.name}
              label={
                <span className="swap__candidate">
                  <span className={`swap__dot${c.exact ? ' swap__dot--exact' : ''}`} aria-hidden="true" />
                  <span className="swap__candidate-text">
                    <span className="swap__candidate-name">{c.song.name}</span>
                    <span className="swap__candidate-artist">{c.song.artist}</span>
                  </span>
                </span>
              }
              trailing={
                <span className={c.exact ? 'swap__score swap__score--exact' : 'swap__score'}>
                  {c.exact ? '完整版' : `${Math.round(c.score * 100)}%`}
                </span>
              }
              chevron
              onClick={() => onSelectCandidate(c)}
            />
          ))}
          <Row label="返回选择其他音乐源" onClick={onBack} />
        </div>
      ) : (
        <div className="swap__list">
          {SWAP_SOURCES.map((s) => {
            const disabled = s.key === currentSource;
            return (
              <Row
                key={s.key}
                ariaLabel={s.label}
                disabled={disabled}
                label={
                  <span className="swap__candidate">
                    <span className="swap__dot" data-source={s.key} aria-hidden="true" />
                    <span>{s.label}{disabled ? '（当前源）' : ''}</span>
                  </span>
                }
                chevron
                onClick={() => onSelectSource(s.key)}
              />
            );
          })}
        </div>
      )}
    </Dialog>
  );
};

export default SourceSwapModal;
