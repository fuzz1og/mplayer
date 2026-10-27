import React, { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { MULTI_SOURCE_LIST, SOURCE_DISPLAY_NAMES } from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';
import { Group, Row, Section, Tag } from '@/renderer/ui';

/**
 * 直连状态（T01，spec #146）：设置页只展示每源直连客户端是否已注册/可用，
 * 不再提供 auto/仅直连 选项（自建 API 已退役，路由由 core 内部处理）。
 */

interface SourceStatusData {
  status: Record<string, 'ready' | 'unavailable'>;
}

const SourceSection: React.FC = () => {
  const [data, setData] = useState<SourceStatusData | null>(null);

  const load = async (): Promise<void> => {
    try {
      const d = await IpcClient.invoke<SourceStatusData>('settings:getSourceModes');
      setData(d);
    } catch (error) {
      console.error('加载直连状态失败:', error);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <section id="source">
      <div className="settings-page__title">
        <Zap size={16} aria-hidden="true" />
        <h1>直连状态</h1>
      </div>
      <div className="settings-page__lead">
        直连可用表示该源已接入官方直连，播放与搜索会优先走直连；未实现的源会走第三方解析兜底。
      </div>

      <Section title="按源">
        <Group>
          {MULTI_SOURCE_LIST.map((source) => {
            const ready = data?.status[source] === 'ready';
            return (
              <Row
                key={source}
                label={SOURCE_DISPLAY_NAMES[source] || source}
                detail={!data ? '加载中…' : ready ? '直连' : '兜底'}
                trailing={data ? <Tag tone={ready ? 'success' : 'neutral'}>{ready ? '直连可用' : '直连未实现'}</Tag> : null}
              />
            );
          })}
        </Group>
      </Section>
    </section>
  );
};

export default SourceSection;
