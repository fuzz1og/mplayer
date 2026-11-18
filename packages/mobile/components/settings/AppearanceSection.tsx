import { View, Text } from 'react-native';
import { useSettingsStore } from '../../stores/settingsStore';
import type { ThemeMode } from '../../theme/tokens';
import SegmentedTabs from '../SegmentedTabs';
import { useSettingsStyles } from './settingsStyles';

/** 外观选项（#173）：system 跟随系统深浅色 */
const THEME_MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

const THEME_MODE_TABS = THEME_MODE_OPTIONS.map((opt) => ({ key: opt.value, label: opt.label }));

/**
 * 外观区段（#173 themeMode）。自治组件：自己订阅 store 的 themeMode/setThemeMode，
 * 由设置页（app/settings.tsx）只做布局——切主题不再牵动其它区段（#425）。
 * 分段控件收敛到共享 SegmentedTabs（segmentTrack + bgElevated 滑块，iOS 13+ 一套材质）。
 */
export default function AppearanceSection() {
  const styles = useSettingsStyles();
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const activeIndex = Math.max(0, THEME_MODE_OPTIONS.findIndex((opt) => opt.value === themeMode));

  return (
    // 外观（#173：深色模式）—— iOS inset grouped：白组坐灰底，组间留白，统一 16pt 缩进
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>外观</Text>
      <View style={styles.group}>
        <View style={styles.segmentCell}>
          <SegmentedTabs
            tabs={THEME_MODE_TABS}
            activeIndex={activeIndex}
            onSelect={(i) => setThemeMode(THEME_MODE_OPTIONS[i].value)}
          />
        </View>
      </View>
    </View>
  );
}
