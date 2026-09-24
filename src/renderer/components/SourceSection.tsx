import React, { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { Switch, Tag } from 'antd';
import { MULTI_SOURCE_LIST, SOURCE_DISPLAY_NAMES } from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';
import { getAutoSkipOnError, persistAutoSkipOnError } from '@/renderer/utils/queueUtils';

/**
 * 直连状态（T01，spec #146）：设置页只展示每源直连客户端是否已注册/可用，
 * 不再提供 auto/仅直连 选项（自建 API 已退役，路由由 core 内部处理）。
 * 直连客户端由各源 ticket（T02+）注册后状态变「直连可用」。
 */

interface SourceStatusData {
  status: Record<string, 'ready' | 'unavailable'>;
}

const SourceSection: React.FC = () => {
  const [data, setData] = useState<SourceStatusData | null>(null);
  // #385「失败即跳」偏好：默认开（保持现状）；关闭后播放失败即暂停，等用户处理。
  const [autoSkip, setAutoSkip] = useState(getAutoSkipOnError());

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
    <section id="source" style={{ marginBottom: '32px', scrollMarginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <Zap size={15} color="var(--text-secondary)" />
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>直连状态</h2>
      </div>
      <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', padding: '20px', border: '1px solid var(--border-default)' }}>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: 0, lineHeight: 1.6 }}>
          各官方源的直连客户端能力状态。直连可用表示该源已接入官方直连，播放/搜索会优先走直连。
        </p>
        {!data ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>加载中…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {MULTI_SOURCE_LIST.map((source) => (
              <div key={source} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <span style={{ width: '56px', fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>
                  {SOURCE_DISPLAY_NAMES[source] || source}
                </span>
                <Tag color={data.status[source] === 'ready' ? 'green' : 'default'} style={{ marginInlineEnd: 0 }}>
                  {data.status[source] === 'ready' ? '直连可用' : '直连未实现'}
                </Tag>
              </div>
            ))}
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--border-subtle)', marginTop: '20px', paddingTop: '16px' }}>
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
            开启时播放失败会自动跳到下一首（连续 3 首失败即暂停，不会翻完整张队列）；关闭时失败即暂停并提示，
            等你手动换源。离线时会直接暂停，不做完整解析链。双端语义与文案一致（core 单一来源）。
          </p>
        </div>
      </div>
    </section>
  );
};

export default SourceSection;
