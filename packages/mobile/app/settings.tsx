import { useState, useEffect, useMemo } from 'react';
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
import { CircleCheck, RefreshCcw, RefreshCw, Download, CircleX, Trash2, Plus } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MULTI_SOURCE_LIST, SOURCE_DISPLAY_NAMES, hasDirectClient, setTier3Enabled as setCoreTier3Enabled, addTier3SubscriptionFromUrl, addTier3SubscriptionFromText, removeTier3Subscription, refreshTier3Subscription, getTier3Stats, clearTier3Stats } from '@mplayer/core';
import type { Tier3SourceStats } from '@mplayer/core';
import { useSettingsStore } from '../stores/settingsStore';
import { cacheKernel, getCacheStats } from '../services/cacheService';
import {radius, shadow, spacing, textVariants} from '../theme/tokens';
import type { ThemeMode, ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

/** 外观选项（#173）：system 跟随系统深浅色 */
const THEME_MODE_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

/** 缓存占用条上限（对齐桌面 CacheSection 的 100MB 口径） */
const MAX_CACHE_MB = 100;

export default function SettingsPage() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const tier3Enabled = useSettingsStore((s) => s.tier3Enabled);
  const tier3Subscriptions = useSettingsStore((s) => s.tier3Subscriptions);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);

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

  const [tier3Url, setTier3Url] = useState('');
  const [tier3Paste, setTier3Paste] = useState('');
  const [tier3Busy, setTier3Busy] = useState(false);

  // tier3 每源解析统计（本次会话）：命中/未命中，辅助判断订阅源质量
  const [tier3Stats, setTier3Stats] = useState<Record<string, Tier3SourceStats>>({});
  const refreshTier3Stats = (): void => setTier3Stats(getTier3Stats());
  useEffect(() => {
    refreshTier3Stats();
  }, [tier3Enabled, tier3Subscriptions.length]);
  const handleClearTier3Stats = (): void => {
    clearTier3Stats();
    setTier3Stats({});
  };

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
      // Gitee 方案已取消，改为 GitHub Releases API 检查最新版本
      const res = await fetch('https://api.github.com/repos/fuzz1og/mplayer/releases/latest');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const latest = await res.json();
      if (!latest || !latest.tag_name) {
        // 还没有任何发布版本
        setUpdateState('not-available');
        setTimeout(() => setUpdateState('idle'), 2000);
        return;
      }
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

  const cachePercent = Math.min((cacheStats.totalSize / (MAX_CACHE_MB * 1024 * 1024)) * 100, 100);

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

        {/* 外观（#173：深色模式） */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>外观</Text>
            <View style={styles.segmentGroup}>
              {THEME_MODE_OPTIONS.map((opt) => {
                const active = themeMode === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                    onPress={() => setThemeMode(opt.value)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.segmentBtnText, active && styles.segmentBtnTextActive]}>{opt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* 直连状态（T01：每源直连可用性；不再配置 auto/仅直连） */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>直连状态</Text>
            <Text style={styles.label}>每源官方直连可用性，直连能力按源逐步落地。</Text>
            {MULTI_SOURCE_LIST.map((source) => {
              const ready = hasDirectClient(source);
              return (
                <View key={source} style={styles.modeRow}>
                  <View style={[styles.statusDot, ready && styles.statusDotReady]} />
                  <Text style={styles.modeLabel}>{SOURCE_DISPLAY_NAMES[source] || source}</Text>
                  <Text style={[styles.modeStatus, ready && styles.modeStatusReady]}>
                    {ready ? '直连可用' : '直连未实现'}
                  </Text>
                </View>
              );
            })}
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
              默认关闭。官方直连失败后按订阅清单尝试第三方源，全部失败换元/标记不可播。实验性功能，不内置任何解析端点。
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
                    <Text style={{ ...textVariants.subhead, fontWeight: '600', color: colors.textPrimary }}>{sub.name}</Text>
                    <Text style={{ ...textVariants.caption, color: colors.textSecondary }} numberOfLines={1}>{sub.source}</Text>
                    <Text style={{ ...textVariants.micro, fontWeight: '400', color: colors.textTertiary }}>{sub.manifest.sources.length} 个源</Text>
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

            {/* 每源解析统计（本次会话）：命中/未命中，辅助判断订阅源质量 */}
            {Object.keys(tier3Stats).length > 0 && (
              <View style={{ marginTop: spacing[3] }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ color: colors.textSecondary, fontSize: 12 }}>每源解析统计（本次会话）</Text>
                  <View style={{ flexDirection: 'row' }}>
                    <TouchableOpacity onPress={refreshTier3Stats} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 4 }}>
                      <RefreshCw size={14} color={colors.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={handleClearTier3Stats} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 4 }}>
                      <Trash2 size={14} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                </View>
                {Object.entries(tier3Stats).map(([sourceId, st]) => (
                  <View key={sourceId} style={[styles.modeRow, { paddingVertical: 4 }]}>
                    <Text style={{ color: colors.textPrimary, fontSize: 12, flex: 1 }} numberOfLines={1}>{sourceId}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>命中 {st.hits} / 未命中 {st.misses}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>

        {/* 缓存管理：统计 + 用量条 + 一键清理（对齐桌面 CacheSection） */}
        <View style={styles.section}>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>缓存管理</Text>
            <View style={styles.cacheStatsRow}>
              <Text style={styles.cacheStatsText}>
                缓存文件 {cacheStats.fileCount} 个 · {(cacheStats.totalSize / 1024 / 1024).toFixed(1)} MB / {MAX_CACHE_MB} MB
              </Text>
            </View>
            <View style={styles.cacheBarWrap}>
              <View
                style={[
                  styles.cacheBarFill,
                  { width: `${cachePercent}%`, backgroundColor: cachePercent > 90 ? colors.danger : colors.accent },
                ]}
              />
            </View>
            <TouchableOpacity style={styles.saveBtn} onPress={handleClearCache} activeOpacity={0.7}>
              <Trash2 size={18} color={colors.textInverse} style={styles.btnIcon} />
              <Text style={styles.saveBtnText}>清理缓存</Text>
            </TouchableOpacity>
            <Text style={styles.hintText}>播放 URL 缓存 12 小时过期，清理不影响已收藏歌曲</Text>
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
                <Text style={{ ...textVariants.subhead, fontWeight: '400', color: colors.success }}>已是最新版本</Text>
              </View>
            )}
            {updateState === 'error' && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <CircleX size={20} color={colors.danger} style={{ marginRight: 8 }} />
                <Text style={{ ...textVariants.subhead, fontWeight: '400', color: colors.danger }}>检查失败，请检查网络</Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
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
  /* 外观：一体分段控件 */
  segmentGroup: {
    flexDirection: 'row',
    backgroundColor: colors.bgActive,
    borderRadius: radius.sm,
    padding: 2,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radius.xs,
    alignItems: 'center',
  },
  segmentBtnActive: {
    backgroundColor: colors.bgElevated,
    ...shadow.xs,
  },
  segmentBtnText: {
    color: colors.textSecondary,
    ...textVariants.subhead,
    fontWeight: '500',
  },
  segmentBtnTextActive: {
    color: colors.accent,
    fontWeight: '600',
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
    ...textVariants.sectionHeader,
    marginBottom: spacing[4],
  },
  label: {
    color: colors.textSecondary,
    ...textVariants.footnote,
    marginBottom: spacing[2],
  },
  /* 直连状态行：圆点 + 源名 + 状态（tier3 订阅行/统计行共用行样式） */
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textTertiary,
    marginRight: 10,
  },
  statusDotReady: {
    backgroundColor: colors.success,
  },
  modeLabel: {
    color: colors.textPrimary,
    ...textVariants.subhead,
    flex: 1,
  },
  modeStatus: {
    ...textVariants.caption,
    color: colors.textTertiary,
  },
  modeStatusReady: {
    color: colors.success,
  },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    color: colors.textPrimary,
    ...textVariants.subhead,
    fontWeight: '400',
    paddingHorizontal: spacing[3],
    paddingVertical: 10,
    marginBottom: spacing[3],
  },
  saveBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  checkingBtn: {
    backgroundColor: colors.bgHover,
  },
  btnIcon: {
    marginRight: 6,
  },
  saveBtnText: {
    color: colors.textInverse,
    ...textVariants.subhead,
    fontWeight: '600',
  },
  testBtnText: { color: colors.textPrimary },
  /* 缓存管理 */
  cacheStatsRow: {
    marginTop: 6,
    marginBottom: 10,
  },
  cacheStatsText: {
    color: colors.textSecondary,
    ...textVariants.footnote,
    textAlign: 'center',
  },
  cacheBarWrap: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.bgHover,
    overflow: 'hidden',
    marginBottom: spacing[4],
  },
  cacheBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  hintText: {
    color: colors.textTertiary,
    ...textVariants.caption,
    marginTop: 10,
    textAlign: 'center',
  },
  updateAvailableText: {
    color: colors.success,
    ...textVariants.body,
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
