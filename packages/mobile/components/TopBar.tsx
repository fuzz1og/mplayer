import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
} from 'react-native';
import { ArrowLeft, Search, Settings, ChevronDown, Check, LayoutGrid, Music2 } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {radius, textVariants} from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { useSourceStore, SOURCE_OPTION_LABELS } from '../stores/sourceStore';
import type { SourceOption } from '../stores/sourceStore';
import { useSearchStore } from '../stores/searchStore';
import SourceBadge from './SourceBadge';
import BottomSheet from './BottomSheet';
import ChromeBlur from './ChromeBlur';
import { TOP_BAR_PAD_VERTICAL, SEARCH_BAR_HEIGHT } from './chromeMetrics';
import ScalePress from './ScalePress';

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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
    <ChromeBlur style={[styles.container, { paddingTop: insets.top + TOP_BAR_PAD_VERTICAL }]}>
      {isSearchTab && (
        <ScalePress
          onPress={() => router.replace('/')}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <ArrowLeft size={22} color={colors.textSecondary} />
        </ScalePress>
      )}
      <View style={[styles.searchBar, focused && styles.searchBarFocused]}>
        {/* 焦点光环用独立 overlay 实现：改父视图 elevation/shadow 会让 Android 聚焦中的 EditText 失焦 */}
        {focused && <View pointerEvents="none" style={styles.focusRing} />}
        <Search size={18} color={focused ? colors.accent : colors.textTertiary} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.input}
          placeholder="搜索歌曲..."
          placeholderTextColor={colors.inputPlaceholder}
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={handleSubmit}
          returnKeyType="search"
          onPressIn={() => {
            // onFocus 只在焦点变化时触发：从搜索页返回后输入框可能仍保持
            // 聚焦，再次点击不会导航——用 onPressIn 保证每次点击都进搜索
            if (!isSearchTab) {
              useSearchStore.getState().clear();
              setSearchText('');
              router.push({ pathname: '/search', params: {} });
            }
          }}
          onFocus={() => {
            setFocused(true);
          }}
          onBlur={() => setFocused(false)}
        />
        <TouchableOpacity onPress={() => setShowSourcePicker(true)} style={styles.sourceBtn}>
          <SourceBadge source={selectedSource} size="sm" />
          <Text style={styles.sourceLabel}>{SOURCE_OPTION_LABELS[selectedSource]}</Text>
          <ChevronDown size={12} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <ScalePress
        onPress={() => router.push('/settings')}
        style={styles.settingsBtn}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Settings size={22} color={colors.textSecondary} />
      </ScalePress>

      <BottomSheet visible={showSourcePicker} onClose={() => setShowSourcePicker(false)}>
        <Text style={styles.sheetTitle}>选择音乐源</Text>
        {SOURCE_OPTIONS.map((opt) => (
          <ScalePress
            key={opt.key}
            pressScaleTo={0.98}
            style={[styles.optionItem, selectedSource === opt.key && { backgroundColor: colors.bgHover, borderRadius: radius.md }]}
            onPress={() => handleSelectSource(opt.key)}
          >
            {/* 源身份只经 6px 徽章点表达（源色纪律）；文字/图标保持中性色保对比度 */}
            <SourceBadge source={opt.key} size="md" style={styles.optionDot} />
            <opt.icon
              size={20}
              color={selectedSource === opt.key ? colors.textPrimary : colors.textSecondary}
            />
            <Text style={[styles.optionLabel, selectedSource === opt.key && { color: colors.textPrimary, fontWeight: '600' }]}>
              {SOURCE_OPTION_LABELS[opt.key]}
            </Text>
            {selectedSource === opt.key && (
              <Check size={20} color={colors.textPrimary} />
            )}
          </ScalePress>
        ))}
        <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowSourcePicker(false)}>
          <Text style={styles.cancelText}>取消</Text>
        </TouchableOpacity>
      </BottomSheet>
    </ChromeBlur>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: TOP_BAR_PAD_VERTICAL,
    // paddingTop 由组件按 insets.top 动态注入（写死 52 在无刘海机型空一大截）
    // 悬浮 chrome：毛玻璃材质由 ChromeBlur 提供（ADR-0005），此处透明
    backgroundColor: 'transparent',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.inputBg,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    height: SEARCH_BAR_HEIGHT,
  },
  searchBarFocused: {
    backgroundColor: colors.inputBgFocus,
  },
  focusRing: {
    position: 'absolute',
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderRadius: radius.full + 3,
    borderWidth: 2,
    borderColor: colors.accentSubtle,
  },
  input: {
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
    color: colors.textPrimary,
    ...textVariants.subhead,
    fontWeight: '400',
    // Android TextInput 在定高容器里默认自带内边距 + 顶部对齐，文字会偏离中心
    paddingVertical: 0,
    textAlignVertical: 'center',
    includeFontPadding: false,
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
  optionDot: {
    marginRight: 12,
  },
  sourceLabel: {
    ...textVariants.caption,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  settingsBtn: {
    marginLeft: 12,
    padding: 4,
  },
  backBtn: {
    padding: 4,
    marginRight: 8,
  },
  sheetTitle: {
    ...textVariants.title,
    color: colors.textPrimary,
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
    ...textVariants.callout,
    color: colors.textPrimary,
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
    ...textVariants.sectionHeader,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
