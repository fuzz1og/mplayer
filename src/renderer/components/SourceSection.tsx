import React, { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { Radio, Tag } from 'antd';
import { MULTI_SOURCE_LIST, SOURCE_DISPLAY_NAMES, SOURCE_MODE_OPTIONS } from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';

/**
 * 直连设置（T01，spec #146）：每源来源开关 auto/direct/api + 直连状态。
 * 模式持久化在 db（settings:setSourceModes），路由在 core（searchSongsRouted /
 * resolvePlayableUrlRouted）；直连客户端由各源 ticket（T02+）注册后状态变「直连可用」。
 * 来源中文名 / 三态选项与移动端共用 core 常量（SOURCE_DISPLAY_NAMES / SOURCE_MODE_OPTIONS）。
 */

interface SourceModesData {
  modes: Record<string, string>;
  status: Record<string, 'ready' | 'unavailable'>;
}

const SourceSection: React.FC = () => {
  const [data, setData] = useState<SourceModesData | null>(null);

  const load = async (): Promise<void> => {
    try {
      const d = await IpcClient.invoke<SourceModesData>('settings:getSourceModes');
      setData(d);
    } catch (error) {
      console.error('加载直连设置失败:', error);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleChange = async (source: string, mode: string): Promise<void> => {
    if (!data) return;
    const next = { ...data.modes, [source]: mode };
    setData({ ...data, modes: next });
    try {
      await IpcClient.invoke('settings:setSourceModes', next);
    } catch (error) {
      console.error('保存直连设置失败:', error);
      void load(); // 回滚到已保存状态
    }
  };

  return (
    <section id="source" style={{ marginBottom: '32px', scrollMarginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <Zap size={15} color="var(--text-secondary)" />
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>直连设置</h2>
      </div>
      <div style={{ backgroundColor: 'var(--content-bg)', borderRadius: '8px', padding: '20px', border: '1px solid var(--border-color)' }}>
        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: 0, lineHeight: 1.6 }}>
          每源可选择请求方式：自动 = 官方直连优先、失败回退第三方解析；仅直连 = 只走官方直连。
          直连能力按源逐步落地（未实现时自动模式等价现状）。
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
                <Radio.Group
                  size="small"
                  options={SOURCE_MODE_OPTIONS}
                  optionType="button"
                  value={data.modes[source] || 'auto'}
                  onChange={(e) => void handleChange(source, e.target.value)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default SourceSection;
