import { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Modal,
} from 'react-native';
import { ArrowLeft, Search, Settings, ChevronDown, Check, LayoutGrid, Music2 } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, sourceColors } from '../theme/tokens';
import { useSourceStore, SOURCE_OPTION_LABELS } from '../stores/sourceStore';
import type { SourceOption } from '../stores/sourceStore';
import { useSearchStore } from '../stores/searchStore';

const SOURCE_OPTIONS: { key: SourceOption; icon: LucideIcon }[] = [
  { key: 'all', icon: LayoutGrid },
  { key: 'netease', icon: Music2 },
  { key: 'qq', icon: Music2 },
  { key: 'kugou', icon: Music2 },
  { key: 'kuwo', icon: Music2 },
  { key: 'qianqian', icon: Music2 },
  { key: 'soda', icon: Music2 },
];

export default function TopBar() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const isSearchTab = pathname === '/search';
  const [searchText, setSearchText] = useState('');
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [focused, setFocused] = useState(false);
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
          <ArrowLeft size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
      <View style={[styles.searchBar, focused && styles.searchBarFocused]}>
        <Search size={18} color={focused ? colors.accent : colors.textTertiary} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.input}
          placeholder="搜索歌曲..."
          placeholderTextColor={colors.inputPlaceholder}
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={handleSubmit}
          returnKeyType="search"
          onFocus={() => {
            setFocused(true);
            if (!isSearchTab) {
              router.push('/search');
            }
          }}
          onBlur={() => setFocused(false)}
        />
        <TouchableOpacity onPress={() => setShowSourcePicker(true)} style={styles.sourceBtn}>
          <View style={[styles.sourceDot, { backgroundColor: sourceColors[selectedSource] }]} />
          <Text style={styles.sourceLabel}>{SOURCE_OPTION_LABELS[selectedSource]}</Text>
          <ChevronDown size={12} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={() => router.push('/settings')} style={styles.settingsBtn}>
        <Settings size={22} color={colors.textSecondary} />
      </TouchableOpacity>

      <Modal visible={showSourcePicker} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setShowSourcePicker(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowSourcePicker(false)}>
          <TouchableOpacity style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]} activeOpacity={1} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>选择音乐源</Text>
            {SOURCE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.key}
                style={[styles.optionItem, selectedSource === opt.key && { backgroundColor: `${sourceColors[opt.key]}10`, borderRadius: 8 }]}
                onPress={() => handleSelectSource(opt.key)}
              >
                <opt.icon
                  size={20}
                  color={selectedSource === opt.key ? sourceColors[opt.key] : colors.textSecondary}
                />
                <Text style={[styles.optionLabel, selectedSource === opt.key && { color: sourceColors[opt.key], fontWeight: '600' }]}>
                  {SOURCE_OPTION_LABELS[opt.key]}
                </Text>
                {selectedSource === opt.key && (
                  <Check size={20} color={sourceColors[opt.key]} />
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
    backgroundColor: colors.bgSurface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: 12,
    height: 36,
  },
  searchBarFocused: {
    backgroundColor: colors.inputBgFocus,
    borderColor: colors.inputBorderFocus,
    shadowColor: colors.accent,
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  input: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontSize: 14,
  },
  sourceBtn: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgHover,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginLeft: 6,
    gap: 4,
  },
  sourceDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sourceLabel: {
    color: colors.textPrimary,
    fontSize: 12,
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
    backgroundColor: colors.bgOverlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bgSurface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 36,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgActive,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetTitle: {
    color: colors.textPrimary,
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
    borderBottomColor: colors.borderSubtle,
  },
  optionLabel: {
    color: colors.textPrimary,
    fontSize: 16,
    marginLeft: 12,
    flex: 1,
  },
  cancelBtn: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.bgHover,
    alignItems: 'center',
  },
  cancelText: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '600',
  },
});
