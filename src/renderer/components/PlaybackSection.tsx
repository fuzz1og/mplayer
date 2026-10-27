import React, { useState } from 'react';
import { Music2 } from 'lucide-react';
import { SKIP_LIMIT } from '@mplayer/core';
import { getAutoSkipOnError, persistAutoSkipOnError } from '@/renderer/utils/queueUtils';
import { Group, Row, Section, Switch } from '@/renderer/ui';

/**
 * 播放设置（#385）：播放失败后的处置偏好。
 * 默认开（保持现状行为，对齐 lx-music `autoSkipOnError`）；关闭后播放失败即暂停并提示，
 * 把决定权交还用户。语义与文案来自 core `skipGuard`，与移动端设置页同款。
 */
const PlaybackSection: React.FC = () => {
  const [autoSkip, setAutoSkip] = useState(getAutoSkipOnError());

  return (
    <section id="playback">
      <div className="settings-page__title">
        <Music2 size={16} aria-hidden="true" />
        <h1>播放</h1>
      </div>

      <Section
        footer={`开启时播放失败会自动跳到下一首（连续 ${SKIP_LIMIT} 首失败即暂停，不会翻完整张队列）；关闭时失败即暂停并提示，等你手动换源。离线时会直接暂停，不做完整解析链。`}
      >
        <Group>
          <Row
            label="失败即跳"
            detail={autoSkip ? '开启' : '关闭'}
            trailing={
              <Switch
                checked={autoSkip}
                onChange={(value) => {
                  setAutoSkip(value);
                  persistAutoSkipOnError(value);
                }}
                ariaLabel="失败即跳"
              />
            }
          />
        </Group>
      </Section>
    </section>
  );
};

export default PlaybackSection;
