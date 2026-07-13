import { useEffect, useRef } from 'react';
import { Tabs, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import TopBar from '../../components/TopBar';
import PlayerBar from '../../components/PlayerBar';

const TAB_HEIGHT = 56;

function AnimatedTabBar({ state, navigation }: { state: any; navigation: any }) {
  const pathname = usePathname();
  const isSearch = pathname === '/search';
  const slideAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: isSearch ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [isSearch]);

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, TAB_HEIGHT],
  });

  return (
    <View>
      <PlayerBar />
      <Animated.View style={{ transform: [{ translateY }] }}>
        <View style={tabBarStyles.container}>
          {state.routes.map((route: any, i: number) => {
            // 搜索 tab 不显示 tab 按钮
            if (route.name === 'search') return null;
            const isFocused = state.index === i;
            const onPress = () => { navigation.navigate(route.name); };
            const icons: Record<string, string> = { index: 'compass-outline', playlists: 'list-outline', favorites: 'heart-outline', history: 'time-outline', settings: 'settings-outline' };
            const labels: Record<string, string> = { index: '发现', playlists: '歌单', favorites: '收藏', history: '历史', settings: '设置' };
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
          name="favorites"
          options={{
            title: '收藏',
          }}
        />
        <Tabs.Screen
          name="history"
          options={{
            title: '历史',
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: '设置',
            href: null,
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
