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
import ScalePress from '../components/ScalePress';

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

        {/* 外观（#173：深色模式）—— iOS inset grouped：白组坐灰底，组间留白，统一 16pt 缩进 */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>外观</Text>
          <View style={styles.group}>
            <View style={styles.groupPad}>
              <View style={styles.segmentGroup}>
                {THEME_MODE_OPTIONS.map((opt) => {
                  const active = themeMode === opt.value;
                  return (
                    <ScalePress
                      key={opt.value}
                      style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                      onPress={() => setThemeMode(opt.value)}
                    >
                      <Text style={[styles.segmentBtnText, active && styles.segmentBtnTextActive]}>{opt.label}</Text>
                    </ScalePress>
                  );
                })}
              </View>
            </View>
          </View>
        </View>

        {/* 直连状态（T01：每源官方直连可用性；不再配置 auto/仅直连） */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>直连状态</Text>
          <View style={styles.group}>
            {MULTI_SOURCE_LIST.map((source, i) => {
              const ready = hasDirectClient(source);
              return (
                <View key={source} style={[styles.row, i > 0 && styles.rowSep]}>
                  <View style={[styles.statusDot, ready && styles.statusDotReady]} />
                  <Text style={styles.modeLabel}>{SOURCE_DISPLAY_NAMES[source] || source}</Text>
                  <Text style={[styles.modeStatus, ready && styles.modeStatusReady]}>
                    {ready ? '直连可用' : '直连未实现'}
                  </Text>
                </View>
              );
            })}
          </View>
          <Text style={styles.sectionFootnote}>每源官方直连可用性，直连能力按源逐步落地。</Text>
        </View>

        {/* tier3 第三方解析源（#144，实验性）：按 iOS 惯例拆成小分组，避免一个巨型组 */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>第三方解析源（tier3）</Text>
          <Text style={styles.sectionFootnote}>官方直连失败后按订阅清单尝试第三方源，全部失败换元/标记不可播。实验性功能，不内置任何解析端点。</Text>
          <View style={styles.group}>
            <View style={styles.row}>
              <Text style={[styles.modeLabel, { flex: 1 }]}>启用第三方解析</Text>
              <Switch value={tier3Enabled} onValueChange={handleTier3Toggle} />
            </View>
          </View>
          <View style={[styles.group, styles.groupGap]}>
            <View style={styles.groupPad}>
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
            </View>
            <ScalePress
              style={[styles.actionRow, styles.rowSep, tier3Busy && styles.actionRowDisabled]}
              onPress={handleAddTier3Url}
              disabled={tier3Busy}
            >
              <Plus size={18} color={tier3Busy ? colors.textSecondary : colors.accent} style={styles.btnIcon} />
              <Text style={[styles.actionRowText, tier3Busy && { color: colors.textSecondary }]}>添加 URL 订阅</Text>
            </ScalePress>
          </View>
          <View style={[styles.group, styles.groupGap]}>
            <View style={styles.groupPad}>
              <TextInput
                style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                value={tier3Paste}
                onChangeText={setTier3Paste}
                placeholder="或粘贴 JSON 音源清单…"
                placeholderTextColor={colors.inputPlaceholder}
                multiline
              />
            </View>
            <ScalePress
              style={[styles.actionRow, styles.rowSep, tier3Busy && styles.actionRowDisabled]}
              onPress={handleAddTier3Paste}
              disabled={tier3Busy}
            >
              <Plus size={18} color={tier3Busy ? colors.textSecondary : colors.accent} style={styles.btnIcon} />
              <Text style={[styles.actionRowText, tier3Busy && { color: colors.textSecondary }]}>添加粘贴清单</Text>
            </ScalePress>
          </View>

          {tier3Subscriptions.length === 0 ? (
            <Text style={styles.sectionFootnote}>暂无订阅。添加一份 JSON 音源清单后才会生效。</Text>
          ) : (
            <View style={[styles.group, styles.groupGap]}>
              {tier3Subscriptions.map((sub, i) => (
                <View key={sub.id} style={[styles.row, { alignItems: 'flex-start' }, i > 0 && styles.rowSep]}>
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
              ))}
            </View>
          )}

          {/* 每源解析统计（本次会话）：命中/未命中，辅助判断订阅源质量 */}
          {Object.keys(tier3Stats).length > 0 && (
            <View style={[styles.group, styles.groupGap]}>
              <View style={styles.groupPad}>
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
                  <View key={sourceId} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
                    <Text style={{ color: colors.textPrimary, fontSize: 12, flex: 1 }} numberOfLines={1}>{sourceId}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>命中 {st.hits} / 未命中 {st.misses}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* 缓存管理：统计 + 用量条 + 一键清理（对齐桌面 CacheSection） */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>缓存管理</Text>
          <View style={styles.group}>
            <View style={styles.groupPad}>
              <Text style={styles.cacheStatsText}>
                缓存文件 {cacheStats.fileCount} 个 · {(cacheStats.totalSize / 1024 / 1024).toFixed(1)} MB / {MAX_CACHE_MB} MB
              </Text>
              <View style={styles.cacheBarWrap}>
                <View
                  style={[
                    styles.cacheBarFill,
                    { width: `${cachePercent}%`, backgroundColor: cachePercent > 90 ? colors.danger : colors.accent },
                  ]}
                />
              </View>
            </View>
            <ScalePress style={[styles.actionRow, styles.rowSep]} onPress={handleClearCache}>
              <Trash2 size={18} color={colors.accent} style={styles.btnIcon} />
              <Text style={styles.actionRowText}>清理缓存</Text>
            </ScalePress>
          </View>
          <Text style={styles.sectionFootnote}>播放 URL 缓存 12 小时过期，清理不影响已收藏歌曲</Text>
        </View>

        {/* 检查更新（版本号作节内首行） */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>关于</Text>
          <View style={styles.group}>
            <View style={styles.row}>
              <Text style={styles.modeLabel}>当前版本</Text>
              <Text style={styles.modeStatus}>v{currentVersion}</Text>
            </View>
            {updateState === 'idle' && (
              <ScalePress style={[styles.actionRow, styles.rowSep]} onPress={handleCheckUpdate}>
                <RefreshCw size={18} color={colors.accent} style={styles.btnIcon} />
                <Text style={styles.actionRowText}>检查更新</Text>
              </ScalePress>
            )}
            {updateState === 'checking' && (
              <View style={[styles.row, styles.rowSep]}>
                <RefreshCcw size={18} color={colors.textSecondary} style={styles.btnIcon} />
                <Text style={{ ...textVariants.subhead, color: colors.textSecondary }}>检查中…</Text>
              </View>
            )}
            {updateState === 'available' && (
              <View style={[styles.groupPad, styles.rowSep]}>
                <Text style={styles.updateAvailableText}>发现新版本 v{latestVersion}</Text>
                {releaseNotes ? (
                  <Text style={styles.releaseNotes} numberOfLines={4}>
                    {releaseNotes}
                  </Text>
                ) : null}
                <ScalePress style={styles.updateBtn} onPress={handleUpdate}>
                  <Download size={18} color={colors.textInverse} style={styles.btnIcon} />
                  <Text style={styles.updateBtnText}>立即更新</Text>
                </ScalePress>
              </View>
            )}
            {updateState === 'not-available' && (
              <View style={[styles.row, styles.rowSep]}>
                <CircleCheck size={20} color={colors.success} style={{ marginRight: 8 }} />
                <Text style={{ ...textVariants.subhead, fontWeight: '400', color: colors.success }}>已是最新版本</Text>
              </View>
            )}
            {updateState === 'error' && (
              <View style={[styles.row, styles.rowSep]}>
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
    paddingTop: spacing[6],
  },
  /* iOS inset grouped（指南 §2.3/§2.5）：白组坐灰底靠明度差分层，
     无阴影无边框；节标签在组外、脚注在组下；水平缩进统一 16（spacing[4]） */
  sectionLabel: {
    ...textVariants.footnote,
    color: colors.textSecondary,
    marginBottom: spacing[2],
  },
  sectionFootnote: {
    ...textVariants.caption,
    color: colors.textTertiary,
    marginTop: spacing[2],
  },
  group: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  /* 同节多个小组之间的间距（iOS 同域小组惯例 8pt） */
  groupGap: {
    marginTop: spacing[2],
  },
  groupPad: {
    padding: spacing[4],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: 12,
  },
  rowSep: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  /* 操作行：iOS 式安静主操作（accent 文字行），替代满页填充大按钮 */
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: 12,
  },
  actionRowText: {
    ...textVariants.subhead,
    fontWeight: '500',
    color: colors.accent,
  },
  actionRowDisabled: {
    opacity: 0.55,
  },
  /* 立即更新保留填充按钮：版本可用是低频且重要的主操作，值得视觉强调 */
  updateBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginTop: spacing[3],
  },
  updateBtnText: {
    color: colors.textInverse,
    ...textVariants.subhead,
    fontWeight: '600',
  },
  label: {
    color: colors.textSecondary,
    ...textVariants.footnote,
    marginBottom: spacing[2],
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
  /* 缓存管理 */
  btnIcon: {
    marginRight: 6,
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
    marginTop: spacing[3],
  },
  cacheBarFill: {
    height: '100%',
    borderRadius: 3,
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
