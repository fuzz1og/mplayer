import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Linking,
} from 'react-native';
import { Stack } from 'expo-router';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { setApiBaseUrl as setCoreApiBaseUrl, setProxyUrl as setCoreProxyUrl, musicApi } from '@mplayer/core';
import { useSettingsStore } from '../stores/settingsStore';

export default function SettingsPage() {
  const storeApiBaseUrl = useSettingsStore((s) => s.apiBaseUrl);
  const storeProxyUrl = useSettingsStore((s) => s.proxyUrl);
  const setApiBaseUrl = useSettingsStore((s) => s.setApiBaseUrl);
  const setStoreProxyUrl = useSettingsStore((s) => s.setProxyUrl);

  const [localUrl, setLocalUrl] = useState(storeApiBaseUrl);
  const [localProxyUrl, setLocalProxyUrl] = useState(storeProxyUrl);
  const [saved, setSaved] = useState(false);
  const [proxySaved, setProxySaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null);

  const currentVersion = Constants.expoConfig?.version || '0.0.0';

  // 更新检查状态
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'available' | 'not-available' | 'error'>('idle');
  const [latestVersion, setLatestVersion] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [apkUrl, setApkUrl] = useState('');

  function compareVersions(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }

  const handleCheckUpdate = async () => {
    setUpdateState('checking');
    try {
      const res = await fetch('https://gitee.com/api/v5/repos/aris3104/mplayer/releases');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const list = await res.json();
      if (!list || list.length === 0) {
        // 还没有任何发布版本
        setUpdateState('not-available');
        setTimeout(() => setUpdateState('idle'), 2000);
        return;
      }
      const latest = list[0];
      const remoteVer = latest.tag_name.replace(/^v/i, '');
      if (compareVersions(remoteVer, currentVersion) > 0) {
        setLatestVersion(remoteVer);
        setReleaseNotes(latest.body || '');
        const apkAsset = latest.assets?.find((a: any) =>
          a.name?.endsWith('.apk') || a.content_type?.includes('apk')
        );
        setApkUrl(apkAsset?.browser_download_url || '');
        setUpdateState('available');
      } else {
        setUpdateState('not-available');
        setTimeout(() => setUpdateState('idle'), 2000);
      }
    } catch {
      setUpdateState('error');
      setTimeout(() => setUpdateState('idle'), 2000);
    }
  };

  const handleUpdate = () => {
    if (apkUrl) Linking.openURL(apkUrl);
  };

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
      // 先用临时 URL 测试, 成功才保存
      const baseUrl = localUrl.trim().replace(/\/+$/, '');
      setCoreApiBaseUrl(baseUrl);
      const ok = await musicApi.healthCheck();
      if (!ok) throw new Error('health check failed');
      // 测试通过, 持久化
      setApiBaseUrl(baseUrl);
      setTestResult('success');
    } catch {
      setTestResult('fail');
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 3000);
    }
  };

  const handleSaveProxy = () => {
    const url = localProxyUrl.trim();
    setStoreProxyUrl(url);
    setCoreProxyUrl(url);
    setProxySaved(true);
    setTimeout(() => setProxySaved(false), 1500);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: '设置',
          headerShown: true,
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

        {/* 代理设置 */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>代理设置</Text>
            <Text style={styles.label}>代理地址（可选，留空=直连）</Text>
            <TextInput
              style={styles.input}
              value={localProxyUrl}
              onChangeText={setLocalProxyUrl}
              placeholder="http://127.0.0.1:8080"
              placeholderTextColor="#555"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TouchableOpacity
              style={[styles.saveBtn, proxySaved && styles.saveBtnSaved]}
              onPress={handleSaveProxy}
              activeOpacity={0.7}
            >
              <Ionicons
                name={proxySaved ? 'checkmark-circle' : 'save-outline'}
                size={18}
                color="#fff"
                style={styles.btnIcon}
              />
              <Text style={styles.saveBtnText}>
                {proxySaved ? '已保存' : '保存代理'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 检查更新 */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>检查更新</Text>
            {updateState === 'idle' && (
              <>
                <TouchableOpacity style={styles.saveBtn} onPress={handleCheckUpdate} activeOpacity={0.7}>
                  <Ionicons name="refresh-outline" size={18} color="#fff" style={styles.btnIcon} />
                  <Text style={styles.saveBtnText}>检查更新</Text>
                </TouchableOpacity>
                <Text style={styles.hintText}>点击检查是否有新版本可用</Text>
              </>
            )}
            {updateState === 'checking' && (
              <>
                <View style={[styles.saveBtn, { backgroundColor: '#555' }]}>
                  <Ionicons name="sync-outline" size={18} color="#fff" style={styles.btnIcon} />
                  <Text style={styles.saveBtnText}>检查中...</Text>
                </View>
              </>
            )}
            {updateState === 'available' && (
              <>
                <Text style={styles.updateAvailableText}>发现新版本 v{latestVersion}</Text>
                {releaseNotes ? (
                  <Text style={styles.releaseNotes} numberOfLines={4}>
                    {releaseNotes}
                  </Text>
                ) : null}
                <TouchableOpacity style={styles.saveBtn} onPress={handleUpdate} activeOpacity={0.7}>
                  <Ionicons name="download-outline" size={18} color="#fff" style={styles.btnIcon} />
                  <Text style={styles.saveBtnText}>立即更新</Text>
                </TouchableOpacity>
              </>
            )}
            {updateState === 'not-available' && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="checkmark-circle" size={20} color="#27ae60" style={{ marginRight: 8 }} />
                <Text style={{ color: '#27ae60', fontSize: 14 }}>已是最新版本</Text>
              </View>
            )}
            {updateState === 'error' && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="close-circle" size={20} color="#c0392b" style={{ marginRight: 8 }} />
                <Text style={{ color: '#c0392b', fontSize: 14 }}>检查失败，请检查网络</Text>
              </View>
            )}
          </View>
        </View>

        {/* 关于 */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>关于</Text>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>应用版本</Text>
              <Text style={styles.aboutValue}>{currentVersion}</Text>
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
  hintText: {
    color: '#666',
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
  updateAvailableText: {
    color: '#27ae60',
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  releaseNotes: {
    color: '#aaa',
    fontSize: 12,
    marginBottom: 12,
    lineHeight: 18,
  },
});
