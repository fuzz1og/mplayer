import { useEffect, useRef, useState } from 'react';
import { Tabs, usePathname } from 'expo-router';
import { Compass, Flame, ListMusic, Download } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { View, Text, TouchableOpacity, StyleSheet, Animated, LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import TopBar from '../../components/TopBar';
import PlayerBar from '../../components/PlayerBar';

const TAB_HEIGHT = 80;

function AnimatedTabBar({ state, navigation }: { state: any; navigation: any }) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const isSearch = pathname === '/search';
  const slideAnim = useRef(new Animated.Value(0)).current;
  const heightAnim = useRef(new Animated.Value(0)).current;
  const [contentHeight, setContentHeight] = useState(0);

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
    outputRange: [0, TAB_HEIGHT],
  });

  const containerHeight = heightAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [contentHeight || 150, 0],
  });

  const onLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0 && h !== contentHeight) setContentHeight(h);
  };

  return (
    <View>
      {/* 搜索页时 tab bar 收起为 0 高度,PlayerBar 贴到屏幕底部,
          需要补底部安全区 padding;其他页 tab bar 自己处理安全区 */}
      <View style={[styles.playerWrap, isSearch && { paddingBottom: insets.bottom }]}>
        <PlayerBar />
      </View>
      <Animated.View style={{ overflow: 'hidden', height: containerHeight }}>
        <Animated.View style={{ transform: [{ translateY }] }} onLayout={onLayout}>
          <View style={[tabBarStyles.container, { paddingBottom: 24 + Math.max(0, insets.bottom - 8) }]}>
          {state.routes.map((route: any, i: number) => {
            // 搜索 tab 不显示 tab 按钮
            if (route.name === 'search') return null;
            const isFocused = state.index === i;
            const onPress = () => { navigation.navigate(route.name); };
            const icons: Record<string, LucideIcon> = { index: Compass, recommend: Flame, playlists: ListMusic, download: Download };
            const labels: Record<string, string> = { index: '发现', recommend: '推荐', playlists: '歌单', download: '下载' };
            const Icon = icons[route.name];
            return (
              <TouchableOpacity key={route.key} onPress={onPress} style={tabBarStyles.tab}>
                <Icon size={22} color={isFocused ? '#e74c3c' : '#888'} />
                <Text style={{ color: isFocused ? '#e74c3c' : '#888', fontSize: 11, marginTop: 2 }}>
                  {labels[route.name]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Animated.View>
    </Animated.View>
    </View>
  );
}

export default function TabLayout() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <TopBar />
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
            title: '下载',
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  // 与 PlayerBar 背景一致,保证安全区 padding 区域颜色连续
  playerWrap: { backgroundColor: '#16213e' },
});

const tabBarStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: '#16213e',
    borderTopColor: '#2a2a4a',
    borderTopWidth: 1,
    paddingBottom: 24,
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
