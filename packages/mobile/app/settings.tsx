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
import { CircleCheck, RefreshCcw, RefreshCw, Download, CircleX, Trash2, Plus, Gauge } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MULTI_SOURCE_LIST, SOURCE_DISPLAY_NAMES, hasDirectClient, setTier3Enabled as setCoreTier3Enabled, addTier3SubscriptionFromUrl, addTier3SubscriptionFromText, removeTier3Subscription, refreshTier3Subscription, getTier3Stats, clearTier3Stats, UPDATE_SOURCE_DEFS } from '@mplayer/core';
import type { Tier3SourceStats } from '@mplayer/core';
import { useSettingsStore } from '../stores/settingsStore';
import { cacheKernel, getCacheStats } from '../services/cacheService';
import { checkLatestRelease, speedTestChannels, type ChannelSpeedResult } from '../services/appUpdate';
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
  /** #263：debug→release 跨签名迁移（v1.7.0/1.7.1 → ≥1.7.2）需要卸载重装 */
  const [needsMigration, setNeedsMigration] = useState(false);

  // 更新通道（#262/#263）：镜像优先、GitHub 直连垫底；auto 测速择优
  const updateChannel = useSettingsStore((s) => s.updateChannel);
  const setUpdateChannelStore = useSettingsStore((s) => s.setUpdateChannel);
  const [channelExpanded, setChannelExpanded] = useState(false);
  const [speedResults, setSpeedResults] = useState<ChannelSpeedResult[] | null>(null);
  const [testingSpeed, setTestingSpeed] = useState(false);

  const channelLabel = (id: string): string =>
    id === 'auto' ? '自动测速' : UPDATE_SOURCE_DEFS.find((d) => d.id === id)?.label || id;

  const handleSpeedTest = async (): Promise<void> => {
    setTestingSpeed(true);
    try {
      setSpeedResults(await speedTestChannels());
    } catch {
      Alert.alert('提示', '测速失败，请检查网络');
    } finally {
      setTestingSpeed(false);
    }
  };

  const handleCheckUpdate = async () => {
    setUpdateState('checking');
    try {
      // #262/#263：镜像优先取 latest.yml，直连 API 仅兜底；按通道解析 APK 直链
      const result = await checkLatestRelease(currentVersion, updateChannel);
      if (result.state === 'available') {
        setLatestVersion(result.version || '');
        setReleaseNotes(result.releaseNotes || '');
        setApkUrl(result.apkUrl || '');
        setNeedsMigration(!!result.needsUninstallMigration);
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
            <View style={styles.segmentCell}>
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
        </View>

        {/* tier3 第三方解析源（#144，实验性）：按 iOS 惯例拆成小分组，避免一个巨型组 */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>第三方解析源（tier3）</Text>
          {/* iOS 惯例：同一节连续 cells 合成一个卡片，cell 间 hairline 分隔（rowSep） */}
          <View style={styles.group}>
            <View style={styles.rowSwitch}>
              <Text style={[styles.modeLabel, { flex: 1 }]}>启用第三方解析</Text>
              {/* iOS Switch 高度 31pt：Android Material Switch 默认 48dp 会撑高 cell 行高。
                  transform scale 只改视觉不改布局占位，必须用 switchWrap 固定 31 高度收敛占位 */}
              <View style={styles.switchWrap}>
                <Switch value={tier3Enabled} onValueChange={handleTier3Toggle} style={styles.switch} />
              </View>
            </View>
            {/* iOS 表单惯例：输入 cell + 下方居中「添加」整行按钮（紧贴成块） */}
            <View style={[styles.groupPad, styles.rowSep, { paddingBottom: 0 }]}>
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
              style={[styles.actionRow, tier3Busy && styles.actionRowDisabled]}
              onPress={handleAddTier3Url}
              disabled={tier3Busy}
            >
              <Plus size={18} color={tier3Busy ? colors.textSecondary : colors.accent} style={styles.btnIcon} />
              <Text style={[styles.actionRowText, tier3Busy && { color: colors.textSecondary }]}>添加 URL 订阅</Text>
            </ScalePress>
            {/* 多行 JSON 输入 + 下方居中「添加粘贴清单」（与 URL 块同构） */}
            <View style={[styles.groupPad, styles.rowSep, { paddingBottom: 0 }]}>
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
              style={[styles.actionRow, tier3Busy && styles.actionRowDisabled]}
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
                    <Text style={{ ...textVariants.settingsPrimary, fontWeight: '500', color: colors.textPrimary }}>{sub.name}</Text>
                    {/* iOS cell 副标题 15pt（settingsSecondary）/ 三级信息 13pt（settingsTertiary） */}
                    <Text style={{ ...textVariants.settingsSecondary, color: colors.textSecondary }} numberOfLines={1}>{sub.source}</Text>
                    <Text style={{ ...textVariants.settingsTertiary, color: colors.textTertiary }}>{sub.manifest.sources.length} 个源</Text>
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
                  <Text style={{ ...textVariants.settingsTertiary, color: colors.textSecondary }}>每源解析统计（本次会话）</Text>
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
                    <Text style={{ ...textVariants.settingsTertiary, color: colors.textPrimary, flex: 1 }} numberOfLines={1}>{sourceId}</Text>
                    <Text style={{ ...textVariants.settingsTertiary, color: colors.textSecondary }}>命中 {st.hits} / 未命中 {st.misses}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* iOS footer：说明文字在组下方（8pt 距组）；原放在节标题下会与卡片粘连 */}
          <Text style={styles.sectionFootnote}>官方直连失败后按订阅清单尝试第三方源，全部失败换元/标记不可播。实验性功能，不内置任何解析端点。</Text>
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

            {/* 下载通道（#262/#263）：镜像优先、GitHub 直连垫底；auto 测速择优 */}
            <ScalePress style={[styles.row, styles.rowSep]} onPress={() => setChannelExpanded(!channelExpanded)}>
              <Gauge size={18} color={colors.accent} style={styles.btnIcon} />
              <Text style={styles.actionRowText}>下载通道</Text>
              <Text style={styles.modeStatus}>{channelLabel(updateChannel)}</Text>
            </ScalePress>
            {channelExpanded && (
              <>
                {[
                  { id: 'auto', label: '自动（测速择优）' },
                  ...UPDATE_SOURCE_DEFS.map((d) => ({ id: d.id, label: d.label })),
                ].map((opt) => {
                  const active = updateChannel === opt.id;
                  return (
                    <TouchableOpacity
                      key={opt.id}
                      style={[styles.row, styles.rowSep]}
                      activeOpacity={0.6}
                      onPress={() => setUpdateChannelStore(opt.id)}
                    >
                      <Text style={{ ...textVariants.settingsPrimary, color: colors.textPrimary, flex: 1 }}>
                        {opt.label}
                      </Text>
                      {active ? (
                        <CircleCheck size={18} color={colors.accent} />
                      ) : (
                        <View style={{ width: 18 }} />
                      )}
                    </TouchableOpacity>
                  );
                })}
                <ScalePress
                  style={[styles.actionRow, styles.rowSep, testingSpeed && styles.actionRowDisabled]}
                  onPress={handleSpeedTest}
                  disabled={testingSpeed}
                >
                  {testingSpeed ? (
                    <RefreshCcw size={18} color={colors.textSecondary} style={styles.btnIcon} />
                  ) : (
                    <Gauge size={18} color={colors.accent} style={styles.btnIcon} />
                  )}
                  <Text style={styles.actionRowText}>{testingSpeed ? '测速中…' : '通道测速'}</Text>
                </ScalePress>
                {speedResults && (
                  <View style={[styles.groupPad, styles.rowSep]}>
                    <Text style={styles.releaseNotes} numberOfLines={3}>
                      {speedResults
                        .map((r) => `${r.label.replace(' 镜像', '')} ${r.latencyMs == null ? '超时' : `${r.latencyMs}ms`}`)
                        .join(' · ')}
                    </Text>
                  </View>
                )}
              </>
            )}

            {updateState === 'idle' && (
              <ScalePress style={[styles.actionRow, styles.rowSep]} onPress={handleCheckUpdate}>
                <RefreshCw size={18} color={colors.accent} style={styles.btnIcon} />
                <Text style={styles.actionRowText}>检查更新</Text>
              </ScalePress>
            )}
            {updateState === 'checking' && (
              <View style={[styles.row, styles.rowSep]}>
                <RefreshCcw size={18} color={colors.textSecondary} style={styles.btnIcon} />
                <Text style={{ ...textVariants.settingsPrimary, color: colors.textSecondary }}>检查中…</Text>
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
                {needsMigration && (
                  <Text style={[styles.releaseNotes, { color: colors.danger }]}>
                    注意：旧版本签名机制不同，若安装报「签名不一致/重复签名」，请先卸载旧版再安装本更新包
                  </Text>
                )}
                <ScalePress style={styles.updateBtn} onPress={handleUpdate}>
                  <Download size={18} color={colors.textInverse} style={styles.btnIcon} />
                  <Text style={styles.updateBtnText}>立即更新</Text>
                </ScalePress>
              </View>
            )}
            {updateState === 'not-available' && (
              <View style={[styles.row, styles.rowSep]}>
                <CircleCheck size={20} color={colors.success} style={{ marginRight: 8 }} />
                <Text style={{ ...textVariants.settingsPrimary, color: colors.successText }}>已是最新版本</Text>
              </View>
            )}
            {updateState === 'error' && (
              <View style={[styles.row, styles.rowSep]}>
                <CircleX size={20} color={colors.danger} style={{ marginRight: 8 }} />
                <Text style={{ ...textVariants.settingsPrimary, color: colors.danger }}>检查失败，请检查网络</Text>
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
  /* 外观：iOS 13+ 默认分段控件 cell——控件铺满、垂直居中紧凑（~60pt cell） */
  segmentCell: {
    paddingHorizontal: spacing[4],
    paddingVertical: 10,
  },
  /* iOS 13+ 分段控件默认：极浅灰底（segmentTrack）+ 选中段白胶囊浮起 */
  segmentGroup: {
    flexDirection: 'row',
    backgroundColor: colors.segmentTrack,
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
    paddingTop: spacing[8], // iOS inset grouped 节间距 ~32pt（原 24 偏紧）
  },
  /* iOS inset grouped：节标题 13pt 灰色大写（uppercase secondary label）；
     白组坐灰底、组圆角 10pt（radius.md）、无阴影无边框；水平缩进 16（spacing[4]） */
  sectionLabel: {
    ...textVariants.settingsHeader,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
  /* iOS 组下脚注：13pt 灰（secondary label） */
  sectionFootnote: {
    ...textVariants.footnote,
    color: colors.textSecondary,
    marginTop: spacing[2],
  },
  group: {
    backgroundColor: colors.bgSurface,
    borderRadius: radius.md, // iOS 组圆角 10pt（原 lg=16 偏大）
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
  /* 操作行：iOS 设置操作 cell 文字居中（accent 主操作 / 破坏性红），图标+文字整体居中 */
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: 12,
  },
  /* iOS 操作行：17pt accent（settingsPrimary） */
  actionRowText: {
    ...textVariants.settingsPrimary,
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
  /* iOS cell：主标题 17pt（settingsPrimary），值 13pt（settingsTertiary） */
  modeLabel: {
    ...textVariants.settingsPrimary,
    color: colors.textPrimary,
    flex: 1,
  },
  /* Switch 行：iOS cell 44pt（31 Switch + 13 padding ≈ 44），独立于通用 row 避免全局改动 */
  rowSwitch: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: 6,
  },
  /* Android Material Switch 默认 48dp 偏高：wrap 固定 31（iOS UISwitch 高度）收敛布局占位 */
  switchWrap: {
    height: 31,
    justifyContent: 'center',
  },
  /* 视觉再缩 0.65 → 48dp × 0.65 ≈ 31pt，与 iOS UISwitch 观感一致 */
  switch: {
    transform: [{ scale: 0.65 }],
  },
  modeStatus: {
    ...textVariants.settingsTertiary,
    color: colors.textSecondary,
  },
  // ADR-0006：success 当文字仅 ≈2.3:1，走 successText 达标
  modeStatusReady: {
    color: colors.successText,
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
  // ADR-0006：success 当文字走 successText 达标
  updateAvailableText: {
    color: colors.successText,
    ...textVariants.body,
    fontWeight: '600',
    marginBottom: spacing[2],
  },
  releaseNotes: {
    ...textVariants.settingsTertiary,
    color: colors.textSecondary,
    marginBottom: spacing[3],
    lineHeight: 20,
  },
});
