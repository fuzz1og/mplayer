import { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Linking,
  Alert,
  Switch,
} from 'react-native';
import { Stack } from 'expo-router';
import Constants from 'expo-constants';
import { CircleCheck, Save, RefreshCcw, Zap, RefreshCw, Download, CircleX, Trash2, Plus } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setApiBaseUrl as setCoreApiBaseUrl, setProxyUrl as setCoreProxyUrl, musicApi, MULTI_SOURCE_LIST, setSourceModes as setCoreSourceModes, SOURCE_DISPLAY_NAMES, SOURCE_MODE_OPTIONS, hasDirectClient, setTier3Enabled as setCoreTier3Enabled, addTier3SubscriptionFromUrl, addTier3SubscriptionFromText, removeTier3Subscription, refreshTier3Subscription } from '@mplayer/core';
import { useSettingsStore } from '../stores/settingsStore';
import { useLogsStore } from '../stores/logsStore';
import { cacheKernel, getCacheStats } from '../services/cacheService';
import { colors, radius, shadow, spacing } from '../theme/tokens';

function formatLogTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default function SettingsPage() {
  const storeApiBaseUrl = useSettingsStore((s) => s.apiBaseUrl);
  const storeProxyUrl = useSettingsStore((s) => s.proxyUrl);
  const sourceModes = useSettingsStore((s) => s.sourceModes);
  const tier3Enabled = useSettingsStore((s) => s.tier3Enabled);
  const tier3Subscriptions = useSettingsStore((s) => s.tier3Subscriptions);
  const setApiBaseUrl = useSettingsStore((s) => s.setApiBaseUrl);
  const setStoreProxyUrl = useSettingsStore((s) => s.setProxyUrl);
  const logEntries = useLogsStore((s) => s.entries);
  const clearLogs = useLogsStore((s) => s.clearLogs);

  // 直连设置：改 core 来源开关 → persister 镜像进 store（AsyncStorage 持久化）
  const handleSourceModeChange = (source: string, mode: 'auto' | 'direct' | 'api'): void => {
    setCoreSourceModes({ ...sourceModes, [source]: mode });
  };

  // tier3 第三方解析源（#144）：默认关，移动端支持 URL / 手动粘贴
  const handleTier3Toggle = (value: boolean): void => {
    setCoreTier3Enabled(value);
  };

  const handleAddTier3Url = async (): Promise<void> => {
    const trimmed = tier3Url.trim();
    if (!/^https?:\/\/.+/.test(trimmed)) {
      Alert.alert('提示', '请输入 http(s) 开头的订阅 URL');
      return;
    }
    setTier3Busy(true);
    try {
      await addTier3SubscriptionFromUrl({ url: trimmed });
      setTier3Url('');
      Alert.alert('提示', 'URL 订阅已添加');
    } catch (e: any) {
      Alert.alert('添加失败', e?.message || '未知错误');
    } finally {
      setTier3Busy(false);
    }
  };

  const handleAddTier3Paste = async (): Promise<void> => {
    if (!tier3Paste.trim()) {
      Alert.alert('提示', '请粘贴 JSON 音源清单');
      return;
    }
    setTier3Busy(true);
    try {
      await addTier3SubscriptionFromText({ text: tier3Paste });
      setTier3Paste('');
      Alert.alert('提示', '粘贴清单已添加');
    } catch (e: any) {
      Alert.alert('添加失败', e?.message || '未知错误');
    } finally {
      setTier3Busy(false);
    }
  };

  const handleRemoveTier3 = (id: string): void => {
    removeTier3Subscription(id);
  };

  const handleRefreshTier3 = async (id: string): Promise<void> => {
    setTier3Busy(true);
    try {
      await refreshTier3Subscription(id);
      Alert.alert('提示', '订阅已刷新');
    } catch (e: any) {
      Alert.alert('刷新失败', e?.message || '未知错误');
    } finally {
      setTier3Busy(false);
    }
  };

  const [localUrl, setLocalUrl] = useState(storeApiBaseUrl);
  const [localProxyUrl, setLocalProxyUrl] = useState(storeProxyUrl);
  const [saved, setSaved] = useState(false);
  const [proxySaved, setProxySaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null);
  const [focusedInput, setFocusedInput] = useState<'api' | 'proxy' | null>(null);
  const [tier3Url, setTier3Url] = useState('');
  const [tier3Paste, setTier3Paste] = useState('');
  const [tier3Busy, setTier3Busy] = useState(false);

  const currentVersion = Constants.expoConfig?.version || '0.0.0';

  // 缓存统计（进入页面加载一次，清理后刷新）
  const [cacheStats, setCacheStats] = useState({ fileCount: 0, totalSize: 0 });
  useEffect(() => {
    let cancelled = false;
    getCacheStats().then((s) => { if (!cancelled) setCacheStats(s); });
    return () => { cancelled = true; };
  }, []);

  const handleClearCache = async () => {
    await cacheKernel.clear();
    // 清理旧版 AsyncStorage songUrl: 缓存残留（已迁移到 cacheKernel）
    try {
      const keys = await AsyncStorage.getAllKeys();
      const stale = keys.filter((k) => k.startsWith('songUrl:'));
      if (stale.length > 0) await AsyncStorage.multiRemove(stale);
    } catch { /* 忽略残留清理失败 */ }
    setCacheStats(await getCacheStats());
    Alert.alert('提示', '缓存已清理');
  };

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
          headerStyle: { backgroundColor: colors.bgSurface },
          headerTintColor: colors.textPrimary,
          headerShadowVisible: false,
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
              style={[styles.input, focusedInput === 'api' && styles.inputFocused]}
              value={localUrl}
              onChangeText={setLocalUrl}
              placeholder="https://your-api-server.com"
              placeholderTextColor={colors.inputPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onFocus={() => setFocusedInput('api')}
              onBlur={() => setFocusedInput(null)}
            />
            <TouchableOpacity
              style={[styles.saveBtn, saved && styles.saveBtnSaved]}
              onPress={handleSaveUrl}
              activeOpacity={0.7}
            >
              {saved ? (
                <CircleCheck size={18} color={colors.textInverse} style={styles.btnIcon} />
              ) : (
                <Save size={18} color={colors.textInverse} style={styles.btnIcon} />
              )}
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
              {testing ? (
                <RefreshCcw size={18} color={testResult === null ? colors.textPrimary : colors.textInverse} style={styles.btnIcon} />
              ) : testResult === 'success' ? (
                <CircleCheck size={18} color={colors.textInverse} style={styles.btnIcon} />
              ) : testResult === 'fail' ? (
                <CircleX size={18} color={colors.textInverse} style={styles.btnIcon} />
              ) : (
                <Zap size={18} color={colors.textPrimary} style={styles.btnIcon} />
              )}
              <Text style={[styles.saveBtnText, testResult === null && styles.testBtnText]}>
                {testing ? '测试中...' : testResult === 'success' ? '连接成功' : testResult === 'fail' ? '连接失败' : '测试连接'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 直连设置（T01：每源来源开关） */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>直连设置</Text>
            <Text style={styles.label}>
              每源请求方式：自动 = 官方直连优先、失败回退自建 API；仅直连 / 仅自建 API。直连能力按源逐步落地。
            </Text>
            {MULTI_SOURCE_LIST.map((source) => (
              <View key={source} style={styles.modeRow}>
                <Text style={styles.modeLabel}>{SOURCE_DISPLAY_NAMES[source] || source}</Text>
                <Text style={[styles.modeStatus, hasDirectClient(source) && styles.modeStatusReady]}>
                  {hasDirectClient(source) ? '直连可用' : '直连未实现'}
                </Text>
                <View style={styles.modeGroup}>
                  {SOURCE_MODE_OPTIONS.map((m) => {
                    const active = (sourceModes[source] || 'auto') === m.value;
                    return (
                      <TouchableOpacity
                        key={m.value}
                        style={[styles.modeBtn, active && styles.modeBtnActive]}
                        onPress={() => handleSourceModeChange(source, m.value)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.modeBtnText, active && styles.modeBtnTextActive]}>{m.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* tier3 第三方解析源（#144，实验性） */}
        <View style={styles.section}>
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.sectionTitle}>第三方解析源（tier3）</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={[styles.hintText, { marginTop: 0, marginRight: 8 }]}>
                  {tier3Enabled ? '已开启' : '已关闭'}
                </Text>
                <Switch value={tier3Enabled} onValueChange={handleTier3Toggle} />
              </View>
            </View>
            <Text style={styles.label}>
              默认关闭。官方直连失败后按订阅清单尝试第三方源，全部失败回退自建 API / 换元。实验性功能，不内置任何解析端点。
            </Text>
            <TextInput
              style={styles.input}
              value={tier3Url}
              onChangeText={setTier3Url}
              placeholder="https://example.com/manifest.json"
              placeholderTextColor={colors.inputPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TouchableOpacity
              style={[styles.saveBtn, tier3Busy && styles.checkingBtn]}
              onPress={handleAddTier3Url}
              disabled={tier3Busy}
              activeOpacity={0.7}
            >
              <Plus size={18} color={tier3Busy ? colors.textSecondary : colors.textInverse} style={styles.btnIcon} />
              <Text style={[styles.saveBtnText, tier3Busy && styles.testBtnText]}>添加 URL 订阅</Text>
            </TouchableOpacity>
            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: 'top', marginTop: spacing[3] }]}
              value={tier3Paste}
              onChangeText={setTier3Paste}
              placeholder="或粘贴 JSON 音源清单…"
              placeholderTextColor={colors.inputPlaceholder}
              multiline
            />
            <TouchableOpacity
              style={[styles.saveBtn, tier3Busy && styles.checkingBtn]}
              onPress={handleAddTier3Paste}
              disabled={tier3Busy}
              activeOpacity={0.7}
            >
              <Plus size={18} color={tier3Busy ? colors.textSecondary : colors.textInverse} style={styles.btnIcon} />
              <Text style={[styles.saveBtnText, tier3Busy && styles.testBtnText]}>添加粘贴清单</Text>
            </TouchableOpacity>

            {tier3Subscriptions.length === 0 ? (
              <Text style={styles.hintText}>暂无订阅。添加一份 JSON 音源清单后才会生效。</Text>
            ) : (
              tier3Subscriptions.map((sub) => (
                <View key={sub.id} style={styles.modeRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.textPrimary, fontSize: 14, fontWeight: '600' }}>{sub.name}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }} numberOfLines={1}>{sub.source}</Text>
                    <Text style={{ color: colors.textTertiary, fontSize: 11 }}>{sub.manifest.sources.length} 个源</Text>
                  </View>
                  {sub.kind === 'url' && (
                    <TouchableOpacity onPress={() => void handleRefreshTier3(sub.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 6 }}>
                      <RefreshCw size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity onPress={() => handleRemoveTier3(sub.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 6 }}>
                    <Trash2 size={16} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        </View>

        {/* 代理设置 */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>代理设置</Text>
            <Text style={styles.label}>代理地址（可选，留空=直连）</Text>
            <TextInput
              style={[styles.input, focusedInput === 'proxy' && styles.inputFocused]}
              value={localProxyUrl}
              onChangeText={setLocalProxyUrl}
              placeholder="http://127.0.0.1:8080"
              placeholderTextColor={colors.inputPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onFocus={() => setFocusedInput('proxy')}
              onBlur={() => setFocusedInput(null)}
            />
            <TouchableOpacity
              style={[styles.saveBtn, proxySaved && styles.saveBtnSaved]}
              onPress={handleSaveProxy}
              activeOpacity={0.7}
            >
              {proxySaved ? (
                <CircleCheck size={18} color={colors.textInverse} style={styles.btnIcon} />
              ) : (
                <Save size={18} color={colors.textInverse} style={styles.btnIcon} />
              )}
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
                  <RefreshCw size={18} color={colors.textInverse} style={styles.btnIcon} />
                  <Text style={styles.saveBtnText}>检查更新</Text>
                </TouchableOpacity>
                <Text style={styles.hintText}>点击检查是否有新版本可用</Text>
              </>
            )}
            {updateState === 'checking' && (
              <>
                <View style={[styles.saveBtn, styles.checkingBtn]}>
                  <RefreshCcw size={18} color={colors.textSecondary} style={styles.btnIcon} />
                  <Text style={[styles.saveBtnText, styles.testBtnText]}>检查中...</Text>
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
                  <Download size={18} color={colors.textInverse} style={styles.btnIcon} />
                  <Text style={styles.saveBtnText}>立即更新</Text>
                </TouchableOpacity>
              </>
            )}
            {updateState === 'not-available' && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <CircleCheck size={20} color={colors.success} style={{ marginRight: 8 }} />
                <Text style={{ color: colors.success, fontSize: 14 }}>已是最新版本</Text>
              </View>
            )}
            {updateState === 'error' && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <CircleX size={20} color={colors.danger} style={{ marginRight: 8 }} />
                <Text style={{ color: colors.danger, fontSize: 14 }}>检查失败，请检查网络</Text>
              </View>
            )}
          </View>
        </View>

        {/* 缓存管理：统计 + 一键清理（对齐桌面 CacheSection） */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>缓存管理</Text>
            <View style={styles.cacheStatsRow}>
              <Text style={styles.hintText}>
                缓存文件 {cacheStats.fileCount} 个 · {(cacheStats.totalSize / 1024 / 1024).toFixed(1)} MB
              </Text>
            </View>
            <TouchableOpacity style={styles.saveBtn} onPress={handleClearCache} activeOpacity={0.7}>
              <Trash2 size={18} color={colors.textInverse} style={styles.btnIcon} />
              <Text style={styles.saveBtnText}>清理缓存</Text>
            </TouchableOpacity>
            <Text style={styles.hintText}>播放 URL 缓存 12 小时过期，清理不影响已收藏歌曲</Text>
          </View>
        </View>

        {/* 播放日志（真机上无法看终端 console，这里可直接查看最近播放/失败记录） */}
        <View style={styles.section}>
          <View style={styles.card}>
            <View style={styles.logHeader}>
              <Text style={styles.sectionTitle}>播放日志</Text>
              <TouchableOpacity onPress={clearLogs} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Trash2 size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            {logEntries.length === 0 ? (
              <Text style={styles.hintText}>暂无日志</Text>
            ) : (
              [...logEntries].reverse().slice(0, 30).map((e, i) => (
                <View key={`${e.ts}-${i}`} style={styles.logRow}>
                  <Text
                    style={[
                      styles.logLevel,
                      e.level === 'error' && styles.logLevelError,
                      e.level === 'warn' && styles.logLevelWarn,
                    ]}
                  >
                    {e.level === 'error' ? 'ERR' : e.level === 'warn' ? 'WRN' : 'INF'}
                  </Text>
                  <Text style={styles.logTime}>{formatLogTime(e.ts)}</Text>
                  <Text style={styles.logMessage} numberOfLines={2}>{e.message}</Text>
                </View>
              ))
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
    backgroundColor: colors.bgBase,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  section: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[5],
  },
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md,
    ...shadow.sm,
    padding: spacing[4],
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: spacing[4],
  },
  label: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: spacing[2],
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  modeLabel: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    width: 56,
  },
  modeStatus: {
    flex: 1,
    fontSize: 11,
    color: colors.textSecondary,
    marginLeft: 8,
  },
  modeStatusReady: {
    color: colors.success,
  },
  modeGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  modeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
  },
  modeBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  modeBtnText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  modeBtnTextActive: {
    color: colors.textInverse,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: spacing[3],
    paddingVertical: 10,
    marginBottom: spacing[3],
  },
  inputFocused: {
    backgroundColor: colors.inputBgFocus,
    borderColor: colors.inputBorderFocus,
  },
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  saveBtnSaved: {
    backgroundColor: colors.success,
  },
  checkingBtn: {
    backgroundColor: colors.bgHover,
  },
  btnIcon: {
    marginRight: 6,
  },
  saveBtnText: {
    color: colors.textInverse,
    fontSize: 14,
    fontWeight: '600',
  },
  testBtn: { backgroundColor: colors.bgHover, borderRadius: radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, marginTop: spacing[2] },
  testBtnText: { color: colors.textPrimary },
  testBtnSuccess: { backgroundColor: colors.success },
  testBtnFail: { backgroundColor: colors.danger },
  radioItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
  },
  radioItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  radioLabel: {
    color: colors.textSecondary,
    fontSize: 15,
    marginLeft: spacing[3],
  },
  radioLabelActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  logLevel: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '700',
    width: 30,
    marginTop: 2,
  },
  logLevelError: {
    color: colors.dangerText,
  },
  logLevelWarn: {
    color: colors.warning,
  },
  logTime: {
    color: colors.textTertiary,
    fontSize: 11,
    width: 58,
    marginTop: 2,
  },
  logMessage: {
    color: colors.textSecondary,
    fontSize: 12,
    flex: 1,
    lineHeight: 16,
  },
  aboutLabel: {
    color: colors.textSecondary,
    fontSize: 15,
  },
  aboutValue: {
    color: colors.textPrimary,
    fontSize: 15,
  },
  hintText: {
    color: colors.textTertiary,
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
  cacheStatsRow: {
    marginTop: 6,
  },
  updateAvailableText: {
    color: colors.success,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: spacing[2],
  },
  releaseNotes: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: spacing[3],
    lineHeight: 18,
  },
});
