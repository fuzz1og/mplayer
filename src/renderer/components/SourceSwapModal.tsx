import React from 'react';
import { Modal } from 'antd';
import { CheckCircle2, ChevronRight, ArrowLeft } from 'lucide-react';
import type { SourceKey } from '@mplayer/core';
import type { SwapCandidate } from '@/renderer/services/sourceSwap';
import { SOURCE_COLORS } from '@/renderer/constants/sourceConfig';

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
 * 单曲换源弹层：先选音乐源 → 显示该源匹配度高的候选版本（前 3）
 * → 用户自己选要切换到哪一首（精确匹配标「完整版」，其余显示相似度）。
 * 候选的可播性徽标与全局音频标签语言一致（可播 / 短时长 / 失效）。
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
    <Modal open={open} onCancel={onClose} footer={null} title={title} width={420} centered destroyOnClose>
      {songName ? (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: 'var(--space-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {songName}
        </div>
      ) : null}

      {success ? (
        <div style={{ padding: 'var(--space-6) 0', textAlign: 'center' }}>
          <CheckCircle2 size={44} color="var(--emerald-500)" />
          <div style={{ marginTop: 'var(--space-3)', color: 'var(--emerald-500)', fontSize: 'var(--text-base)' }}>已替换为完整版</div>
        </div>
      ) : loading ? (
        <div style={{ padding: 'var(--space-6) 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--text-base)' }}>
          正在搜索可切换版本…
        </div>
      ) : candidates.length > 0 ? (
        <div>
          {candidates.map((c, i) => (
            <button
              key={`${c.song.id}-${i}`}
              aria-label={c.song.name}
              onClick={() => onSelectCandidate(c)}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)', width: '100%',
                padding: 'var(--space-3) 0', border: 'none', borderBottom: '1px solid var(--border-subtle)',
                background: 'transparent', cursor: 'pointer', textAlign: 'left',
              }}
            >
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: c.exact ? 'var(--emerald-500)' : 'var(--text-tertiary)', flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 'var(--text-base)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.song.name}</span>
                <span style={{ display: 'block', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.song.artist}</span>
              </span>
              {c.playable === false ? (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--red-500)', flexShrink: 0 }}>失效</span>
              ) : c.tag === 'preview' ? (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--amber-500)', flexShrink: 0 }}>短时长</span>
              ) : c.playable === true ? (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--emerald-500)', flexShrink: 0 }}>可播</span>
              ) : (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', flexShrink: 0 }}>检测中…</span>
              )}
              <span style={{ fontSize: 'var(--text-xs)', color: c.exact ? 'var(--emerald-500)' : 'var(--text-secondary)', flexShrink: 0 }}>
                {c.exact ? '完整版' : `${Math.round(c.score * 100)}%`}
              </span>
              <ChevronRight size={18} color="var(--text-tertiary)" />
            </button>
          ))}
          <button
            onClick={onBack}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
              width: '100%', padding: 'var(--space-3) 0', marginTop: 'var(--space-2)',
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--text-secondary)', fontSize: 'var(--text-sm)',
            }}
          >
            <ArrowLeft size={16} /> 返回选择其他音乐源
          </button>
        </div>
      ) : (
        <div>
          {SWAP_SOURCES.map((s) => {
            const disabled = s.key === currentSource;
            return (
              <button
                key={s.key}
                aria-label={s.label}
                disabled={disabled}
                onClick={() => onSelectSource(s.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 'var(--space-3)', width: '100%',
                  padding: 'var(--space-3) 0', border: 'none', borderBottom: '1px solid var(--border-subtle)',
                  background: 'transparent', cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.4 : 1, color: 'var(--text-primary)', fontSize: 'var(--text-base)',
                }}
              >
                <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: s.color, flexShrink: 0 }} />
                <span style={{ flex: 1, textAlign: 'left' }}>{s.label}{disabled ? '（当前源）' : ''}</span>
                <ChevronRight size={18} color="var(--text-tertiary)" />
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
};

export default SourceSwapModal;
