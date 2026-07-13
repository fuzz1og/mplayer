import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import TopBar from '../../components/TopBar';
import PlayerBar from '../../components/PlayerBar';

export default function TabLayout() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <TopBar />
      <Tabs
        screenOptions={{
          headerShown: false,
        }}
        tabBar={({ state, navigation }) => (
          <View style={tabBarStyles.container}>
            {state.routes.map((route, i) => {
              const isFocused = state.index === i;
              const onPress = () => { navigation.navigate(route.name); };
              const icons: Record<string, string> = { index: 'compass-outline', playlists: 'list-outline', favorites: 'heart-outline' };
              const labels: Record<string, string> = { index: '发现', playlists: '歌单', favorites: '收藏' };
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
        )}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: '发现',
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
      </Tabs>
      <PlayerBar />
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
