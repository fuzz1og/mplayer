import { useState } from 'react';
import { View, Text, Alert } from 'react-native';
import Constants from 'expo-constants';
import { CircleCheck, RefreshCcw, RefreshCw, Download, CircleX, Gauge } from 'lucide-react-native';
import { UPDATE_SOURCE_DEFS } from '@mplayer/core';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  checkLatestRelease,
  speedTestChannels,
  downloadAndVerifyApk,
  launchApkInstaller,
  ApkIntegrityError,
  formatBytes,
  type ChannelSpeedResult,
  type ApkAttempt,
  type ApkVerifyReport,
} from '../../services/appUpdate';
import { textVariants } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import ScalePress, { pressScale } from '../ScalePress';
import UpdateAvailableInfo from './UpdateAvailableInfo';
import { useSettingsStyles } from './settingsStyles';

/**
 * 更新区段（#262/#263/#725）：下载通道选择 + 测速 + 检查更新 + 应用内下载校验安装。
 * 自治组件：订阅 updateChannel，自持展开/测速/检查状态——测速转圈或展开通道
 * 只重渲染本区段（#425）。渲染位置由 AboutSection 决定（同属「关于」卡片）。
 */

type UpdateState = 'idle' | 'checking' | 'available' | 'not-available' | 'error' | 'downloading' | 'installing' | 'integrity-failed';

/** 校验通过后的大小与预期/实际哈希（#725）：供人工核对，不自动据此放行安装器。 */
function ApkVerificationDetails({ report }: { report: ApkVerifyReport }) {
  const { colors } = useTheme();
  const styles = useSettingsStyles();
  const line = { ...textVariants.footnote, color: colors.textSecondary };
  return (
    <View style={[styles.groupPad, styles.rowSep]}>
      <Text style={line}>{`安装包大小：${formatBytes(report.sizeBytes)}`}</Text>
      <Text style={line}>{`预期 MD5：${report.expectedMd5}`}</Text>
      <Text style={line}>{`实际 MD5：${report.actualMd5}`}</Text>
    </View>
  );
}

/** 坏包拦截后逐通道显示预期/实际哈希（#725）：用户据此判断该换哪个通道。 */
function ApkAttemptList({ attempts }: { attempts: ApkAttempt[] }) {
  const { colors } = useTheme();
  const styles = useSettingsStyles();
  const line = { ...textVariants.footnote, color: colors.textSecondary };
  return (
    <View style={[styles.groupPad, styles.rowSep]}>
      {attempts.map((a, i) => (
        <Text key={`${a.sourceId}-${i}`} style={line}>
          {`${a.sourceLabel}：${a.message}\n大小 ${formatBytes(a.sizeBytes)} · 预期 ${a.expectedMd5 ?? '—'} · 实际 ${a.actualMd5 ?? '—'}`}
        </Text>
      ))}
    </View>
  );
}

export default function UpdateSection() {
  const { colors } = useTheme();
  const styles = useSettingsStyles();

  const currentVersion = Constants.expoConfig?.version || '0.0.0';

  // 更新检查状态
  const [updateState, setUpdateState] = useState<UpdateState>('idle');
  const [latestVersion, setLatestVersion] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  /** #263：debug→release 跨签名迁移（v1.7.0/1.7.1 → ≥1.7.2）需要卸载重装 */
  const [needsMigration, setNeedsMigration] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [verifyReport, setVerifyReport] = useState<ApkVerifyReport | null>(null);
  const [attempts, setAttempts] = useState<ApkAttempt[]>([]);

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

  /** #725：应用内下载 → 校验 → 交给系统安装器；坏包在校验处拦下，不调到 launchApkInstaller。 */
  const handleUpdate = async (): Promise<void> => {
    if (!latestVersion) return;
    setUpdateState('downloading');
    setDownloadProgress(0);
    setVerifyReport(null);
    setAttempts([]);
    try {
      const report = await downloadAndVerifyApk(latestVersion, updateChannel, {
        onProgress: (ratio) => setDownloadProgress(ratio),
        onAttempt: (attempt) => setAttempts((prev) => [...prev, attempt]),
      });
      setVerifyReport(report);
      setUpdateState('installing');
      await launchApkInstaller(report.file);
      setUpdateState('available');
    } catch (e) {
      if (e instanceof ApkIntegrityError) {
        setAttempts(e.attempts);
        setUpdateState('integrity-failed');
        Alert.alert('下载文件损坏', '下载文件损坏，请换通道重试。可在上方切换下载通道后重试。');
      } else {
        setUpdateState('error');
        Alert.alert('更新失败', '下载或打开安装器失败，请检查网络后重试。');
      }
    }
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
          {/* 与启动弹窗共用同一份信息块（#579）：迁移提示是安全相关文案，不能两处分叉 */}
          <UpdateAvailableInfo
            version={latestVersion}
            releaseNotes={releaseNotes}
            needsMigration={needsMigration}
          />
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
          <Text style={{ ...textVariants.settingsPrimary, color: colors.danger }}>操作失败，请检查网络后重试</Text>
        </View>
      )}
      {updateState === 'downloading' && (
        <View style={[styles.groupPad, styles.rowSep]}>
          <Text style={{ ...textVariants.settingsPrimary, color: colors.textSecondary }}>
            {`正在下载安装包… ${downloadProgress == null ? '' : `${Math.round(downloadProgress * 100)}%`}`}
          </Text>
          <Text style={styles.releaseNotes}>{`当前通道：${channelLabel(updateChannel)}`}</Text>
        </View>
      )}
      {updateState === 'installing' && (
        <View style={[styles.groupPad, styles.rowSep]}>
          <Text style={{ ...textVariants.settingsPrimary, color: colors.successText }}>校验通过，正在打开系统安装器…</Text>
        </View>
      )}
      {updateState === 'integrity-failed' && (
        <View style={[styles.groupPad, styles.rowSep]}>
          <Text style={{ ...textVariants.settingsPrimary, color: colors.danger }}>下载文件损坏，请换通道重试</Text>
          <Text style={styles.releaseNotes}>已自动尝试全部下载通道，均未通过校验；可在上方切换通道后重试。</Text>
          <ScalePress style={styles.updateBtn} onPress={handleUpdate}>
            <RefreshCw size={18} color={colors.textInverse} style={styles.btnIcon} />
            <Text style={styles.updateBtnText}>换通道重试</Text>
          </ScalePress>
          <ApkAttemptList attempts={attempts} />
        </View>
      )}
      {verifyReport && <ApkVerificationDetails report={verifyReport} />}
    </>
  );
}
