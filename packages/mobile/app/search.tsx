import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSearchStore } from '../stores/searchStore';
import SongRow from '../components/SongRow';

export default function SearchPage() {
  const [inputValue, setInputValue] = useState('');
  const results = useSearchStore((s) => s.results);
  const loading = useSearchStore((s) => s.loading);
  const search = useSearchStore((s) => s.search);
  const clear = useSearchStore((s) => s.clear);

  const handleSubmit = () => {
    search(inputValue);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: '搜索',
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#fff',
        }}
      />

      <View style={styles.inputContainer}>
        <Ionicons name="search" size={18} color="#666" style={styles.searchIcon} />
        <TextInput
          style={styles.input}
          placeholder="搜索歌曲和歌手"
          placeholderTextColor="#666"
          value={inputValue}
          onChangeText={setInputValue}
          onSubmitEditing={handleSubmit}
          returnKeyType="search"
          autoFocus
        />
        {inputValue.length > 0 && (
          <Ionicons
            name="close-circle"
            size={18}
            color="#666"
            onPress={() => {
              setInputValue('');
              clear();
            }}
          />
        )}
      </View>

      {loading ? (
        <ActivityIndicator color="#e74c3c" style={{ marginTop: 40 }} />
      ) : results.length > 0 ? (
        <FlatList
          data={results}
          keyExtractor={(item) => item.key}
          renderItem={({ item: group }) => (
            <View style={styles.groupSection}>
              <Text style={styles.groupHeader}>
                {group.name}
                {group.artist ? <Text style={styles.groupArtist}> — {group.artist}</Text> : null}
              </Text>
              {group.songs.map((song) => (
                <SongRow key={song.id} song={song} showSource />
              ))}
            </View>
          )}
        />
      ) : (
        <View style={styles.emptyContainer}>
          <Ionicons name="musical-notes-outline" size={48} color="#444" />
          <Text style={styles.emptyText}>搜索歌曲和歌手</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#16213e',
    marginHorizontal: 12,
    marginTop: Platform.OS === 'android' ? 48 : 12,
    marginBottom: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
  },
  searchIcon: { marginRight: 8 },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    height: '100%',
  },
  groupSection: {
    marginBottom: 8,
  },
  groupHeader: {
    color: '#aaa',
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#16213e',
    marginTop: 8,
    marginHorizontal: 12,
    borderRadius: 8,
    overflow: 'hidden',
  },
  groupArtist: {
    color: '#666',
    fontWeight: '400',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#444',
    fontSize: 16,
    marginTop: 12,
  },
});
