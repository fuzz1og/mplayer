import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSourceStore, SOURCE_OPTION_LABELS } from '../stores/sourceStore';
import type { SourceOption } from '../stores/sourceStore';
import { useSearchStore } from '../stores/searchStore';

const SOURCE_OPTIONS: { key: SourceOption; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'all', icon: 'apps-outline' },
  { key: 'netease', icon: 'musical-note-outline' },
  { key: 'qq', icon: 'musical-note-outline' },
  { key: 'kugou', icon: 'musical-note-outline' },
  { key: 'kuwo', icon: 'musical-note-outline' },
  { key: 'qianqian', icon: 'musical-note-outline' },
  { key: 'soda', icon: 'musical-note-outline' },
];

export default function TopBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const isSearchTab = pathname === '/search';
  const [searchText, setSearchText] = useState('');
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const selectedSource = useSourceStore((s) => s.selectedSource);
  const setSelectedSource = useSourceStore((s) => s.setSelectedSource);

  // 从其他页面跳转（如「搜索歌手」）带来的搜索词 → 同步到搜索框。
  // 用 searchStore.query（URL q 参数触发搜索后写入）而非 URL 参数，
  // 避免 TopBar 挂在 Tabs 外读不到深层路由参数。
  const storeQuery = useSearchStore((s) => s.query);
  useEffect(() => {
    if (storeQuery && storeQuery !== searchText) setSearchText(storeQuery);
  }, [storeQuery]);

  const handleSubmit = () => {
    const trimmed = searchText.trim();
    if (!trimmed) return;
    router.replace(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  const handleSelectSource = (source: SourceOption) => {
    setSelectedSource(source);
    setShowSourcePicker(false);
  };

  return (
    <View style={styles.container}>
      {isSearchTab && (
        <TouchableOpacity onPress={() => router.replace('/')} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#ccc" />
        </TouchableOpacity>
      )}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#888" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.input}
          placeholder="搜索歌曲..."
          placeholderTextColor="#666"
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={handleSubmit}
          returnKeyType="search"
          onFocus={() => {
            if (!isSearchTab) {
              router.push('/search');
            }
          }}
        />
        <TouchableOpacity onPress={() => setShowSourcePicker(true)} style={styles.sourceBtn}>
          <Text style={styles.sourceLabel}>{SOURCE_OPTION_LABELS[selectedSource]}</Text>
          <Ionicons name="chevron-down" size={12} color="#888" />
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={() => router.push('/settings')} style={styles.settingsBtn}>
        <Ionicons name="settings-outline" size={22} color="#ccc" />
      </TouchableOpacity>

      <Modal visible={showSourcePicker} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setShowSourcePicker(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowSourcePicker(false)}>
          <TouchableOpacity style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]} activeOpacity={1} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>选择音乐源</Text>
            {SOURCE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.optionItem, selectedSource === opt.key && styles.optionItemActive]}
                onPress={() => handleSelectSource(opt.key)}
              >
                <Ionicons
                  name={opt.icon}
                  size={20}
                  color={selectedSource === opt.key ? '#e74c3c' : '#fff'}
                />
                <Text style={[styles.optionLabel, selectedSource === opt.key && styles.optionLabelActive]}>
                  {SOURCE_OPTION_LABELS[opt.key]}
                </Text>
                {selectedSource === opt.key && (
                  <Ionicons name="checkmark" size={20} color="#e74c3c" />
                )}
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowSourcePicker(false)}>
              <Text style={styles.cancelText}>取消</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    paddingTop: 52,
    backgroundColor: '#1a1a2e',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a4a',
    borderRadius: 20,
    paddingHorizontal: 12,
    height: 36,
  },
  input: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    color: '#fff',
    fontSize: 14,
  },
  sourceBtn: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#3a3a5e',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginLeft: 6,
    gap: 2,
  },
  sourceLabel: {
    color: '#ccc',
    fontSize: 11,
    fontWeight: '600',
  },
  settingsBtn: {
    marginLeft: 12,
    padding: 4,
  },
  backBtn: {
    padding: 4,
    marginRight: 8,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#16213e',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 36,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#3a3a5e',
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16,
  },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a4a',
  },
  optionItemActive: {
    backgroundColor: 'rgba(231,76,60,0.08)',
    borderRadius: 8,
  },
  optionLabel: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 12,
    flex: 1,
  },
  optionLabelActive: {
    color: '#e74c3c',
    fontWeight: '600',
  },
  cancelBtn: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#2a2a4a',
    alignItems: 'center',
  },
  cancelText: {
    color: '#888',
    fontSize: 16,
    fontWeight: '600',
  },
});
