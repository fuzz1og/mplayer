import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet } from 'react-native';
import TopBar from '../../components/TopBar';

export default function TabLayout() {
  return (
    <View style={styles.container}>
      <TopBar />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: styles.tabBar,
          tabBarActiveTintColor: '#e74c3c',
          tabBarInactiveTintColor: '#888',
          tabBarLabelStyle: { fontSize: 12, marginBottom: 4 },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: '发现',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="compass-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="playlists"
          options={{
            title: '歌单',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="list-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="favorites"
          options={{
            title: '收藏',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="heart-outline" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  tabBar: {
    backgroundColor: '#16213e',
    borderTopColor: '#2a2a4a',
    borderTopWidth: 1,
    height: 60,
    paddingTop: 4,
  },
});
