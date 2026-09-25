import React, { useEffect, useState } from 'react';
import { Activity, Download, Trash2, RefreshCw } from 'lucide-react';
import { Button, Tag, Typography, message } from 'antd';
import type { PlaybackLayer, PlaybackTrace, PlaybackTraceOutcome } from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';

/**
 * 播放诊断设置区（#363 / ADR `2026-09-23-playback-trace-sink`）。
 * 展示本次会话最近若干条播放解析 trace，支持清空与手动导出 JSON。
 * 数据只在主进程内存环形缓冲里，不落盘、不外传；关闭应用即消失。
 *
 * #391：探测 trace 已随探测链删除，本区只剩解析 trace。
 */

const { Text } = Typography;

/** 列表最多展示的条数（缓冲里可能更多，导出始终是完整快照）。 */
const MAX_RESOLVE_ROWS = 20;

const LAYER_META: Record<PlaybackLayer, { label: string; color: string }> = {
  prefetch: { label: '预取命中', color: 'green' },
  direct: { label: '直连', color: 'blue' },
  tier3: { label: '第三方', color: 'orange' },
  fail: { label: '失败', color: 'red' },
};

const OUTCOME_META: Record<PlaybackTraceOutcome, { label: string; color: string }> = {
  hit: { label: '命中', color: 'green' },
  miss: { label: '未命中', color: 'default' },
  error: { label: '错误', color: 'red' },
  skipped: { label: '跳过', color: 'default' },
  rejected: { label: '护栏拒绝', color: 'orange' },
  discarded: { label: '迟到丢弃', color: 'purple' },
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
      if (filePath) {
        message.success(`诊断已导出：${filePath}`);
      }
    } catch (error) {
      console.error('导出播放诊断失败:', error);
      message.error(error instanceof Error ? error.message : '导出播放诊断失败');
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async (): Promise<void> => {
    setBusy(true);
    try {
      await IpcClient.invoke('playbackTrace:clear');
      setResolves([]);
      message.success('播放诊断已清空');
    } catch (error) {
      console.error('清空播放诊断失败:', error);
      message.error(error instanceof Error ? error.message : '清空播放诊断失败');
    } finally {
      setBusy(false);
    }
  };

  // 缓冲最旧→最新；展示最近 N 条并从新到旧。
  const recentResolves = resolves.slice(-MAX_RESOLVE_ROWS).reverse();
  const isEmpty = resolves.length === 0;

  return (
    <section id="playback-trace" style={{ marginBottom: '32px', scrollMarginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <Activity size={15} color="var(--text-secondary)" />
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>播放诊断</h2>
        <Tag style={{ marginInlineEnd: 0 }}>仅本次会话</Tag>
      </div>
      <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', padding: '20px', border: '1px solid var(--border-default)' }}>
        <Text type="secondary" style={{ display: 'block', fontSize: '13px', lineHeight: 1.6, marginBottom: '16px' }}>
          记录每次播放解析命中的层级（预取 / 直连 / 第三方）、各段耗时、失败原因与每源 outcome。
          数据只保存在当前会话内存中，不落盘、不外传；需要排查时点「导出诊断」保存为 JSON。
        </Text>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <Button
            icon={<Download size={14} />}
            loading={busy}
            onClick={() => void handleExport()}
          >
            导出诊断
          </Button>
          <Button
            icon={<RefreshCw size={14} />}
            loading={loading}
            onClick={() => void load()}
          >
            刷新
          </Button>
          <Button
            danger
            icon={<Trash2 size={14} />}
            loading={busy}
            disabled={isEmpty}
            onClick={() => void handleClear()}
          >
            清空
          </Button>
          <Text type="secondary" style={{ alignSelf: 'center', fontSize: '12px', marginLeft: 'auto' }}>
            解析 {resolves.length} 条
          </Text>
        </div>

        {isEmpty ? (
          <Text type="secondary" style={{ fontSize: '13px' }}>
            本次会话尚未记录播放解析 trace。播放歌曲后再回到这里查看。
          </Text>
        ) : (
          <>
            {recentResolves.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {recentResolves.map((trace, index) => {
                  const layer = LAYER_META[trace.layer];
                  return (
                    <div
                      key={`${trace.ts}-${index}`}
                      style={{
                        border: '1px solid var(--border-default)',
                        borderRadius: '6px',
                        padding: '10px 12px',
                        background: 'var(--bg-surface)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <Tag color={layer.color} style={{ marginInlineEnd: 0 }}>{layer.label}</Tag>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {trace.songName || trace.songId || '未知歌曲'}
                        </span>
                        {trace.artist ? (
                          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{trace.artist}</span>
                        ) : null}
                        {trace.sourceType ? <Tag style={{ marginInlineEnd: 0 }}>{trace.sourceType}</Tag> : null}
                        {trace.nonFull ? <Tag color="gold" style={{ marginInlineEnd: 0 }}>试听版</Tag> : null}
                        {trace.prefetchHit ? <Tag color="green" style={{ marginInlineEnd: 0 }}>预取命中</Tag> : null}
                        {trace.tier3Engaged ? <Tag color="orange" style={{ marginInlineEnd: 0 }}>已进 tier3</Tag> : null}
                        <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                          {formatTime(trace.ts)} · 总 {formatDuration(trace.totalMs)}
                        </span>
                      </div>

                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '6px' }}>
                        直连 {formatDuration(trace.directMs)}
                        {trace.directTimedOut ? '（超时截断）' : ''}
                        {trace.validateMs != null ? ` · 取证 ${formatDuration(trace.validateMs)}` : ''}
                        {' · '}tier3 {trace.tier3Ms == null ? '—' : formatDuration(trace.tier3Ms)}
                        {trace.tier3TimedOut ? '（超时截断）' : ''}
                        {trace.via ? ` · 来源 ${trace.via === 'tier3' ? '第三方' : '直连'}` : ''}
                        {trace.guard ? ` · 护栏 ${trace.guard}` : ''}
                      </div>

                      <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                        原因：{trace.reason || '—'}
                      </div>

                      {trace.sources.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                          {trace.sources.map((leg, legIndex) => {
                            const outcome = OUTCOME_META[leg.outcome];
                            return (
                              <Tag key={`${leg.sourceId}-${legIndex}`} color={outcome.color} style={{ marginInlineEnd: 0 }}>
                                {leg.sourceId} · {outcome.label} · {formatDuration(leg.ms)}
                                {leg.errorClass ? ` · ${leg.errorClass}` : ''}
                                {leg.guard ? ` · ${leg.guard}` : ''}
                              </Tag>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

          </>
        )}
      </div>
    </section>
  );
};

export default PlaybackDiagnosticsSection;
