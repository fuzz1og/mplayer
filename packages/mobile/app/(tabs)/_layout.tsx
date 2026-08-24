import { useEffect, useMemo, useRef } from 'react';
import { Tabs, usePathname } from 'expo-router';
import { Compass, Flame, ListMusic, Download } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import type { ThemeColors } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import { useAnimatedBg } from '../../theme/AnimatedBg';
import { TAB_PAD_TOP, TAB_ICON_SIZE, TAB_LABEL_HEIGHT, TAB_PAD_BOTTOM, TAB_SAFE_INSET_MIN } from '../../components/chromeMetrics';
import TopBar from '../../components/TopBar';
import PlayerBar from '../../components/PlayerBar';
import ScalePress from '../../components/ScalePress';

// tab bar 内容高度（paddingTop + 图标 + 标签行 + paddingBottom）：
// 用确定性计算替代 onLayout 测量——测量值一旦偏小（如动画/初始态），
// overflow:hidden 会把标签裁掉，看起来像迷你播放栏盖住了 tab bar
// 各 TAB_* 常量来自 chromeMetrics（唯一事实源），此处不重复定义

function AnimatedTabBar({ state, navigation }: { state: any; navigation: any }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tabBarStyles = useMemo(() => makeTabBarStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const isSearch = pathname === '/search';
  const slideAnim = useRef(new Animated.Value(0)).current;
  const heightAnim = useRef(new Animated.Value(0)).current;
  const tabBarHeight =
    TAB_PAD_TOP + TAB_ICON_SIZE + TAB_LABEL_HEIGHT + TAB_PAD_BOTTOM + Math.max(0, insets.bottom - TAB_SAFE_INSET_MIN);

  useEffect(() => {
    // 依赖 pathname 而非仅 isSearch：进入详情页再返回时强制重新同步动画，
    // 避免收起动画状态机卡住导致底部 tab 不弹起
    slideAnim.stopAnimation();
    heightAnim.stopAnimation();
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: isSearch ? 1 : 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(heightAnim, {
        toValue: isSearch ? 1 : 0,
        duration: 200,
        useNativeDriver: false,
      }),
    ]).start();
  }, [isSearch, pathname]);

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, tabBarHeight],
  });

  const containerHeight = heightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [tabBarHeight, 0],
  });

  return (
    // 悬浮底部 chrome（UI 重构 M2）：绝对定位脱离文档流，内容从其半透明材质下穿过；
    // box-none 让 chrome 之间的空隙不拦截列表滚动手势
    <View pointerEvents="box-none" style={styles.chromeHost}>
      {/* 搜索页时 tab bar 收起为 0 高度,PlayerBar 贴到屏幕底部,
          需要补底部安全区 padding;其他页 tab bar 自己处理安全区 */}
      <View style={[styles.playerWrap, isSearch && { paddingBottom: insets.bottom }]}>
        <PlayerBar />
      </View>
      <Animated.View style={{ overflow: 'hidden', height: containerHeight }}>
        <Animated.View style={{ transform: [{ translateY }] }}>
          <View style={[tabBarStyles.container, { paddingBottom: TAB_PAD_BOTTOM + Math.max(0, insets.bottom - TAB_SAFE_INSET_MIN) }]}>
          {state.routes.map((route: any, i: number) => {
            // 搜索 tab 不显示 tab 按钮
            if (route.name === 'search') return null;
            const isFocused = state.index === i;
            const onPress = () => { navigation.navigate(route.name); };
            const icons: Record<string, LucideIcon> = { index: Compass, recommend: Flame, playlists: ListMusic, download: Download };
            const labels: Record<string, string> = { index: '发现', recommend: '推荐', playlists: '歌单', download: '本地歌曲' };
            const Icon = icons[route.name];
            return (
              <ScalePress key={route.key} onPress={onPress} pressScaleTo={0.95} style={tabBarStyles.tab}>
                <Icon size={22} color={isFocused ? colors.accent : colors.textSecondary} />
                <Text style={{ color: isFocused ? colors.accent : colors.textSecondary, fontSize: 11, marginTop: 2, lineHeight: TAB_LABEL_HEIGHT - 2 }}>
                  {labels[route.name]}
                </Text>
              </ScalePress>
            );
          })}
        </View>
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
      {/* 顶部 chrome 悬浮：内容从半透明 TopBar 下穿过（M2） */}
      <View pointerEvents="box-none" style={styles.topChrome}>
        <TopBar />
      </View>
      <Tabs
        initialRouteName="recommend"
        screenOptions={{
          headerShown: false,
        }}
        tabBar={(props) => <AnimatedTabBar {...props} />}
      >
        <Tabs.Screen
          name="recommend"
          options={{
            title: '推荐',
          }}
        />
        <Tabs.Screen
          name="index"
          options={{
            title: '发现',
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: '搜索',
            href: null, // 隐藏 tab 图标
          }}
        />
        <Tabs.Screen
          name="playlists"
          options={{
            title: '歌单',
          }}
        />
        <Tabs.Screen
          name="download"
          options={{
            title: '本地歌曲',
          }}
        />
      </Tabs>
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

const makeTabBarStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.bgPlayer,
    paddingBottom: 24,
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
