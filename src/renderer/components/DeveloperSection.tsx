import React, { useEffect, useState } from 'react';
import { FlaskConical, Trash2 } from 'lucide-react';
import {
  RENDERER_LOG_MAX,
  clearRendererLogs,
  listRendererLogs,
  subscribeRendererLogs,
  type RendererLogLevel,
} from '@/renderer/services/rendererLogStore';
import { isDevMode, setDevMode, subscribeDevMode } from '@/renderer/services/devMode';
import { Button, Group, Row, Section, Switch, Tag, InfoHint } from '@/renderer/ui';

/**
 * 开发者模式（#477）。1.9.0 起不再是独立导航项：挂在「关于」页底部。
 * 关闭时只留开关行与一句说明，日志区整段不渲染。
 */

const LEVEL_TONE: Record<RendererLogLevel, 'neutral' | 'accent' | 'warning' | 'danger'> = {
  log: 'neutral',
  info: 'accent',
  warn: 'warning',
  error: 'danger',
};

/** 时间显示到秒（同会话内足够定位「刚才那一下」）。 */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function useDevModeEnabled(): boolean {
  const [enabled, setEnabled] = useState(isDevMode);
  useEffect(() => subscribeDevMode(setEnabled), []);
  return enabled;
}

function useRendererLogs() {
  const [logs, setLogs] = useState(listRendererLogs);
  useEffect(() => subscribeRendererLogs(() => setLogs(listRendererLogs())), []);
  return logs;
}

const DeveloperSection: React.FC = () => {
  const enabled = useDevModeEnabled();
  const logs = useRendererLogs();

  return (
    <section id="developer">
      <Section title={<>{'高级'} <InfoHint label="开发者模式">打开后会记录本会话的渲染层日志并显示播放诊断页，跨重启保持。</InfoHint></>}>
        <Group>
          <Row
            icon={<FlaskConical size={13} />}
            label="开发者模式"
            detail={enabled ? '已开启' : '已关闭'}
            trailing={<Switch checked={enabled} onChange={(value) => setDevMode(value)} ariaLabel="开发者模式" />}
          />
        </Group>

        {enabled ? (
          <Group>
            <Row
              label="渲染层日志"
              detail={`最近 ${logs.length} / ${RENDERER_LOG_MAX} 条`}
              trailing={
                <Button
                  size="sm"
                  variant="danger"
                  icon={<Trash2 size={13} />}
                  disabled={logs.length === 0}
                  onClick={() => clearRendererLogs()}
                >
                  清空
                </Button>
              }
            />
            {logs.length === 0 ? (
              <Row label="暂无日志" detail="应用产生的 console 输出会保留在这里" />
            ) : (
              <div className="settings-page__logs">
                {logs.map((entry, index) => (
                  <div key={`${entry.ts}-${index}`} className="settings-page__log-line">
                    <span className="settings-page__log-time">{formatTime(entry.ts)}</span>
                    <Tag tone={LEVEL_TONE[entry.level]}>{entry.level.toUpperCase()}</Tag>
                    <span className="settings-page__log-text">{entry.message}</span>
                  </div>
                ))}
              </div>
            )}
          </Group>
        ) : null}
      </Section>
    </section>
  );
};

export default DeveloperSection;
