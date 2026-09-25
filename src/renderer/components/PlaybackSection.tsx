import React, { useState } from 'react';
import { Switch } from 'antd';
import { Music2 } from 'lucide-react';
import { SKIP_LIMIT } from '@mplayer/core';
import { getAutoSkipOnError, persistAutoSkipOnError } from '@/renderer/utils/queueUtils';

/**
 * 播放设置（#385）：播放失败后的处置偏好。
 * 默认开（保持现状行为，对齐 lx-music `autoSkipOnError`）；关闭后播放失败即暂停并提示，
 * 把决定权交还用户。语义与文案来自 core `skipGuard`，与移动端设置页同款。
 */
const PlaybackSection: React.FC = () => {
  const [autoSkip, setAutoSkip] = useState(getAutoSkipOnError());

  return (
    <section id="playback" style={{ marginBottom: '32px', scrollMarginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <Music2 size={15} color="var(--text-secondary)" />
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>播放</h2>
      </div>
      <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', padding: '20px', border: '1px solid var(--border-default)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Switch
            checked={autoSkip}
            onChange={(v) => {
              setAutoSkip(v);
              persistAutoSkipOnError(v);
            }}
          />
          <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>
            失败即跳：{autoSkip ? '开启' : '关闭'}
          </span>
        </div>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: 0, lineHeight: 1.6, marginTop: '12px' }}>
          开启时播放失败会自动跳到下一首（连续 {SKIP_LIMIT} 首失败即暂停，不会翻完整张队列）；
          关闭时失败即暂停并提示，等你手动换源。离线时会直接暂停，不做完整解析链。
          语义与文案两端一致（core 单一来源）。
        </p>
      </div>
    </section>
  );
};

export default PlaybackSection;
