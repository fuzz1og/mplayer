import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SourceKey } from '@mplayer/core';
import type { SwapCandidate } from '../services/sourceSwap';

const SWAP_SOURCES: { key: SourceKey; label: string; color: string }[] = [
  { key: 'qq', label: 'QQ音乐', color: '#3498db' },
  { key: 'kugou', label: '酷狗', color: '#9b59b6' },
  { key: 'kuwo', label: '酷我', color: '#1abc9c' },
  { key: 'qianqian', label: '千千', color: '#95a5a6' },
];

interface Props {
  visible: boolean;
  songName?: string;
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
  visible, songName, candidates, loading, success,
  onSelectSource, onSelectCandidate, onBack, onClose,
}: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>
              {success ? '换源完整版' : candidates.length > 0 ? '选择要切换的版本' : '换源完整版'}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color="#888" />
            </TouchableOpacity>
          </View>
          {songName ? <Text style={styles.hint} numberOfLines={1}>{songName}</Text> : null}
          {success ? (
            <View style={styles.successBox}>
              <Ionicons name="checkmark-circle" size={44} color="#27ae60" />
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
                  <View style={[styles.dot, { backgroundColor: c.exact ? '#27ae60' : '#888' }]} />
                  <View style={styles.itemInfo}>
                    <Text style={styles.itemText} numberOfLines={1}>{c.song.name}</Text>
                    <Text style={styles.itemArtist} numberOfLines={1}>{c.song.artist}</Text>
                  </View>
                  <Text style={[styles.matchTag, c.exact && styles.matchTagExact]}>
                    {c.exact ? '完整版' : `${Math.round(c.score * 100)}%`}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color="#555" />
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.backBtn} activeOpacity={0.7} onPress={onBack}>
                <Ionicons name="arrow-back" size={16} color="#888" />
                <Text style={styles.backText}>返回选择其他音乐源</Text>
              </TouchableOpacity>
            </>
          ) : (
            SWAP_SOURCES.map((s) => (
              <TouchableOpacity
                key={s.key}
                style={styles.item}
                activeOpacity={0.7}
                onPress={() => onSelectSource(s.key)}
              >
                <View style={[styles.dot, { backgroundColor: s.color }]} />
                <Text style={styles.itemText}>{s.label}</Text>
                <Ionicons name="chevron-forward" size={18} color="#555" />
              </TouchableOpacity>
            ))
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#1a1a2e',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
  },
  title: { color: '#fff', fontSize: 17, fontWeight: '700' },
  hint: { color: '#888', fontSize: 12, marginBottom: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a4a',
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  itemInfo: { flex: 1 },
  itemText: { color: '#fff', fontSize: 15 },
  itemArtist: { color: '#888', fontSize: 12, marginTop: 2 },
  matchTag: { color: '#888', fontSize: 12, marginRight: 8 },
  matchTagExact: { color: '#27ae60' },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  backText: { color: '#888', fontSize: 13, marginLeft: 6 },
  loadingBox: { paddingVertical: 24, alignItems: 'center' },
  loadingText: { color: '#e74c3c', fontSize: 14 },
  successBox: { paddingVertical: 24, alignItems: 'center' },
  successText: { color: '#27ae60', fontSize: 14, marginTop: 8 },
});
