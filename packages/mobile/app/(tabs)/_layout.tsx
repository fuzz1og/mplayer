import { useEffect, useRef, useState } from 'react';
import { Tabs, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, TouchableOpacity, StyleSheet, Animated, LayoutChangeEvent } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import TopBar from '../../components/TopBar';
import PlayerBar from '../../components/PlayerBar';

const TAB_HEIGHT = 80;

function AnimatedTabBar({ state, navigation }: { state: any; navigation: any }) {
  const pathname = usePathname();
  const isSearch = pathname === '/search';
  const slideAnim = useRef(new Animated.Value(0)).current;
  const heightAnim = useRef(new Animated.Value(0)).current;
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
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
  }, [isSearch]);

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
      <PlayerBar />
      <Animated.View style={{ overflow: 'hidden', height: containerHeight }}>
        <Animated.View style={{ transform: [{ translateY }] }} onLayout={onLayout}>
          <View style={tabBarStyles.container}>
          {state.routes.map((route: any, i: number) => {
            // 搜索 tab 不显示 tab 按钮
            if (route.name === 'search') return null;
            const isFocused = state.index === i;
            const onPress = () => { navigation.navigate(route.name); };
            const icons: Record<string, string> = { index: 'compass-outline', playlists: 'list-outline', download: 'download-outline' };
            const labels: Record<string, string> = { index: '发现', playlists: '歌单', download: '下载' };
            return (
              <TouchableOpacity key={route.key} onPress={onPress} style={tabBarStyles.tab}>
                <Ionicons
                  name={icons[route.name] as any}
                  size={22}
                  color={isFocused ? '#e74c3c' : '#888'}
                />
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
        screenOptions={{
          headerShown: false,
        }}
        tabBar={(props) => <AnimatedTabBar {...props} />}
      >
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
