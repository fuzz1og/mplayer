import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, StyleSheet, Text, View, Linking } from 'react-native';
import Constants from 'expo-constants';
import { X } from 'lucide-react-native';
import { radius, spacing, textVariants, type ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { useSettingsStore } from '../stores/settingsStore';
import { checkLatestRelease } from '../services/appUpdate';
import { shouldPromptUpdate, UPDATE_PROMPT_DELAY_MS } from '../services/appUpdatePrompt';
import UpdateAvailableInfo from './settings/UpdateAvailableInfo';
import ScalePress from './ScalePress';

/**
 * 启动更新弹窗（#579 / ADR 决策 6）。
 *
 * 进入应用后延时检查一次；有新版本且该版本没被忽略过就弹窗。
 * 「叉掉 / 稍后」把**该版本号**记进 settingsStore（persist），同版本不再弹，下个版本仍会弹。
 * 「立即更新」跳浏览器下载（`Linking.openURL`）——**不做应用内下载与安装**：
 * 那需要新增原生权限与原生依赖，且 Android 的系统确认框必现，换不来静默（见 #579 out-of-scope）。
 *
 * 检查失败一律静默（不变量 I1）：不弹错误、不阻断启动。
 */
type PromptState = {
  version: string;
  releaseNotes: string;
  needsMigration: boolean;
  apkUrl: string;
};

export default function UpdatePromptHost() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [prompt, setPrompt] = useState<PromptState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const currentVersion = Constants.expoConfig?.version ?? '0.0.0';
          // 用 getState() 而不是订阅：通道变化不该重跑这次启动检查
          const channel = useSettingsStore.getState().updateChannel;
          const result = await checkLatestRelease(currentVersion, channel);
          if (cancelled || result.state !== 'available') return;
          if (!shouldPromptUpdate(result.version, useSettingsStore.getState().dismissedUpdateVersion)) return;
          setPrompt({
            version: result.version || '',
            releaseNotes: result.releaseNotes || '',
            needsMigration: !!result.needsUninstallMigration,
            apkUrl: result.apkUrl || '',
          });
        } catch {
          // 启动检查静默：失败不打扰用户（ADR 决策 1）
        }
      })();
    }, UPDATE_PROMPT_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  /** 叉掉/稍后：记下这个版本，之后同版本不再弹 */
  const handleDismiss = useCallback(() => {
    if (prompt?.version) {
      useSettingsStore.getState().setDismissedUpdateVersion(prompt.version);
    }
    setPrompt(null);
  }, [prompt]);

  const handleUpdate = useCallback(() => {
    if (prompt?.apkUrl) {
      Linking.openURL(prompt.apkUrl).catch(() => {});
    }
    handleDismiss();
  }, [prompt, handleDismiss]);

  if (!prompt) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={handleDismiss}
    >
      {/* 遮罩点击不关闭：这里是一次明确的二选一（稍后 / 立即更新），误触关掉等于静默忽略 */}
      <View style={styles.overlay}>
        <View style={styles.card}>
          <ScalePress
            style={styles.closeBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            onPress={handleDismiss}
          >
            <X size={18} color={colors.textTertiary} />
          </ScalePress>

          <UpdateAvailableInfo
            version={prompt.version}
            releaseNotes={prompt.releaseNotes}
            needsMigration={prompt.needsMigration}
            releaseNotesLines={5}
          />

          <View style={styles.actions}>
            <ScalePress style={styles.laterBtn} pressScaleTo={0.98} onPress={handleDismiss}>
              <Text style={styles.laterText}>稍后</Text>
            </ScalePress>
            <ScalePress style={styles.updateBtn} pressScaleTo={0.98} onPress={handleUpdate}>
              <Text style={styles.updateText}>立即更新</Text>
            </ScalePress>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[5],
    backgroundColor: colors.bgOverlay,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.bgSurface,
    borderRadius: radius.lg,
    padding: spacing[4],
  },
  closeBtn: {
    alignSelf: 'flex-end',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  laterBtn: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius: radius.sm,
  },
  laterText: {
    ...textVariants.subhead,
    color: colors.textSecondary,
  },
  updateBtn: {
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  updateText: {
    ...textVariants.subhead,
    fontWeight: '600',
    color: colors.textInverse,
  },
});
