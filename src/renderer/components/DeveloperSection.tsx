import React, { useEffect, useState } from 'react';
import { FlaskConical, Trash2 } from 'lucide-react';
import { Button, Switch, Tag, Typography } from 'antd';
import {
  RENDERER_LOG_MAX,
  clearRendererLogs,
  listRendererLogs,
  subscribeRendererLogs,
  type RendererLogLevel,
} from '@/renderer/services/rendererLogStore';
import { isDevMode, setDevMode, subscribeDevMode } from '@/renderer/services/devMode';

/**
 * 开发者模式设置区（#477 B 方案第一片）。
 *
 * 一个**显式开关**（不是连点手势）+ 开启后的渲染层日志查看器（全局 console 捕获，
 * 环形缓冲约 30 行，零调用点改动）。播放解析 trace 仍在 `PlaybackDiagnosticsSection`，
 * 由设置页与本区同受开关控制。
 *
 * 「默认不暴露」由设置页实现：关闭时本区只留开关行，诊断区整段不渲染。
 */

const { Text } = Typography;

const LEVEL_COLORS: Record<RendererLogLevel, string> = {
  log: 'default',
  info: 'blue',
  warn: 'orange',
  error: 'red',
};

/** 时间显示到秒（同会话内足够定位「刚才那一下」）。 */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 订阅模块级开关：外部可变状态用「初值 + useEffect 订阅」读取（不引额外依赖）。 */
function useDevModeEnabled(): boolean {
  const [enabled, setEnabled] = useState(isDevMode);
  useEffect(() => subscribeDevMode(setEnabled), []);
  return enabled;
}

/** 订阅渲染层日志缓冲（列表为空时也要能在开开关后立刻反映）。 */
function useRendererLogs() {
  const [logs, setLogs] = useState(listRendererLogs);
  useEffect(() => subscribeRendererLogs(() => setLogs(listRendererLogs())), []);
  return logs;
}

const DeveloperSection: React.FC = () => {
  const enabled = useDevModeEnabled();
  const logs = useRendererLogs();

  return (
    <section id="developer" style={{ marginBottom: '32px', scrollMarginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <FlaskConical size={15} color="var(--text-secondary)" />
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>开发者模式</h2>
        <Tag style={{ marginInlineEnd: 0 }}>{enabled ? '已开启' : '已关闭'}</Tag>
      </div>

      <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', padding: '20px', border: '1px solid var(--border-default)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Switch checked={enabled} onChange={(next) => setDevMode(next)} />
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>开发者模式</div>
            <Text type="secondary" style={{ fontSize: '12px' }}>
              打开后显示应用内日志与播放诊断（跨重启保持）。关闭时不记录详细日志，警告与错误仍照常保留。
            </Text>
          </div>
        </div>

        {enabled ? (
          <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-default)', paddingTop: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <Text strong style={{ fontSize: '13px' }}>渲染层日志</Text>
              <Text type="secondary" style={{ fontSize: '12px' }}>
                最近 {logs.length} / {RENDERER_LOG_MAX} 条（console 全局捕获）
              </Text>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                <Button size="small" danger icon={<Trash2 size={13} />} disabled={logs.length === 0} onClick={() => clearRendererLogs()}>
                  清空日志
                </Button>
              </div>
            </div>

            {logs.length === 0 ? (
              <Text type="secondary" style={{ fontSize: '13px' }}>
                暂无日志记录。应用产生的 console 输出会在这里保留最近 {RENDERER_LOG_MAX} 条。
              </Text>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  maxHeight: '320px',
                  overflowY: 'auto',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: '12px',
                }}
              >
                {logs.map((entry, index) => (
                  <div key={`${entry.ts}-${index}`} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <span style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>{formatTime(entry.ts)}</span>
                    <Tag color={LEVEL_COLORS[entry.level]} style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                      {entry.level.toUpperCase()}
                    </Tag>
                    <span style={{ color: 'var(--text-secondary)', wordBreak: 'break-all' }}>{entry.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
};

export default DeveloperSection;
