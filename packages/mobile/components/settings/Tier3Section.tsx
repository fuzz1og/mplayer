import { useState, useEffect } from 'react';
import { View, Text, TextInput, Alert, Switch } from 'react-native';
import { RefreshCw, Trash2, Plus } from 'lucide-react-native';
import {
  setTier3Enabled as setCoreTier3Enabled,
  addTier3SubscriptionFromUrl,
  addTier3SubscriptionFromText,
  removeTier3Subscription,
  refreshTier3Subscription,
  getTier3Stats,
  clearTier3Stats,
} from '@mplayer/core';
import type { Tier3SourceStats } from '@mplayer/core';
import { useSettingsStore } from '../../stores/settingsStore';
import { textVariants } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import ScalePress from '../ScalePress';
import { useSettingsStyles } from './settingsStyles';

/**
 * 第三方解析源（tier3）区段（#144）。自治组件：订阅 tier3Enabled / tier3Subscriptions，
 * 自持 URL 与粘贴框、busy 态、每源统计快照；副作用（增删/刷新订阅）全留在本区段内，
 * 不跟着拆段散到页面（#425 备注）。
 */
export default function Tier3Section() {
  const { colors } = useTheme();
  const styles = useSettingsStyles();
  const tier3Enabled = useSettingsStore((s) => s.tier3Enabled);
  const tier3Subscriptions = useSettingsStore((s) => s.tier3Subscriptions);

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

  return (
    // tier3 第三方解析源（#144，实验性）：按 iOS 惯例拆成小分组，避免一个巨型组
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
                <ScalePress onPress={() => void handleRefreshTier3(sub.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 6 }}>
                  <RefreshCw size={16} color={colors.textSecondary} />
                </ScalePress>
              )}
              <ScalePress onPress={() => handleRemoveTier3(sub.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 6 }}>
                <Trash2 size={16} color={colors.danger} />
              </ScalePress>
            </View>
          ))}
        </View>
      )}

      {/* 每源解析统计（本次会话）：命中/未命中，辅助判断订阅源质量 */}
      {Object.keys(tier3Stats).length > 0 && (
        <View style={[styles.group, styles.groupGap]}>
          <View style={styles.groupPad}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ ...textVariants.settingsTertiary, color: colors.textSecondary }}>每源解析统计（本次会话）· 健康度只调整遍历顺序</Text>
              <View style={{ flexDirection: 'row' }}>
                <ScalePress onPress={refreshTier3Stats} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 4 }}>
                  <RefreshCw size={14} color={colors.textSecondary} />
                </ScalePress>
                <ScalePress onPress={handleClearTier3Stats} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 4 }}>
                  <Trash2 size={14} color={colors.textSecondary} />
                </ScalePress>
              </View>
            </View>
            {Object.entries(tier3Stats).map(([sourceId, st]) => {
              // 声明了 source 才按源归属过滤：解析腿的 url-resolver 不声明会被拒绝，
              // 「跳过」计数让「源没命中」与「源被归属过滤」可区分（否则用户只看到源不够用）。
              const declared = tier3Subscriptions
                .flatMap((sub) => sub.manifest.sources)
                .find((s) => s.id === sourceId)?.source;
              return (
                // 源名与统计**分行**：统计串随列数增长（交付/丢弃/未命中/跳过/护栏拒绝/健康度/已降级），
                // 同行并排会把源名挤成「sl…」这种不可读的省略（模拟器窄屏实测）——与下方播放诊断条目同版式
                <View key={sourceId} style={{ paddingVertical: 4 }}>
                  <Text style={{ ...textVariants.settingsTertiary, color: colors.textPrimary }} numberOfLines={1}>
                    {sourceId}
                    {declared ? ' · ' + declared : ''}
                  </Text>
                  <Text style={{ ...textVariants.settingsTertiary, color: colors.textSecondary, marginTop: 2 }}>
                    交付 {st.hits} / 丢弃 {st.discarded ?? 0} / 未命中 {st.misses} / 跳过 {st.skipped ?? 0}
                    {st.guardRejected ? ` / 护栏拒绝 ${st.guardRejected}` : ''}
                    {st.healthScore != null ? ` / 健康度 ${st.healthScore.toFixed(2)}` : ''}
                    {st.demoted ? '（已降级）' : ''}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {/* iOS footer：说明文字在组下方（8pt 距组）；原放在节标题下会与卡片粘连 */}
      <Text style={styles.sectionFootnote}>官方直连失败后按订阅清单尝试第三方源，全部失败换元/标记不可播。清单条目可用 source 声明服务哪个音乐源（netease/qq/kugou/kuwo/migu/qianqian/soda，也认 tencent、tx、163 等别名）；url-resolver 不写会被拒绝，聚合端点请拆成多条条目。实验性功能，不内置任何解析端点。</Text>
    </View>
  );
}
