import { useState } from 'react';
import { View, Text, Linking, Alert } from 'react-native';
import Constants from 'expo-constants';
import { CircleCheck, RefreshCcw, RefreshCw, Download, CircleX, Gauge } from 'lucide-react-native';
import { UPDATE_SOURCE_DEFS } from '@mplayer/core';
import { useSettingsStore } from '../../stores/settingsStore';
import { checkLatestRelease, speedTestChannels, type ChannelSpeedResult } from '../../services/appUpdate';
import { textVariants } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import ScalePress, { pressScale } from '../ScalePress';
import { useSettingsStyles } from './settingsStyles';

/**
 * 更新区段（#262/#263）：下载通道选择 + 测速 + 检查更新。
 * 自治组件：订阅 updateChannel，自持展开/测速/检查状态——测速转圈或展开通道
 * 只重渲染本区段（#425）。渲染位置由 AboutSection 决定（同属「关于」卡片）。
 */
export default function UpdateSection() {
  const { colors } = useTheme();
  const styles = useSettingsStyles();

  const currentVersion = Constants.expoConfig?.version || '0.0.0';

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

  return (
    <>
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
              <ScalePress
                key={opt.id}
                style={[styles.row, styles.rowSep]}
                pressScaleTo={pressScale.row}
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
              </ScalePress>
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
    </>
  );
}
