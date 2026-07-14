import { useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';

export default function TopBar() {
  const pathname = usePathname();
  const isSearchTab = pathname === '/search';
  const [searchText, setSearchText] = useState('');

  const handleSubmit = () => {
    const trimmed = searchText.trim();
    if (!trimmed) return;
    router.replace(`/search?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <View style={styles.container}>
      {isSearchTab && (
        <TouchableOpacity onPress={() => router.replace('/')} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#ccc" />
        </TouchableOpacity>
      )}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color="#888" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.input}
          placeholder="搜索歌曲..."
          placeholderTextColor="#666"
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={handleSubmit}
          returnKeyType="search"
          onFocus={() => {
            if (!isSearchTab) {
              router.push('/search');
            }
          }}
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
  backBtn: {
    padding: 4,
    marginRight: 8,
  },
});
