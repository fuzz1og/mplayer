import { useEffect, useMemo, useRef } from 'react';
import { Tabs, usePathname, router } from 'expo-router';
import type { Href } from 'expo-router';
import { BlurTargetView } from 'expo-blur';
import { Compass, Flame, ListMusic, Download } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useAnimatedBg } from '../../theme/AnimatedBg';
import { TAB_LABEL_HEIGHT, TAB_PAD_BOTTOM, TAB_SAFE_INSET_MIN, tabBarHeight as chromeTabBarHeight } from '../../components/chromeMetrics';
import TopBar from '../../components/TopBar';
import PlayerBar from '../../components/PlayerBar';
import ChromeBlur, { chromeBlurTargetRef } from '../../components/ChromeBlur';
import { usePlayerStore } from '../../stores/playerStore';
import ScalePress from '../../components/ScalePress';

// 底部 chrome 的 tab 清单（与 <Tabs.Screen> 路由一一对应；search 页由 href:null 隐藏）
// 顺序对齐 master：推荐第一（initialRouteName="recommend"，首屏）
const TABS: { name: string; href: Href; icon: LucideIcon; label: string }[] = [
  { name: 'recommend', href: '/recommend', icon: Flame, label: '推荐' },
  { name: 'index', href: '/', icon: Compass, label: '发现' },
  { name: 'playlists', href: '/playlists', icon: ListMusic, label: '歌单' },
  { name: 'download', href: '/download', icon: Download, label: '本地歌曲' },
];

/**
 * 底部 chrome（tab 栏 + 迷你播放栏），在 TabLayout 顶层、BlurTargetView 之外渲染。
 * 这样 tab 栏的 ChromeBlur / PlayerBar 的 ChromeBlur 都不是自身 blurTarget 的后代，
 * Android 上才能真 blur（BlurView 在自身 target 子树内会自包含而失效）。
 * - tab 栏收起动画 / 搜索页 tab 隐藏逻辑与原 AnimatedTabBar 一致（ADR-0008）
 * - PlayerBar 保留搜索页 tab 收起时贴底补安全区逻辑
 */
function BottomChrome() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tabBarStyles = useMemo(() => makeTabBarStyles(), []);
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const isSearch = pathname === '/search';
  // ADR-0008：首次播放前迷你播放栏隐藏（内容让位已随之缩小），第一首播放时滑入
  const playerVisible = usePlayerStore((s) => !!(s.currentSong || s.hasPlayed));
  const tabBarHeight = chromeTabBarHeight(insets.bottom);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const heightAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // 依赖 pathname 而非仅 isSearch：进入详情页再返回时强制重新同步动画，
    // 避免收起动画状态机卡住导致底部 tab 不弹起
    slideAnim.stopAnimation();
    heightAnim.stopAnimation();
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: isSearch ? 1 : 0, duration: 200, useNativeDriver: true }),
      Animated.timing(heightAnim, { toValue: isSearch ? 1 : 0, duration: 200, useNativeDriver: false }),
    ]).start();
  }, [isSearch, pathname, slideAnim, heightAnim]);

  const translateY = slideAnim.interpolate({ inputRange: [0, 1], outputRange: [0, tabBarHeight] });
  const containerHeight = heightAnim.interpolate({ inputRange: [0, 1], outputRange: [tabBarHeight, 0] });

  return (
    // 悬浮底部 chrome（UI 重构 M2）：绝对定位脱离文档流，内容从其半透明材质下穿过；
    // box-none 让 chrome 之间的空隙不拦截列表滚动手势
    <View pointerEvents="box-none" style={styles.chromeHost}>
      {/* 迷你播放栏（毛玻璃 ChromeBlur，居 tab 栏上方） */}
      {playerVisible && (
        <View style={[styles.playerWrap, isSearch && { paddingBottom: insets.bottom }]}>
          <PlayerBar />
        </View>
      )}
      {/* tab 栏（毛玻璃 ChromeBlur）——搜索页收起为 0 高度，PlayerBar 贴底补安全区 */}
      <Animated.View style={{ overflow: 'hidden', height: containerHeight }}>
        <Animated.View style={{ transform: [{ translateY }] }}>
          <ChromeBlur style={tabBarStyles.blurWrap}>
            <View style={[tabBarStyles.container, { paddingBottom: TAB_PAD_BOTTOM + Math.max(0, insets.bottom - TAB_SAFE_INSET_MIN) }]}>
              {TABS.map((tab) => {
                const isFocused = pathname === tab.href;
                const Icon = tab.icon;
                return (
                  <ScalePress key={tab.name} onPress={() => router.navigate(tab.href)} pressScaleTo={0.95} style={tabBarStyles.tab}>
                    <Icon size={22} color={isFocused ? colors.accent : colors.textSecondary} />
                    <Text style={[{ color: isFocused ? colors.accent : colors.textSecondary, fontSize: 11, marginTop: 2, lineHeight: TAB_LABEL_HEIGHT - 2 }]}>
                      {tab.label}
                    </Text>
                  </ScalePress>
                );
              })}
            </View>
          </ChromeBlur>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

export default function TabLayout() {
  const { colors, isDark } = useTheme();
  const animatedBg = useAnimatedBg();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Animated.View style={[styles.container, { backgroundColor: animatedBg }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {/* 内容区作为 Android 毛玻璃目标（ADR-0010）：TopBar / BottomChrome 的 BlurView 经
          chromeBlurTargetRef 模糊此区域，实现「悬浮 chrome 模糊背后内容」。
          BlurTargetView 必须排在 TopBar/BottomChrome 之前渲染，确保 BlurView 挂载时 blurTarget 已赋值 */}
      <BlurTargetView ref={chromeBlurTargetRef} style={{ flex: 1 }}>
        <Tabs
          initialRouteName="recommend"
          screenOptions={{
            headerShown: false,
          }}
          tabBar={() => null}
        >
          <Tabs.Screen name="recommend" options={{ title: '推荐' }} />
          <Tabs.Screen name="index" options={{ title: '发现' }} />
          <Tabs.Screen name="search" options={{ title: '搜索', href: null }} />
          <Tabs.Screen name="playlists" options={{ title: '歌单' }} />
          <Tabs.Screen name="download" options={{ title: '本地歌曲' }} />
        </Tabs>
      </BlurTargetView>
      {/* 顶部 chrome 悬浮（M2）：内容从半透明 TopBar 下穿过；在 BlurTargetView 之后渲染 */}
      <View pointerEvents="box-none" style={styles.topChrome}>
        <TopBar />
      </View>
      {/* 底部 chrome（tab 栏 + 迷你播放栏）在 BlurTargetView 之外，Android 才能真 blur */}
      <BottomChrome />
    </Animated.View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  // 主题切换平滑过渡（M3）：根部应用共享 Animated 背景色（屏内容器再盖一层 SceneView 默认浅底）
  container: { flex: 1 },
  // 悬浮顶部 chrome：半透明材质，内容从下穿过（M2）
  topChrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  // 与 PlayerBar 背景一致,保证安全区 padding 区域颜色连续
  playerWrap: { backgroundColor: colors.bgPlayer },
  // 悬浮底部 chrome 宿主：box-none 空隙不拦截滚动
  chromeHost: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
});

const makeTabBarStyles = () => StyleSheet.create({
  // 毛玻璃由 ChromeBlur 提供（ADR-0005/0010），容器仅排版；overflow hidden 防模糊越界
  blurWrap: { overflow: 'hidden' },
  container: {
    flexDirection: 'row',
    backgroundColor: 'transparent',
    paddingBottom: 24,
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
