import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { setApiBaseUrl as setCoreApiBaseUrl } from '@mplayer/core';
import { useSettingsStore, PLAY_MODES } from '../stores/settingsStore';
import type { PlayMode } from '../stores/settingsStore';

export default function SettingsPage() {
  const storeApiBaseUrl = useSettingsStore((s) => s.apiBaseUrl);
  const storePlayMode = useSettingsStore((s) => s.playMode);
  const setApiBaseUrl = useSettingsStore((s) => s.setApiBaseUrl);
  const setPlayMode = useSettingsStore((s) => s.setPlayMode);

  const [localUrl, setLocalUrl] = useState(storeApiBaseUrl);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null);

  const handleSaveUrl = () => {
    setApiBaseUrl(localUrl.trim());
    setCoreApiBaseUrl(localUrl.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleTestConnection = async () => {
    if (!localUrl.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const baseUrl = localUrl.trim().replace(/\/+$/, '');
      const response = await fetch(`${baseUrl}/search?input=test&limit=1`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      setTestResult(response.ok ? 'success' : 'fail');
    } catch {
      setTestResult('fail');
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 3000);
    }
  };

  const handlePlayModeChange = (mode: PlayMode) => {
    setPlayMode(mode);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: '设置',
          headerStyle: { backgroundColor: '#1a1a2e' },
          headerTintColor: '#fff',
        }}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {/* API 设置 */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>API 设置</Text>
            <Text style={styles.label}>API 基础地址</Text>
            <TextInput
              style={styles.input}
              value={localUrl}
              onChangeText={setLocalUrl}
              placeholder="https://your-api-server.com"
              placeholderTextColor="#555"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TouchableOpacity
              style={[styles.saveBtn, saved && styles.saveBtnSaved]}
              onPress={handleSaveUrl}
              activeOpacity={0.7}
            >
              <Ionicons
                name={saved ? 'checkmark-circle' : 'save-outline'}
                size={18}
                color="#fff"
                style={styles.btnIcon}
              />
              <Text style={styles.saveBtnText}>
                {saved ? '已保存' : '保存'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.testBtn, testResult === 'success' && styles.testBtnSuccess, testResult === 'fail' && styles.testBtnFail]}
              onPress={handleTestConnection}
              disabled={testing || !localUrl.trim()}
              activeOpacity={0.7}
            >
              <Ionicons
                name={testing ? 'sync-outline' : testResult === 'success' ? 'checkmark-circle' : testResult === 'fail' ? 'close-circle' : 'flash-outline'}
                size={18}
                color="#fff"
                style={styles.btnIcon}
              />
              <Text style={styles.saveBtnText}>
                {testing ? '测试中...' : testResult === 'success' ? '连接成功' : testResult === 'fail' ? '连接失败' : '测试连接'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 播放模式 */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>播放模式</Text>
            {PLAY_MODES.map((mode, index) => {
              const active = storePlayMode === mode;
              return (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.radioItem,
                    index < PLAY_MODES.length - 1 && styles.radioItemBorder,
                  ]}
                  onPress={() => handlePlayModeChange(mode)}
                  activeOpacity={0.6}
                >
                  <Ionicons
                    name={active ? 'radio-button-on' : 'radio-button-off'}
                    size={20}
                    color={active ? '#e74c3c' : '#666'}
                  />
                  <Text
                    style={[
                      styles.radioLabel,
                      active && styles.radioLabelActive,
                    ]}
                  >
                    {mode}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* 关于 */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>关于</Text>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>应用版本</Text>
              <Text style={styles.aboutValue}>1.0.0</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  section: {
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 16,
  },
  label: {
    color: '#aaa',
    fontSize: 13,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
    color: '#fff',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  saveBtn: {
    backgroundColor: '#e74c3c',
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  saveBtnSaved: {
    backgroundColor: '#27ae60',
  },
  btnIcon: {
    marginRight: 6,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  testBtn: { backgroundColor: '#2a2a4a', borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, marginTop: 8 },
  testBtnSuccess: { backgroundColor: '#27ae60' },
  testBtnFail: { backgroundColor: '#c0392b' },
  radioItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  radioItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a3e',
  },
  radioLabel: {
    color: '#aaa',
    fontSize: 15,
    marginLeft: 12,
  },
  radioLabelActive: {
    color: '#fff',
    fontWeight: '600',
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  aboutLabel: {
    color: '#aaa',
    fontSize: 15,
  },
  aboutValue: {
    color: '#fff',
    fontSize: 15,
  },
});
