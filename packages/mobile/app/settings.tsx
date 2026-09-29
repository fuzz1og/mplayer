import { View, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { useTheme } from '../theme/ThemeProvider';
import { useSettingsStyles } from '../components/settings/settingsStyles';
import AppearanceSection from '../components/settings/AppearanceSection';
import PlaybackSection from '../components/settings/PlaybackSection';
import DirectStatusSection from '../components/settings/DirectStatusSection';
import Tier3Section from '../components/settings/Tier3Section';
import DiagnosticsSection from '../components/settings/DiagnosticsSection';
import CacheSection from '../components/settings/CacheSection';
import AboutSection from '../components/settings/AboutSection';

/**
 * 设置页（#425）：**只做布局**——纵向排列各区段卡片，不持任何区段状态。
 * 每个区段是自治组件（自己订阅自己的 store / 自持局部状态），
 * 因此局部变化（切主题 / 展开更新通道 / tier3 输入 / 测速转圈）只重渲染对应区段。
 * 样式与度量统一在 components/settings/settingsStyles.ts（单一来源）。
 */
export default function SettingsPage() {
  const { colors } = useTheme();
  const styles = useSettingsStyles();

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
        <DiagnosticsSection />
        <CacheSection />
        <AboutSection />
      </ScrollView>
    </View>
  );
}
