import { useState } from 'react';
import { View, Text, Alert, Linking } from 'react-native';
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
  browserFallbackUrl,
  clearSpeedProbeCache,
  type ChannelSpeedResult,
  type ApkAttempt,
  type ApkVerifyReport,
  type ApkVerifyFailureKind,
} from '../../services/appUpdate';
import { textVariants } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import ScalePress, { pressScale } from '../ScalePress';
import UpdateAvailableInfo from './UpdateAvailableInfo';
import { useSettingsStyles } from './settingsStyles';

/** 更新区段（#262/#263/#725）：自治组件，订阅 updateChannel，渲染位置由 AboutSection 决定（#425）。 */

type UpdateState = 'idle' | 'checking' | 'available' | 'not-available' | 'error' | 'downloading' | 'verified' | 'installing' | 'integrity-failed';

/** 校验详情（#725）：先展示供人工核对，不自动放行安装器。 */
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

/** 逐通道结果（#725）：坏包/缺校验值/下载失败的换源原因都可见。 */
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

  const [updateState, setUpdateState] = useState<UpdateState>('idle');
  const [latestVersion, setLatestVersion] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  /** #263：debug→release 跨签名迁移（v1.7.0/1.7.1 → ≥1.7.2）需要卸载重装 */
  const [needsMigration, setNeedsMigration] = useState(false);
  const [apkUrl, setApkUrl] = useState('');
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [verifyReport, setVerifyReport] = useState<ApkVerifyReport | null>(null);
  const [attempts, setAttempts] = useState<ApkAttempt[]>([]);
  const [failureKind, setFailureKind] = useState<ApkVerifyFailureKind>('corrupt');
  const [failureText, setFailureText] = useState('');

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

  const applyRelease = (result: Awaited<ReturnType<typeof checkLatestRelease>>): string | null => {
    if (result.state !== 'available') {
      setUpdateState('not-available');
      setTimeout(() => setUpdateState('idle'), 2000);
      return null;
    }
    setLatestVersion(result.version || '');
    setReleaseNotes(result.releaseNotes || '');
    setNeedsMigration(!!result.needsUninstallMigration);
    setApkUrl(result.apkUrl || '');
    setUpdateState('available');
    return result.version || '';
  };

  const handleCheckUpdate = async (): Promise<void> => {
    setUpdateState('checking');
    try {
      applyRelease(await checkLatestRelease(currentVersion, updateChannel));
    } catch {
      setUpdateState('error');
      setTimeout(() => setUpdateState('idle'), 2000);
    }
  };

  /** #725：下载 → 校验 → 停在「待人工核对」，不自动拉起安装器。 */
  const runDownload = async (version: string): Promise<void> => {
    setUpdateState('downloading');
    setDownloadProgress(0);
    setVerifyReport(null);
    setAttempts([]);
    setFailureText('');
    try {
      const report = await downloadAndVerifyApk(version, updateChannel, {
        onProgress: (ratio) => setDownloadProgress(ratio),
        onAttempt: (attempt) => setAttempts((prev) => [...prev, attempt]),
      });
      setVerifyReport(report);
      setUpdateState('verified');
    } catch (e) {
      if (e instanceof ApkIntegrityError) {
        const kind = e.kind ?? 'corrupt';
        setAttempts(e.attempts ?? []);
        setFailureKind(kind);
        setFailureText(e.message);
        setUpdateState('integrity-failed');
        setChannelExpanded(true);
        if (kind === 'checksum-unavailable') {
          Alert.alert('缺少校验文件', `${e.message}。该版本可能未附带 .apk.md5，可改用浏览器下载或换通道重试。`);
        } else {
          Alert.alert('更新校验未通过', `${e.message}；逐通道原因见下方。`);
        }
      } else {
        setUpdateState('error');
        Alert.alert('更新失败', '下载或打开安装器失败，请检查网络后重试。');
      }
    }
  };

  const handleUpdate = (): void => {
    if (latestVersion) void runDownload(latestVersion);
  };

  const handleInstall = async (): Promise<void> => {
    if (!verifyReport) return;
    setUpdateState('installing');
    try {
      await launchApkInstaller(verifyReport.file);
      setUpdateState('available');
    } catch {
      setUpdateState('error');
      Alert.alert('打开安装器失败', '请确认已允许安装未知来源应用后重试。');
    }
  };

  /** #725：重走全链——重新检查（auto 重新测速）→ 四源重新下载校验 → 人工核对 → 安装。 */
  const handleRetry = async (): Promise<void> => {
    setAttempts([]);
    setVerifyReport(null);
    setDownloadProgress(null);
    setFailureText('');
    setChannelExpanded(true);
    clearSpeedProbeCache();
    setUpdateState('checking');
    try {
      const version = applyRelease(await checkLatestRelease(currentVersion, updateChannel));
      if (version) await runDownload(version);
    } catch {
      setUpdateState('error');
    }
  };

  /** #725：旧 release 无校验资产时回退浏览器下载，明确提示用户自行核对。 */
  const handleBrowserDownload = (): void => {
    const url = apkUrl || browserFallbackUrl(latestVersion);
    Alert.alert(
      '改用浏览器下载',
      '应用内无法核对完整性。浏览器下载后请自行核对安装包大小与哈希，确认无误再安装。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '打开下载链接',
          onPress: () => { void Linking.openURL(url).catch(() => Alert.alert('提示', '无法打开下载链接')); },
        },
      ],
    );
  };

  return (
    <>
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
          <Text style={styles.releaseNotes}>单源失败会自动换下一通道，逐通道结果见下方。</Text>
        </View>
      )}
      {updateState === 'verified' && (
        <View style={[styles.groupPad, styles.rowSep]}>
          <Text style={{ ...textVariants.settingsPrimary, color: colors.successText }}>校验通过，请核对下方大小与哈希后再安装</Text>
          <ScalePress style={styles.updateBtn} onPress={handleInstall}>
            <Download size={18} color={colors.textInverse} style={styles.btnIcon} />
            <Text style={styles.updateBtnText}>核对无误，打开安装器</Text>
          </ScalePress>
        </View>
      )}
      {updateState === 'installing' && (
        <View style={[styles.groupPad, styles.rowSep]}>
          <Text style={{ ...textVariants.settingsPrimary, color: colors.successText }}>正在打开系统安装器…</Text>
        </View>
      )}
      {updateState === 'integrity-failed' && (
        <View style={[styles.groupPad, styles.rowSep]}>
          <Text style={{ ...textVariants.settingsPrimary, color: colors.danger }}>{failureText || '更新校验未通过'}</Text>
          <Text style={styles.releaseNotes}>
            {failureKind !== 'corrupt'
              ? '未取得可用的校验值，可改用浏览器下载（旧方式）；或在上方选另一个通道后重走全流程。'
              : '已自动展开下载通道，请选另一个通道后重走全流程；下方是逐通道失败原因。'}
          </Text>
          <ScalePress style={styles.updateBtn} onPress={handleRetry}>
            <RefreshCw size={18} color={colors.textInverse} style={styles.btnIcon} />
            <Text style={styles.updateBtnText}>换通道重试</Text>
          </ScalePress>
          {failureKind !== 'corrupt' && (
            <ScalePress style={[styles.actionRow, styles.rowSep]} onPress={handleBrowserDownload}>
              <Text style={styles.actionRowText}>用浏览器下载（旧方式）</Text>
            </ScalePress>
          )}
        </View>
      )}
      {attempts.length > 0 && <ApkAttemptList attempts={attempts} />}
      {verifyReport && <ApkVerificationDetails report={verifyReport} />}
    </>
  );
}
