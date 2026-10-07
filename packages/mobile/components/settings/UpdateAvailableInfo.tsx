import { View, Text } from 'react-native';
import { spacing, textVariants } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';

/**
 * 「发现新版本」信息块（#579）——设置页与启动弹窗**共用同一份**。
 *
 * 抽出来的理由是 `needsMigration` 那段跨签名迁移提示（#263）属安全相关文案：
 * 两处各写一份必然会分叉，而分叉的后果是用户按错版本升级、覆盖安装被拒。
 */
export interface UpdateAvailableInfoProps {
  version: string;
  releaseNotes: string;
  /** #263：debug→release 跨签名迁移（v1.7.0/1.7.1 → ≥1.7.2）需要卸载重装 */
  needsMigration: boolean;
  /** 弹窗里高度有限，可收紧说明行数 */
  releaseNotesLines?: number;
}

export default function UpdateAvailableInfo({
  version,
  releaseNotes,
  needsMigration,
  releaseNotesLines = 4,
}: UpdateAvailableInfoProps) {
  const { colors } = useTheme();

  return (
    <View>
      {/* ADR-0006：success 当文字走 successText 达标 */}
      <Text
        style={{
          ...textVariants.body,
          fontWeight: '600',
          color: colors.successText,
          marginBottom: spacing[2],
        }}
      >
        发现新版本 v{version}
      </Text>
      {releaseNotes ? (
        <Text
          numberOfLines={releaseNotesLines}
          style={{
            ...textVariants.settingsTertiary,
            color: colors.textSecondary,
            lineHeight: 20,
            marginBottom: spacing[3],
          }}
        >
          {releaseNotes}
        </Text>
      ) : null}
      {needsMigration ? (
        <Text
          style={{
            ...textVariants.settingsTertiary,
            color: colors.danger,
            lineHeight: 20,
            marginBottom: spacing[3],
          }}
        >
          注意：旧版本签名机制不同，若安装报「签名不一致/重复签名」，请先卸载旧版再安装本更新包
        </Text>
      ) : null}
    </View>
  );
}
