import { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SourceKey } from '@mplayer/core';

const SWAP_SOURCES: { key: SourceKey; label: string; color: string }[] = [
  { key: 'qq', label: 'QQ音乐', color: '#3498db' },
  { key: 'kugou', label: '酷狗', color: '#9b59b6' },
  { key: 'kuwo', label: '酷我', color: '#1abc9c' },
  { key: 'qianqian', label: '千千', color: '#95a5a6' },
];

interface Props {
  visible: boolean;
  loading?: boolean;
  swappedCount?: number;
  totalCount?: number;
  onSelect: (source: SourceKey) => void;
  onClose: () => void;
}

/**
 * 换源选择弹层：网易云 VIP 歌只有 30 秒片段时，
 * 选其他源整专辑换源拿完整版。
 */
export default function SourceSwapModal({ visible, loading, swappedCount, totalCount, onSelect, onClose }: Props) {
  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>换源播放完整版</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color="#888" />
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>当前为网易云 30 秒片段，选择其他音乐源搜索完整版</Text>
          {loading ? (
            <View style={styles.loadingBox}>
              <Text style={styles.loadingText}>正在搜索完整版…{swappedCount !== undefined && totalCount ? `（${swappedCount}/${totalCount}）` : ''}</Text>
            </View>
          ) : (
            SWAP_SOURCES.map((s) => (
              <TouchableOpacity
                key={s.key}
                style={styles.item}
                activeOpacity={0.7}
                onPress={() => onSelect(s.key)}
              >
                <View style={[styles.dot, { backgroundColor: s.color }]} />
                <Text style={styles.itemText}>{s.label}</Text>
                <Ionicons name="chevron-forward" size={18} color="#555" />
              </TouchableOpacity>
            ))
          )}
          {!loading && swappedCount !== undefined && totalCount !== undefined && (
            <Text style={styles.resultText}>换源完成：{swappedCount}/{totalCount} 首找到完整版</Text>
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
  itemText: { color: '#fff', fontSize: 15, flex: 1 },
  loadingBox: { paddingVertical: 24, alignItems: 'center' },
  loadingText: { color: '#e74c3c', fontSize: 14 },
  resultText: { color: '#27ae60', fontSize: 13, marginTop: 4, textAlign: 'center' },
});
