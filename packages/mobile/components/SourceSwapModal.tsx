import { useMemo } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { X, CircleCheck, ChevronRight, ArrowLeft } from 'lucide-react-native';
import type { SourceKey } from '@mplayer/core';
import type { SwapCandidate } from '../services/sourceSwap';
import {radius, sourceColors, spacing, textVariants} from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

const SWAP_SOURCES: { key: SourceKey; label: string }[] = [
  { key: 'netease', label: '网易云' },
  { key: 'qq', label: 'QQ音乐' },
  { key: 'kugou', label: '酷狗' },
  { key: 'kuwo', label: '酷我' },
  { key: 'qianqian', label: '千千' },
];

interface Props {
  visible: boolean;
  songName?: string;
  /** 当前歌曲来源：列表中禁用该源（避免选回当前源白搜） */
  currentSource?: SourceKey;
  /** 候选列表非空时展示候选选择（两阶段：选源 → 选候选） */
  candidates: SwapCandidate[];
  loading?: boolean;
  success?: boolean;
  onSelectSource: (source: SourceKey) => void;
  onSelectCandidate: (candidate: SwapCandidate) => void;
  onBack: () => void;
  onClose: () => void;
}

/**
 * 单曲换源弹层：先选音乐源 → 显示该源匹配度高的候选版本（前 3）
 * → 用户自己选要切换到哪一首（精确匹配标「完整版」，其余显示相似度）。
 */
export default function SourceSwapModal({
  visible, songName, currentSource, candidates, loading, success,
  onSelectSource, onSelectCandidate, onBack, onClose,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {success ? '换源完整版' : candidates.length > 0 ? '选择要切换的版本' : '换源完整版'}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          {songName ? <Text style={styles.hint} numberOfLines={1}>{songName}</Text> : null}
          {success ? (
            <View style={styles.successBox}>
              <CircleCheck size={44} color={colors.success} />
              <Text style={styles.successText}>已替换为完整版</Text>
            </View>
          ) : loading ? (
            <View style={styles.loadingBox}>
              <Text style={styles.loadingText}>正在搜索可切换版本…</Text>
            </View>
          ) : candidates.length > 0 ? (
            <>
              {candidates.map((c, i) => (
                <TouchableOpacity
                  key={`${c.song.id}-${i}`}
                  style={styles.item}
                  activeOpacity={0.7}
                  onPress={() => onSelectCandidate(c)}
                >
                  <View style={[styles.dot, { backgroundColor: c.exact ? colors.success : colors.textSecondary }]} />
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemText} numberOfLines={1}>{c.song.name}</Text>
                    <Text style={styles.itemArtist} numberOfLines={1}>{c.song.artist}</Text>
                  </View>
                  {c.playable === false ? (
                    <Text style={[styles.playTag, styles.playTagBad]}>失效</Text>
                  ) : c.tag === 'preview' ? (
                    <Text style={[styles.playTag, styles.playTagPreview]}>短时长</Text>
                  ) : c.playable === true ? (
                    <Text style={[styles.playTag, styles.playTagGood]}>可播</Text>
                  ) : (
                    <Text style={styles.playTag}>检测中…</Text>
                  )}
                  <Text style={[styles.matchTag, c.exact && styles.matchTagExact]}>
                    {c.exact ? '完整版' : `${Math.round(c.score * 100)}%`}
                  </Text>
                  <ChevronRight size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.backBtn} activeOpacity={0.7} onPress={onBack}>
                <ArrowLeft size={16} color={colors.textSecondary} />
                <Text style={styles.backText}>返回选择其他音乐源</Text>
              </TouchableOpacity>
            </>
          ) : (
            SWAP_SOURCES.map((s) => {
              const disabled = s.key === currentSource;
              const srcColor = sourceColors[s.key];
              return (
                <TouchableOpacity
                  key={s.key}
                  style={[styles.item, disabled && { backgroundColor: `${srcColor}10` }]}
                  activeOpacity={0.7}
                  disabled={disabled}
                  onPress={() => onSelectSource(s.key)}
                >
                  <View style={[styles.dot, { backgroundColor: srcColor }]} />
                  <Text style={[styles.itemText, disabled && { color: srcColor, fontWeight: '600' }]}>
                    {s.label}{disabled ? '（当前源）' : ''}
                  </Text>
                  <ChevronRight size={18} color={colors.textTertiary} />
                </TouchableOpacity>
              );
            })
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.bgOverlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgSurface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingBottom: spacing[8],
    paddingHorizontal: spacing[5],
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[4],
  },
  title: { ...textVariants.title, color: colors.textPrimary },
  hint: { ...textVariants.caption, color: colors.textSecondary, marginBottom: spacing[2] },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing[3] },
  itemInfo: { flex: 1 },
  itemText: { ...textVariants.body, fontWeight: '400', color: colors.textPrimary },
  itemArtist: { ...textVariants.caption, color: colors.textSecondary, marginTop: 2 },
  matchTag: { ...textVariants.caption, color: colors.textSecondary, marginRight: spacing[2] },
  matchTagExact: { color: colors.success },
  playTag: { ...textVariants.micro, fontWeight: '400', color: colors.textSecondary, marginRight: 6 },
  playTagGood: { color: colors.success },
  playTagPreview: { color: colors.warning },
  playTagBad: { color: colors.danger },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: spacing[2],
  },
  backText: { ...textVariants.footnote, color: colors.textSecondary, marginLeft: 6 },
  loadingBox: { paddingVertical: spacing[6], alignItems: 'center' },
  loadingText: { ...textVariants.subhead, fontWeight: '400', color: colors.accent },
  successBox: { paddingVertical: spacing[6], alignItems: 'center' },
  successText: { ...textVariants.subhead, fontWeight: '400', color: colors.success, marginTop: spacing[2] },
});
