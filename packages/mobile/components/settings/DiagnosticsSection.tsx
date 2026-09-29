import { useState, useEffect } from 'react';
import { View, Text, Alert } from 'react-native';
import { RefreshCw, Share2, Trash2 } from 'lucide-react-native';
import type { PlaybackTrace, PlaybackTraceSourceLeg } from '@mplayer/core';
import { listPlaybackTraces, clearPlaybackTraces, exportPlaybackTraces } from '../../services/playbackTrace';
import { textVariants } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import ScalePress from '../ScalePress';
import { useSettingsStyles } from './settingsStyles';

/** 播放诊断展示条数（最近记录，倒序） */
const TRACE_DISPLAY_COUNT = 20;

const LAYER_LABELS: Record<PlaybackTrace['layer'], string> = {
  prefetch: '预取',
  direct: '直连',
  tier3: 'tier3',
  fail: '失败',
};

const OUTCOME_LABELS: Record<PlaybackTraceSourceLeg['outcome'], string> = {
  hit: '命中',
  miss: '未命中',
  error: '错误',
  skipped: '跳过',
  rejected: '护栏拒绝',
  discarded: '丢弃',
  abandoned: '放弃观测',
};

const GUARD_LABELS: Record<NonNullable<PlaybackTrace['guard']>, string> = {
  'source-duration': '源自带时长',
  'audio-header': '音频头',
  'size-bitrate': '体积码率',
  'text-only': '文本',
  none: '无',
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatTraceMs(ms: number | null): string {
  return ms == null ? '—' : Math.round(ms) + 'ms';
}

/** core traceNow 优先 performance.now（自启动单调 ms），退化 Date.now（epoch ms）。 */
function formatTraceTime(ts: number): string {
  if (ts > 1_000_000_000_000) {
    const d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }
  const sec = Math.max(0, Math.floor(ts / 1000));
  return '+' + Math.floor(sec / 60) + ':' + pad2(sec % 60);
}

/**
 * 播放诊断区段（#363 / ADR-2026-09-23-playback-trace-sink）：会话内最近 20 条解析链 trace。
 * 自治组件：自持 traces 快照与导出/清空副作用，页面不再持有诊断状态（#425）。
 */
export default function DiagnosticsSection() {
  const { colors } = useTheme();
  const styles = useSettingsStyles();

  const [traces, setTraces] = useState<PlaybackTrace[]>([]);
  const hasTraces = traces.length > 0;
  const refreshTraces = (): void => {
    setTraces(listPlaybackTraces().slice(-TRACE_DISPLAY_COUNT).reverse());
  };
  useEffect(() => {
    refreshTraces();
  }, []);

  const handleExportTraces = async (): Promise<void> => {
    try {
      const path = await exportPlaybackTraces();
      Alert.alert('已导出诊断', '文件已保存：' + path);
    } catch (e: any) {
      Alert.alert('导出失败', e?.message || '未知错误');
    }
  };

  const handleClearTraces = (): void => {
    clearPlaybackTraces();
    setTraces([]);
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>播放诊断</Text>
      <View style={styles.group}>
        <View style={styles.groupPad}>
          <View style={styles.diagHead}>
            <Text style={{ ...textVariants.settingsTertiary, color: colors.textSecondary }}>
              最近 {traces.length} 条解析（本次会话）
            </Text>
            <ScalePress onPress={refreshTraces} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 4 }}>
              <RefreshCw size={14} color={colors.textSecondary} />
            </ScalePress>
          </View>
          {!hasTraces ? (
            <Text style={styles.diagEmpty}>暂无播放诊断记录。播放一首歌后回到这里查看解析链。</Text>
          ) : (
            traces.map((t, i) => (
              <View key={t.ts + '-' + t.songId + '-' + i} style={[styles.diagItem, i > 0 && styles.diagItemSep]}>
                <View style={styles.diagRow}>
                  <Text style={styles.diagSong} numberOfLines={1}>
                    {t.songName}
                    {t.artist ? ' · ' + t.artist : ''}
                  </Text>
                  <Text style={[styles.diagLayer, t.layer === 'fail' && styles.diagLayerFail]}>
                    {LAYER_LABELS[t.layer]}
                  </Text>
                </View>
                <Text style={styles.diagMeta} numberOfLines={1}>
                  {formatTraceTime(t.ts)}
                  {' · '}总 {Math.round(t.totalMs)}ms
                  {' · '}直连 {formatTraceMs(t.directMs)}
                  {t.tier3Engaged ? ' · tier3 ' + formatTraceMs(t.tier3Ms) + (t.tier3TimedOut ? '（超时）' : '') : ''}
                  {t.guard ? ' · 护栏 ' + GUARD_LABELS[t.guard] : ''}
                  {t.nonFull ? ' · 试听版' : ''}
                  {t.prefetchHit ? ' · 预取命中' : ''}
                </Text>
                {t.reason ? (
                  <Text style={styles.diagReason} numberOfLines={2}>{t.reason}</Text>
                ) : null}
                {t.sources.length > 0 ? (
                  <Text style={styles.diagSources} numberOfLines={2}>
                    {t.sources
                      .map((s) => s.sourceId + ' ' + OUTCOME_LABELS[s.outcome] + (s.ms > 0 ? ' ' + Math.round(s.ms) + 'ms' : ''))
                      .join(' · ')}
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </View>
        <ScalePress
          style={[styles.actionRow, styles.rowSep, !hasTraces && styles.actionRowDisabled]}
          onPress={handleExportTraces}
          disabled={!hasTraces}
        >
          <Share2 size={18} color={colors.accent} style={styles.btnIcon} />
          <Text style={styles.actionRowText}>导出诊断</Text>
        </ScalePress>
        <ScalePress
          style={[styles.actionRow, styles.rowSep, !hasTraces && styles.actionRowDisabled]}
          onPress={handleClearTraces}
          disabled={!hasTraces}
        >
          <Trash2 size={18} color={colors.danger} style={styles.btnIcon} />
          <Text style={[styles.actionRowText, { color: colors.danger }]}>清空</Text>
        </ScalePress>
      </View>
      <Text style={styles.sectionFootnote}>
        仅保留本次会话最近 {TRACE_DISPLAY_COUNT} 条解析链展示，不落盘、不外传；「导出诊断」把完整缓冲（最多 200 条）写入应用文档目录并唤起系统分享。时间显示为 core 单调时钟（自应用启动计）。
      </Text>
    </View>
  );
}
