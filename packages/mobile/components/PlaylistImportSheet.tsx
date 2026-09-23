import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView } from 'react-native';
import { Check, CircleCheck, Link2, Loader2 } from 'lucide-react-native';
import { importFromLink } from '@mplayer/core';
import type { Song, ProgressState, ImportResult, PlaylistImportDeps } from '@mplayer/core';
import { defaultPlaylistLinkDeps, fetchPlaylistSongsFromLink } from '../services/playlistLinkImport';
import { radius, spacing, textVariants, opacity } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { usePlaylistStore } from '../stores/playlistStore';
import BottomSheet from './BottomSheet';
import ScalePress from './ScalePress';

type Step = 'input' | 'parsing' | 'preview' | 'importing' | 'done';

interface Props {
  visible: boolean;
  playlistId: string;
  playlistName: string;
  /** 目标歌单已有歌曲（预览里标「已在歌单」并跳过） */
  existingSongs: Song[];
  onClose: () => void;
}

/** 与 core importFromLink 的去重键保持一致（歌名|歌手） */
function dedupeKey(song: Song): string {
  return song.name + '|' + (song.artist || '');
}

/**
 * 链接导入歌单（wayfinder #382 定案形态）：复用 BottomSheet 的分步向导。
 * 粘贴链接 → 解析 → 预览（全选/自选）→ 逐首进度 → 结果。
 *
 * 编排在 core（parsePlaylistUrl / importFromLink）；取歌腿走直连客户端：
 * - QQ：getQqPlaylistSongs（短链在 core 内跟 302）
 * - 网易：getDirectClient('netease').getPlaylistSongs（limit<=0 = 全量）
 * - 网易短链：RN 侧 fetch 跟随重定向后再 parsePlaylistUrl
 * 歌曲自带来源 ID，播放地址由播放链路路由解析，导入阶段不搜索。
 */
export default function PlaylistImportSheet({ visible, playlistId, playlistName, existingSongs, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [step, setStep] = useState<Step>('input');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  const existingKeys = useMemo(() => new Set(existingSongs.map(dedupeKey)), [existingSongs]);
  const importable = useMemo(() => songs.filter((s) => !existingKeys.has(dedupeKey(s))), [songs, existingKeys]);
  const skippedCount = songs.length - importable.length;
  const chosen = useMemo(() => importable.filter((s) => selected.has(s.id)), [importable, selected]);
  const allSelected = importable.length > 0 && importable.every((s) => selected.has(s.id));

  // 取歌腿（识别链接 → 歌曲列表）在 service 里，便于单测；这里只注入默认实现
  const linkDeps = useMemo(() => defaultPlaylistLinkDeps(), []);

  // core 只要求「把歌加进目标歌单」；mobile 侧是同步 store 写入，包一层 Promise
  const deps = useMemo<PlaylistImportDeps>(() => ({
    addSong: async (pid, song) => {
      usePlaylistStore.getState().addSong(String(pid), song);
    },
  }), []);

  const reset = useCallback(() => {
    setStep('input');
    setUrl('');
    setError(null);
    setSongs([]);
    setSelected(new Set());
    setProgress(null);
    setResult(null);
  }, []);

  // 每次打开都是一次全新导入（关闭路径多样：完成/遮罩/下拉把手）
  useEffect(() => {
    if (visible) reset();
  }, [visible, reset]);

  // 允许随时关闭：中途关闭后 core 的导入循环继续跑完并写 store，重开即重置
  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleParse = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('请输入歌单链接');
      return;
    }
    setStep('parsing');
    setError(null);
    try {
      const fetched = await fetchPlaylistSongsFromLink(trimmed, linkDeps);
      setSongs(fetched);
      setSelected(new Set(fetched.filter((s) => !existingKeys.has(dedupeKey(s))).map((s) => s.id)));
      setStep('preview');
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : '解析链接失败，请检查网络连接');
      setStep('input');
    }
  }, [url, existingKeys, linkDeps]);

  const handleImport = useCallback(async () => {
    if (chosen.length === 0) return;
    setStep('importing');
    try {
      const imported = await importFromLink(
        playlistId,
        songs,
        new Set(chosen.map((s) => s.id)),
        existingSongs,
        deps,
        setProgress,
      );
      setResult(imported);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : '导入失败');
      setStep('preview');
    }
  }, [chosen, songs, playlistId, existingSongs, deps]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(importable.map((s) => s.id)));
  }, [allSelected, importable]);

  return (
    <BottomSheet visible={visible} onClose={handleClose} maxHeightRatio={0.85}>
      {step === 'input' && (
        <View style={styles.body}>
          <Text style={styles.title}>导入歌单</Text>
          <Text style={styles.sub}>
            {'导入到「' + playlistName + '」\n支持网易云 / QQ 音乐歌单链接\n网易云完整链接或 163cn.tv 短链 · QQ 直链或分享短链'}
          </Text>
          <View style={styles.field}>
            <Link2 size={18} color={colors.textTertiary} />
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              placeholder="粘贴网易云 / QQ 音乐歌单链接"
              placeholderTextColor={colors.inputPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
          <ScalePress style={styles.primaryBtn} onPress={() => { void handleParse(); }}>
            <Text style={styles.primaryText}>解析链接</Text>
          </ScalePress>
        </View>
      )}

      {step === 'parsing' && (
        <View style={styles.center}>
          <Loader2 size={26} color={colors.accent} />
          <Text style={styles.sub}>正在解析歌单…</Text>
        </View>
      )}

      {step === 'preview' && (
        <View style={styles.body}>
          <Text style={styles.title}>选择要导入的歌曲</Text>
          <Text style={styles.sub}>
            {'共 ' + songs.length + ' 首 · ' + skippedCount + ' 首已在歌单'}
          </Text>
          <View style={styles.selectBar}>
            <Text style={styles.selectCount}>{'已选 ' + chosen.length + ' 首'}</Text>
            <ScalePress onPress={toggleAll} hitSlop={{ left: 8, right: 8, top: 8, bottom: 8 }}>
              <Text style={styles.selectAll}>{allSelected ? '取消全选' : '全选'}</Text>
            </ScalePress>
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
          <ScrollView style={styles.list} nestedScrollEnabled>
            {songs.map((song) => {
              const already = existingKeys.has(dedupeKey(song));
              const on = !already && selected.has(song.id);
              return (
                <ScalePress
                  key={song.id}
                  style={styles.row}
                  onPress={already ? () => {} : () => toggle(song.id)}
                >
                  <View style={[styles.checkbox, on && styles.checkboxOn, already && styles.checkboxOff]}>
                    {on && <Check size={13} color={colors.textInverse} strokeWidth={3} />}
                  </View>
                  <View style={styles.meta}>
                    <Text style={[styles.songName, already && { color: colors.textTertiary }]} numberOfLines={1}>
                      {song.name}
                    </Text>
                    <Text style={styles.songArtist} numberOfLines={1}>
                      {song.artist + (already ? ' · 已在歌单' : '')}
                    </Text>
                  </View>
                </ScalePress>
              );
            })}
          </ScrollView>
          <ScalePress
            style={[styles.primaryBtn, chosen.length === 0 && styles.primaryBtnDisabled]}
            onPress={() => { if (chosen.length > 0) void handleImport(); }}
          >
            <Text style={styles.primaryText}>{'导入 ' + chosen.length + ' 首'}</Text>
          </ScalePress>
        </View>
      )}

      {step === 'importing' && (
        <View style={styles.body}>
          <Text style={styles.title}>正在导入…</Text>
          <View style={styles.progressBox}>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  {
                    width: (String(progress && progress.total > 0
                      ? Math.round(((progress.found + progress.skipped + progress.failed) / progress.total) * 100)
                      : 0) + '%') as unknown as number,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressCount}>
              {progress
                ? (progress.found + progress.skipped + progress.failed) + ' / ' + progress.total
                : '0 / 0'}
            </Text>
            <View style={styles.progressLine}>
              <Loader2 size={14} color={colors.accent} />
              <Text style={styles.progressLineText} numberOfLines={1}>
                {progress?.currentLine || '正在加入歌单…'}
              </Text>
            </View>
          </View>
        </View>
      )}

      {step === 'done' && result && (
        <View style={styles.resultBox}>
          <CircleCheck size={44} color={colors.accent} />
          <Text style={styles.resultTitle}>导入完成</Text>
          <Text style={styles.resultSub}>
            {'成功导入 ' + result.successes.length + ' 首' +
              (result.skips.length > 0 ? '，' + result.skips.length + ' 首已在歌单' : '') +
              (result.failures.length > 0 ? '，' + result.failures.length + ' 首失败' : '')}
          </Text>
          <ScalePress style={styles.resultBtn} onPress={handleClose}>
            <Text style={styles.primaryText}>完成</Text>
          </ScalePress>
        </View>
      )}
    </BottomSheet>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  body: { paddingHorizontal: spacing[5], paddingBottom: spacing[5] },
  title: { ...textVariants.title, color: colors.textPrimary, textAlign: 'center' },
  sub: {
    ...textVariants.footnote,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing[2],
    marginBottom: spacing[4],
  },
  error: { ...textVariants.footnote, color: colors.dangerText, marginBottom: spacing[3], textAlign: 'center' },
  center: { alignItems: 'center', paddingVertical: spacing[8], gap: spacing[3] },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.inputBg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    marginBottom: spacing[3],
  },
  input: { ...textVariants.body, color: colors.textPrimary, flex: 1, fontWeight: '400' },

  primaryBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingVertical: spacing[3] + 2,
    alignItems: 'center',
    marginTop: spacing[2],
  },
  primaryBtnDisabled: { opacity: opacity.disabled },
  primaryText: { ...textVariants.body, color: colors.textInverse, fontWeight: '600' },

  selectBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[1] },
  selectCount: { ...textVariants.footnote, color: colors.textSecondary },
  selectAll: { ...textVariants.footnote, color: colors.accent, fontWeight: '600' },
  list: { maxHeight: 260, marginBottom: spacing[2] },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radius.xs,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkboxOff: { opacity: opacity.disabled },
  meta: { flex: 1, marginLeft: spacing[3] },
  songName: { ...textVariants.body, color: colors.textPrimary },
  songArtist: { ...textVariants.caption, color: colors.textSecondary, marginTop: 2 },

  progressBox: { paddingVertical: spacing[4] },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.bgHover, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: colors.accent },
  progressCount: { ...textVariants.footnote, color: colors.textSecondary, marginTop: spacing[3] },
  progressLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[2] },
  progressLineText: { ...textVariants.caption, color: colors.textSecondary, flex: 1 },

  resultBox: { alignItems: 'center', paddingVertical: spacing[6], paddingHorizontal: spacing[5], gap: spacing[2] },
  resultTitle: { ...textVariants.title, color: colors.textPrimary, marginTop: spacing[2] },
  resultSub: { ...textVariants.footnote, color: colors.textSecondary, marginBottom: spacing[4], textAlign: 'center' },
  resultBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing[8],
    paddingVertical: spacing[3],
  },
});
