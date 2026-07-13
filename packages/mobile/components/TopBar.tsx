import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

export default function TopBar() {
  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#888" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.input}
          placeholder="搜索歌曲..."
          placeholderTextColor="#666"
          onFocus={() => router.push('/search')}
        />
      </View>
      <TouchableOpacity onPress={() => router.push('/settings')} style={styles.settingsBtn}>
        <Ionicons name="settings-outline" size={22} color="#ccc" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    paddingTop: 52, // safe area top
    backgroundColor: '#1a1a2e',
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2a2a4a',
    borderRadius: 20,
    paddingHorizontal: 12,
    height: 36,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
  },
  settingsBtn: {
    marginLeft: 12,
    padding: 4,
  },
});
