import { View, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { useTheme } from '../theme/ThemeProvider';
import { useSettingsStyles } from '../components/settings/settingsStyles';
import AppearanceSection from '../components/settings/AppearanceSection';
import PlaybackSection from '../components/settings/PlaybackSection';
import DirectStatusSection from '../components/settings/DirectStatusSection';
import Tier3Section from '../components/settings/Tier3Section';
import DeveloperModeSection from '../components/settings/DeveloperModeSection';
import DiagnosticsSection from '../components/settings/DiagnosticsSection';
import CacheSection from '../components/settings/CacheSection';
import AboutSection from '../components/settings/AboutSection';
import { useSettingsStore } from '../stores/settingsStore';

/**
 * 设置页（#425）：**只做布局**——纵向排列各区段卡片，不持任何区段状态。
 * #477：开发者模式开关（DeveloperModeSection）常驻可见；「播放诊断」区段从**默认可见**改为**只在开
 * 发者模式打开时渲染**（ADR `2026-09-23-playback-trace-sink` 决策 6）。
 */
export default function SettingsPage() {
  const { colors } = useTheme();
  const styles = useSettingsStyles();
  const devMode = useSettingsStore((s) => s.devMode);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: '设置',
          headerShown: true,
          headerStyle: { backgroundColor: colors.bgSurface },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
        }}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        <AppearanceSection />
        <PlaybackSection />
        <DirectStatusSection />
        <Tier3Section />
        <DeveloperModeSection />
        {devMode ? <DiagnosticsSection /> : null}
        <CacheSection />
        <AboutSection />
      </ScrollView>
    </View>
  );
}
