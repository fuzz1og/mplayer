/**
 * PROTOTYPE — throwaway（wayfinder #382「移动端歌单导入」定稿形态）
 *
 * 形态（HTML 稿同款，见 packages/mobile/prototype/playlist-import.html）：
 *   歌单详情头部「更多」按钮（MoreVertical，同全屏播放器）
 *     → BottomSheet 操作面板：重命名 / 导入歌曲 / 删除歌单 / 取消
 *   导入歌曲 → 同一个 BottomSheet 组件里的分步向导：
 *     粘贴链接 → 解析 → 预览（全选 / 自选，已在歌单的置灰跳过）→ 逐首进度 → 结果
 *
 * 运行（真机 / Expo Go）：cd packages/mobile && npm run start → /prototype/playlist-import
 * 深链：?sheet=menu|import|rename|delete · &step=input|parsing|preview|importing|done
 *
 * 这是原型，不是实现：无测试、假数据、纯内存；定案后把结论写进真实 playlist/[id].tsx，本文件丢弃。
 * 注：master 的移动端 web 构建因 downloadService 的 expo-file-system 用法在 web 崩，本路由只能真机看。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Pressable,
  Modal,
  Alert,
  type DimensionValue,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Check,
  CircleCheck,
  Clock,
  Link2,
  Loader2,
  MoreVertical,
  Music2,
  Pencil,
  Play,
  Trash2,
  Upload,
} from 'lucide-react-native';
import type { Song, SourceKey } from '@mplayer/core';
import { radius, spacing, textVariants, opacity } from '../../theme/tokens';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import BottomSheet from '../../components/BottomSheet';
import ScalePress from '../../components/ScalePress';
import { SOURCE_LABELS } from '../../stores/sourceStore';

/* ── 假数据 ─────────────────────────────────────────────── */

const LINK = 'https://music.163.com/#/playlist?id=24381616';

function mk(id: string, name: string, artist: string, sourceType: SourceKey = 'netease'): Song {
  return { id, name, artist, album: '', duration: 240, sourceType, url: '', cover: '', lrc: '' };
}

/** 解析链接拿到的歌单（12 首） */
const PARSED_SONGS: Song[] = [
  mk('n1', '夜曲', '周杰伦'), mk('n2', '稻香', '周杰伦'), mk('n3', '晴天', '周杰伦'),
  mk('n4', '七里香', '周杰伦'), mk('n5', '花海', '周杰伦'), mk('n6', '彩虹', '周杰伦'),
  mk('n7', '青花瓷', '周杰伦'), mk('n8', '搁浅', '周杰伦'), mk('n9', '告白气球', '周杰伦'),
  mk('n10', '简单爱', '周杰伦'), mk('n11', '东风破', '周杰伦'), mk('n12', '以父之名', '周杰伦'),
];

/** 目标歌单里已有的（预览里置灰标注、不计入导入） */
const ALREADY_IN_PLAYLIST = new Set(['n1', 'n5']);

/** 宿主页（歌单详情）已有的 6 首 */
const HOST_SONGS: Song[] = [
  mk('h1', '夜曲', '周杰伦'), mk('h2', '花海', '周杰伦'), mk('h3', '晴天', '周杰伦'),
  mk('h4', '富士山下', '陈奕迅', 'qq'), mk('h5', '海阔天空', 'Beyond', 'kugou'), mk('h6', '起风了', '买辣椒也用券', 'kuwo'),
];

/* ── 导入流程状态机 ─────────────────────────────────────── */

type Step = 'input' | 'parsing' | 'preview' | 'importing' | 'done';

function useImportFlow() {
  const [step, setStep] = useState<Step>('input');
  const [url, setUrl] = useState(LINK);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [doneCount, setDoneCount] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const importable = useMemo(() => PARSED_SONGS.filter((s) => !ALREADY_IN_PLAYLIST.has(s.id)), []);
  const skippedCount = PARSED_SONGS.length - importable.length;
  const chosen = useMemo(() => importable.filter((s) => selected.has(s.id)), [importable, selected]);

  const reset = useCallback(() => {
    clearTimers();
    setStep('input');
    setDoneCount(0);
    setSelected(new Set(importable.map((s) => s.id)));
  }, [clearTimers, importable]);

  const parse = useCallback(() => {
    clearTimers();
    setStep('parsing');
    timers.current.push(setTimeout(() => setStep('preview'), 900));
  }, [clearTimers]);

  const startImport = useCallback(() => {
    if (chosen.length === 0) return;
    clearTimers();
    setStep('importing');
    setDoneCount(0);
    chosen.forEach((_, i) => {
      timers.current.push(
        setTimeout(() => {
          setDoneCount(i + 1);
          if (i === chosen.length - 1) timers.current.push(setTimeout(() => setStep('done'), 300));
        }, 260 * (i + 1)),
      );
    });
  }, [chosen, clearTimers]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => (importable.every((s) => prev.has(s.id)) ? new Set() : new Set(importable.map((s) => s.id))));
  }, [importable]);

  const allSelected = importable.every((s) => selected.has(s.id));

  return { step, url, setUrl, selected, toggle, toggleAll, allSelected, doneCount, skippedCount, importable, parse, startImport, reset, chosen };
}

type Flow = ReturnType<typeof useImportFlow>;

/* ── 小积木 ─────────────────────────────────────────────── */

function SourceBadge({ sourceType }: { sourceType: SourceKey }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.sourceTag}>
      <View style={[styles.sourceDot, { backgroundColor: colors.sourceText[sourceType] }]} />
      <Text style={[styles.sourceTagText, { color: colors.sourceText[sourceType] }]}>{SOURCE_LABELS[sourceType]}</Text>
    </View>
  );
}

function Checkbox({ on, disabled, onPress }: { on: boolean; disabled?: boolean; onPress?: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[styles.checkbox, on && { backgroundColor: colors.accent, borderColor: colors.accent }, disabled && { opacity: opacity.disabled }]}
    >
      {on && <Check size={13} color={colors.textInverse} strokeWidth={3} />}
    </Pressable>
  );
}

function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <ScalePress style={[styles.primaryBtn, disabled && { opacity: opacity.disabled }]} onPress={disabled ? () => {} : onPress}>
      <Text style={styles.primaryBtnText}>{label}</Text>
    </ScalePress>
  );
}

function LinkField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.linkField}>
      <Link2 size={18} color={colors.textTertiary} />
      <TextInput
        style={styles.linkInput}
        value={value}
        onChangeText={onChange}
        placeholder="粘贴网易云 / QQ 音乐歌单链接"
        placeholderTextColor={colors.inputPlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}

function PreviewList({ flow, maxHeight }: { flow: Flow; maxHeight?: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <ScrollView style={maxHeight ? { maxHeight } : undefined} nestedScrollEnabled>
      {PARSED_SONGS.map((song) => {
        const already = ALREADY_IN_PLAYLIST.has(song.id);
        const on = !already && flow.selected.has(song.id);
        return (
          <Pressable key={song.id} style={styles.previewRow} onPress={already ? undefined : () => flow.toggle(song.id)}>
            <Checkbox on={on} disabled={already} onPress={() => flow.toggle(song.id)} />
            <View style={styles.previewMeta}>
              <Text style={[styles.previewName, already && { color: colors.textTertiary }]} numberOfLines={1}>{song.name}</Text>
              <Text style={styles.previewArtist} numberOfLines={1}>{song.artist + (already ? ' · 已在歌单' : '')}</Text>
            </View>
            <SourceBadge sourceType={song.sourceType} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function ImportProgress({ flow }: { flow: Flow }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const total = flow.chosen.length || 1;
  const pct = (String(Math.round((flow.doneCount / total) * 100)) + '%') as DimensionValue;
  const current = flow.chosen[flow.doneCount];
  return (
    <View style={styles.progressBox}>
      <View style={styles.progressTrack}><View style={[styles.progressFill, { width: pct }]} /></View>
      <Text style={styles.progressCount}>{flow.doneCount} / {flow.chosen.length}</Text>
      <View style={styles.progressLine}>
        {current ? <Loader2 size={14} color={colors.accent} /> : <Clock size={14} color={colors.textTertiary} />}
        <Text style={styles.progressLineText} numberOfLines={1}>
          {current ? current.name + ' - ' + current.artist : '收尾…'}
        </Text>
      </View>
    </View>
  );
}

/* ── 弹层内容：更多菜单 ─────────────────────────────────── */

function MoreMenu({ name, onRename, onImport, onDelete, onCancel }: {
  name: string; onRename: () => void; onImport: () => void; onDelete: () => void; onCancel: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const items = [
    { key: 'rename', icon: Pencil, label: '重命名', danger: false, onPress: onRename },
    { key: 'import', icon: Upload, label: '导入歌曲', danger: false, onPress: onImport },
    { key: 'delete', icon: Trash2, label: '删除歌单', danger: true, onPress: onDelete },
  ];
  return (
    <View style={styles.sheetBody}>
      <Text style={styles.menuTitle} numberOfLines={1}>{name}</Text>
      {items.map((it) => (
        <ScalePress key={it.key} style={[styles.actionItem, it.key === 'delete' && { borderBottomWidth: 0 }]} onPress={it.onPress}>
          <it.icon size={22} color={it.danger ? colors.dangerText : colors.textPrimary} />
          <Text style={[styles.actionLabel, it.danger && { color: colors.dangerText }]}>{it.label}</Text>
        </ScalePress>
      ))}
      <ScalePress style={styles.cancelBtn} onPress={onCancel}>
        <Text style={styles.cancelText}>取消</Text>
      </ScalePress>
    </View>
  );
}

/* ── 弹层内容：导入向导 ─────────────────────────────────── */

function ImportWizard({ flow, onClose }: { flow: Flow; onClose: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const skipped = flow.skippedCount;

  if (flow.step === 'input') {
    return (
      <View style={styles.sheetBody}>
        <Text style={styles.sheetTitle}>导入歌单</Text>
        <Text style={styles.sheetSub}>支持网易云 / QQ 音乐歌单链接{'\n'}网易云完整链接或 163cn.tv 短链 · QQ 直链或分享短链</Text>
        <LinkField value={flow.url} onChange={flow.setUrl} />
        <PrimaryButton label="解析链接" onPress={flow.parse} />
      </View>
    );
  }
  if (flow.step === 'parsing') {
    return (
      <View style={styles.centerBox}>
        <Loader2 size={26} color={colors.accent} />
        <Text style={styles.sheetSub}>正在解析歌单…</Text>
      </View>
    );
  }
  if (flow.step === 'preview') {
    return (
      <View style={styles.sheetBody}>
        <Text style={styles.sheetTitle}>选择要导入的歌曲</Text>
        <Text style={styles.sheetSub}>{'共 ' + PARSED_SONGS.length + ' 首 · ' + skipped + ' 首已在歌单'}</Text>
        <View style={styles.selectBar}>
          <Text style={styles.selectCount}>{'已选 ' + flow.chosen.length + ' 首'}</Text>
          <ScalePress onPress={flow.toggleAll} hitSlop={{ left: 8, right: 8, top: 8, bottom: 8 }}>
            <Text style={styles.selectAll}>{flow.allSelected ? '取消全选' : '全选'}</Text>
          </ScalePress>
        </View>
        <PreviewList flow={flow} maxHeight={250} />
        <PrimaryButton label={'导入 ' + flow.chosen.length + ' 首'} onPress={flow.startImport} disabled={flow.chosen.length === 0} />
      </View>
    );
  }
  if (flow.step === 'importing') {
    return (
      <View style={styles.sheetBody}>
        <Text style={styles.sheetTitle}>正在导入…</Text>
        <ImportProgress flow={flow} />
      </View>
    );
  }
  return (
    <View style={styles.resultBox}>
      <CircleCheck size={44} color={colors.accent} />
      <Text style={styles.resultTitle}>导入完成</Text>
      <Text style={styles.resultSub}>
        {'成功导入 ' + flow.chosen.length + ' 首' + (skipped > 0 ? '，' + skipped + ' 首已在歌单' : '')}
      </Text>
      <PrimaryButton label="完成" onPress={onClose} />
    </View>
  );
}

/* ── 宿主页：歌单详情 ───────────────────────────────────── */

function PlaylistHost({ name, onMore }: { name: string; onMore: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.hostRoot}>
      <View style={styles.navBar}>
        <Text style={styles.back}>‹</Text>
        <Text style={styles.navTitle}>歌单</Text>
        <View style={styles.navRight}>
          <ScalePress style={styles.moreBtn} onPress={onMore} hitSlop={{ left: 8, right: 8, top: 8, bottom: 8 }}>
            <MoreVertical size={22} color={colors.textSecondary} />
          </ScalePress>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.hostScroll}>
        <View style={styles.heroRow}>
          <View style={styles.cover}><Music2 size={28} color={colors.textTertiary} /></View>
          <View style={styles.heroMeta}>
            <Text style={styles.heroName}>{name}</Text>
            <Text style={styles.heroSub}>{HOST_SONGS.length} 首</Text>
          </View>
        </View>
        <View style={styles.banner}>
          <Upload size={13} color={colors.textTertiary} />
          <Text style={styles.bannerText}>头部「更多」→ 重命名 / 导入歌曲 / 删除歌单；导入走已有 BottomSheet 向导</Text>
        </View>
        {HOST_SONGS.map((song) => (
          <View key={song.id} style={styles.songRow}>
            <View style={styles.songIndex}><Play size={12} color={colors.textTertiary} /></View>
            <View style={styles.previewMeta}>
              <Text style={styles.previewName} numberOfLines={1}>{song.name}</Text>
              <Text style={styles.previewArtist} numberOfLines={1}>{song.artist}</Text>
            </View>
            <SourceBadge sourceType={song.sourceType} />
          </View>
        ))}
      </ScrollView>
      <View style={styles.playerBar}>
        <View style={styles.playerCover} />
        <View style={styles.previewMeta}>
          <Text style={styles.previewName}>夜曲</Text>
          <Text style={styles.previewArtist}>周杰伦</Text>
        </View>
        <Play size={18} color={colors.textSecondary} />
      </View>
    </View>
  );
}

/* ── 路由 ───────────────────────────────────────────────── */

type SheetKind = null | 'menu' | 'import' | 'rename' | 'delete';

export default function PlaylistImportPrototype() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const params = useLocalSearchParams<{ sheet?: string }>();

  const [name, setName] = useState('我喜欢的音乐');
  const [renameValue, setRenameValue] = useState('我喜欢的音乐');
  const [sheet, setSheet] = useState<SheetKind>(
    params.sheet === 'menu' || params.sheet === 'import' || params.sheet === 'rename' || params.sheet === 'delete'
      ? (params.sheet as SheetKind)
      : null,
  );

  const flow = useImportFlow();

  const openImport = useCallback(() => {
    flow.reset();
    setSheet('import');
  }, [flow]);

  const confirmRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed) setName(trimmed);
    setSheet(null);
  }, [renameValue]);

  const askDelete = useCallback(() => {
    setSheet(null);
    Alert.alert('删除歌单', '确定要删除「' + name + '」吗？歌单内的歌曲不会被删除。', [
      { text: '取消', style: 'cancel' },
      // 定案：删除后回歌单列表（列表页长按删除保留，见 #382）
      { text: '删除', style: 'destructive', onPress: () => router.back() },
    ]);
  }, [name]);

  return (
    <View style={styles.hostRoot}>
      <PlaylistHost name={name} onMore={() => setSheet('menu')} />

      <BottomSheet visible={sheet === 'menu'} onClose={() => setSheet(null)}>
        <MoreMenu
          name={name}
          onRename={() => { setRenameValue(name); setSheet('rename'); }}
          onImport={openImport}
          onDelete={askDelete}
          onCancel={() => setSheet(null)}
        />
      </BottomSheet>

      <BottomSheet visible={sheet === 'import'} onClose={() => setSheet(null)} maxHeightRatio={0.84}>
        <ImportWizard flow={flow} onClose={() => setSheet(null)} />
      </BottomSheet>

      <Modal
        visible={sheet === 'rename'}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={() => setSheet(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setSheet(null)}>
          <Pressable style={styles.modalContent} onPress={() => {}}>
            <Text style={styles.modalTitle}>重命名歌单</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="输入歌单名称"
              placeholderTextColor={colors.inputPlaceholder}
              value={renameValue}
              onChangeText={setRenameValue}
              autoFocus
            />
            <View style={styles.modalActions}>
              <ScalePress style={styles.cancelBtnFlat} onPress={() => setSheet(null)}>
                <Text style={styles.cancelText}>取消</Text>
              </ScalePress>
              <ScalePress style={styles.confirmBtnFlat} onPress={confirmRename}>
                <Text style={styles.primaryBtnText}>确认</Text>
              </ScalePress>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/* ── 样式 ───────────────────────────────────────────────── */

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  hostRoot: { flex: 1, backgroundColor: colors.bgBase },

  navBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[3],
  },
  back: { fontSize: 24, lineHeight: 26, color: colors.textSecondary, width: 22 },
  navTitle: { ...textVariants.body, color: colors.textPrimary },
  navRight: { minWidth: 44, alignItems: 'flex-end' },
  moreBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },

  hostScroll: { paddingHorizontal: spacing[4], paddingBottom: spacing[12] },
  heroRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing[4] },
  cover: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.bgHover, alignItems: 'center', justifyContent: 'center' },
  heroMeta: { marginLeft: spacing[4], flex: 1 },
  heroName: { ...textVariants.largeTitle, color: colors.textPrimary },
  heroSub: { ...textVariants.footnote, color: colors.textSecondary, marginTop: spacing[1] },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    paddingVertical: spacing[2], paddingHorizontal: spacing[3],
    borderRadius: radius.sm, backgroundColor: colors.bgHover, marginBottom: spacing[3],
  },
  bannerText: { ...textVariants.caption, color: colors.textSecondary, flex: 1 },

  songRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  songIndex: { width: 28, alignItems: 'center' },

  sourceTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sourceDot: { width: 6, height: 6, borderRadius: 3 },
  sourceTagText: { ...textVariants.micro },

  previewMeta: { flex: 1, marginLeft: spacing[3] },
  previewName: { ...textVariants.body, color: colors.textPrimary },
  previewArtist: { ...textVariants.caption, color: colors.textSecondary, marginTop: 2 },
  previewRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  checkbox: { width: 20, height: 20, borderRadius: radius.xs, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },

  playerBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    backgroundColor: colors.bgSurface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle,
  },
  playerCover: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.bgHover },

  sheetBody: { paddingHorizontal: spacing[5], paddingBottom: spacing[5] },
  menuTitle: { ...textVariants.body, fontWeight: '600', color: colors.textPrimary, textAlign: 'center', marginBottom: spacing[4] },
  actionItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  actionLabel: { ...textVariants.callout, color: colors.textPrimary, marginLeft: spacing[3] },
  cancelBtn: { marginTop: spacing[3], paddingVertical: 14, borderRadius: radius.md, backgroundColor: colors.bgHover, alignItems: 'center' },
  cancelText: { ...textVariants.callout, color: colors.textSecondary },

  sheetTitle: { ...textVariants.title, color: colors.textPrimary, textAlign: 'center' },
  sheetSub: { ...textVariants.footnote, color: colors.textSecondary, textAlign: 'center', marginTop: spacing[2], marginBottom: spacing[4] },
  centerBox: { alignItems: 'center', paddingVertical: spacing[8], gap: spacing[3] },

  linkField: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    backgroundColor: colors.inputBg, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.inputBorder,
    paddingHorizontal: spacing[3], paddingVertical: spacing[3], marginBottom: spacing[4],
  },
  linkInput: { ...textVariants.body, color: colors.textPrimary, flex: 1, fontWeight: '400' },

  selectBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[1] },
  selectCount: { ...textVariants.footnote, color: colors.textSecondary },
  selectAll: { ...textVariants.footnote, color: colors.accent, fontWeight: '600' },

  primaryBtn: { backgroundColor: colors.accent, borderRadius: radius.sm, paddingVertical: spacing[3] + 2, alignItems: 'center', marginTop: spacing[2] },
  primaryBtnText: { ...textVariants.body, color: colors.textInverse, fontWeight: '600' },

  progressBox: { paddingVertical: spacing[4] },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.bgHover, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: colors.accent },
  progressCount: { ...textVariants.footnote, color: colors.textSecondary, marginTop: spacing[3] },
  progressLine: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[2] },
  progressLineText: { ...textVariants.caption, color: colors.textSecondary, flex: 1 },

  resultBox: { alignItems: 'center', paddingVertical: spacing[6], paddingHorizontal: spacing[5], gap: spacing[2] },
  resultTitle: { ...textVariants.title, color: colors.textPrimary, marginTop: spacing[2] },
  resultSub: { ...textVariants.footnote, color: colors.textSecondary, marginBottom: spacing[4] },

  modalOverlay: { flex: 1, backgroundColor: colors.bgOverlay, justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: colors.bgSurface, borderRadius: radius.lg, padding: spacing[6], width: '80%' },
  modalTitle: { ...textVariants.title, color: colors.textPrimary, marginBottom: spacing[4], textAlign: 'center' },
  modalInput: { backgroundColor: colors.inputBg, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 10, ...textVariants.body, fontWeight: '400', color: colors.textPrimary },
  modalActions: { flexDirection: 'row', marginTop: spacing[5], gap: spacing[3] },
  cancelBtnFlat: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: colors.bgHover, alignItems: 'center' },
  confirmBtnFlat: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: colors.accent, alignItems: 'center' },
});
