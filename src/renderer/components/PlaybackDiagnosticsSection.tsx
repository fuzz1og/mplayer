import React, { useEffect, useState } from 'react';
import { Activity, Download, Trash2, RefreshCw } from 'lucide-react';
import type { PlaybackLayer, PlaybackTrace, PlaybackTraceOutcome } from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';
import { Button, Group, Row, Section, Tag, useToast, InfoHint } from '@/renderer/ui';

/**
 * 播放诊断（#363 / ADR `2026-09-23-playback-trace-sink`）。
 * 只在开发者模式打开时出现在设置导航里；数据只存主进程内存环形缓冲，不落盘、不外传。
 */

const MAX_RESOLVE_ROWS = 20;

const LAYER_META: Record<PlaybackLayer, { label: string; tone: 'neutral' | 'accent' | 'warning' | 'danger' }> = {
  prefetch: { label: '预取命中', tone: 'accent' },
  direct: { label: '直连', tone: 'accent' },
  tier3: { label: '第三方', tone: 'warning' },
  fail: { label: '失败', tone: 'danger' },
};

const OUTCOME_META: Record<PlaybackTraceOutcome, { label: string; tone: 'neutral' | 'accent' | 'warning' | 'danger' }> = {
  hit: { label: '命中', tone: 'accent' },
  miss: { label: '未命中', tone: 'neutral' },
  error: { label: '错误', tone: 'danger' },
  skipped: { label: '跳过', tone: 'neutral' },
  rejected: { label: '护栏拒绝', tone: 'warning' },
  discarded: { label: '迟到丢弃', tone: 'neutral' },
  abandoned: { label: '放弃观测', tone: 'neutral' },
};

/** 毫秒格式化：小于 1 秒显示 ms，否则保留两位秒。 */
function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** trace 时钟是主进程 performance.now（启动为原点），按启动后秒数展示。 */
function formatTime(ts: number | null | undefined): string {
  if (ts == null) return '—';
  return `启动后 +${(ts / 1000).toFixed(1)}s`;
}

const PlaybackDiagnosticsSection: React.FC = () => {
  const [resolves, setResolves] = useState<PlaybackTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const { show } = useToast();

  const load = async (): Promise<void> => {
    try {
      const data = await IpcClient.invoke<{ resolves: PlaybackTrace[] }>('playbackTrace:list');
      setResolves(data?.resolves ?? []);
    } catch (error) {
      console.error('加载播放诊断失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleExport = async (): Promise<void> => {
    setBusy(true);
    try {
      const filePath = await IpcClient.invoke<string | null>('playbackTrace:export');
      if (filePath) show(`诊断已导出：${filePath}`, { tone: 'success' });
    } catch (error) {
      console.error('导出播放诊断失败:', error);
      show(error instanceof Error ? error.message : '导出播放诊断失败', { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async (): Promise<void> => {
    setBusy(true);
    try {
      await IpcClient.invoke('playbackTrace:clear');
      setResolves([]);
      show('播放诊断已清空', { tone: 'success' });
    } catch (error) {
      console.error('清空播放诊断失败:', error);
      show(error instanceof Error ? error.message : '清空播放诊断失败', { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const recentResolves = resolves.slice(-MAX_RESOLVE_ROWS).reverse();
  const isEmpty = resolves.length === 0;

  return (
    <section id="playback-trace">
      <div className="settings-page__title">
        <Activity size={16} aria-hidden="true" />
        <h1>诊断</h1>
        <Tag>仅本次会话</Tag>
      </div>
      <div className="settings-page__stack">
        <Section title={<>{'操作'} <InfoHint label="诊断记录">记录每次播放解析命中的层级（预取 / 直连 / 第三方）、各段耗时与失败原因；数据只保存在当前会话内存中。</InfoHint></>}>
          <Group>
            <Row
              label="导出诊断"
              detail="保存为 JSON 文件"
              trailing={
                <Button size="sm" icon={<Download size={13} />} disabled={busy} onClick={() => void handleExport()}>
                  导出
                </Button>
              }
            />
            <Row
              label="刷新"
              detail={loading ? '读取中…' : `本次会话已记录 ${resolves.length} 条`}
              trailing={
                <Button size="sm" icon={<RefreshCw size={13} />} disabled={loading} onClick={() => void load()}>
                  刷新
                </Button>
              }
            />
            <Row
              label="清空"
              detail="只清空当前会话缓冲"
              trailing={
                <Button size="sm" variant="danger" icon={<Trash2 size={13} />} disabled={busy || isEmpty} onClick={() => void handleClear()}>
                  清空
                </Button>
              }
            />
          </Group>
        </Section>

        {isEmpty ? (
          <Section title="最近解析">
            <Group>
              <Row label="暂无记录" detail="播放一首歌后再回到这里查看" />
            </Group>
          </Section>
        ) : (
          recentResolves.map((trace, index) => {
            const layer = LAYER_META[trace.layer];
            return (
              <Section key={`${trace.ts}-${index}`} title={trace.songName || trace.songId || '未知歌曲'}>
                <Group>
                  <Row
                    label="层级"
                    detail={`${formatTime(trace.ts)} · 总 ${formatDuration(trace.totalMs)}`}
                    trailing={
                      <>
                        <Tag tone={layer.tone}>{layer.label}</Tag>
                        {trace.nonFull ? <Tag tone="warning">试听版</Tag> : null}
                        {trace.prefetchHit ? <Tag tone="accent">预取命中</Tag> : null}
                        {trace.tier3Engaged ? <Tag tone="warning">已进 tier3</Tag> : null}
                        {trace.sourceType ? <Tag>{trace.sourceType}</Tag> : null}
                      </>
                    }
                  />
                  {trace.artist ? <Row label="歌手" detail={trace.artist} /> : null}
                  <Row
                    label="耗时"
                    detail={`直连 ${formatDuration(trace.directMs)}${trace.directTimedOut ? '（超时截断）' : ''} · tier3 ${trace.tier3Ms == null ? '—' : formatDuration(trace.tier3Ms)}${trace.tier3TimedOut ? '（超时截断）' : ''}`}
                  />
                  {trace.via || trace.guard ? (
                    <Row
                      label="来源与护栏"
                      detail={`${trace.via ? `来源 ${trace.via === 'tier3' ? '第三方' : '直连'}` : ''}${trace.guard ? ` · 护栏 ${trace.guard}` : ''}`}
                    />
                  ) : null}
                  <Row label="原因" detail={trace.reason || '—'} />
                  {trace.sources.length > 0 ? (
                    <Row
                      label="每源结果"
                      trailing={
                        <>
                          {trace.sources.map((leg, legIndex) => {
                            const outcome = OUTCOME_META[leg.outcome];
                            return (
                              <Tag key={`${leg.sourceId}-${legIndex}`} tone={outcome.tone}>
                                {leg.sourceId} · {outcome.label} · {formatDuration(leg.ms)}
                                {leg.errorClass ? ` · ${leg.errorClass}` : ''}
                                {leg.guard ? ` · ${leg.guard}` : ''}
                              </Tag>
                            );
                          })}
                        </>
                      }
                    />
                  ) : null}
                </Group>
              </Section>
            );
          })
        )}
      </div>
    </section>
  );
};

export default PlaybackDiagnosticsSection;
