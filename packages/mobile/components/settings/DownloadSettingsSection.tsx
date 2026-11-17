import { View, Text, Alert } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Paths } from 'expo-file-system';
import { useSettingsStore } from '../../stores/settingsStore';
import { pickDownloadDirectory } from '../../services/downloadService';
import { useTheme } from '../../theme/ThemeProvider';
import ScalePress from '../ScalePress';
import { useSettingsStyles } from './settingsStyles';

/**
 * 下载区段：本地歌曲页从底部 tab 移入歌单后，保存位置在这里统一管理。
 */
export default function DownloadSettingsSection() {
  const { colors } = useTheme();
  const styles = useSettingsStyles();
  const downloadDirUri = useSettingsStore((s) => s.downloadDirUri);
  const authorized = Boolean(downloadDirUri);

  const handlePick = async () => {
    try {
      await pickDownloadDirectory();
    } catch (e) {
      Alert.alert('选择目录失败', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>下载</Text>
      <View style={styles.group}>
        <ScalePress
          style={styles.row}
          onPress={handlePick}
          accessibilityLabel="选择本地歌曲保存位置"
          accessibilityHint="打开系统目录选择器"
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.modeLabel}>保存位置</Text>
            <Text style={styles.modeStatus}>
              {authorized ? '系统下载目录（已授权）' : '应用私有目录'}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.textTertiary} />
        </ScalePress>
      </View>
      <Text style={styles.sectionFootnote}>
        {authorized
          ? '点击可更换目录'
          : `${Paths.document.uri}mplayer-downloads/ · 点击选择系统下载目录`}
      </Text>
    </View>
  );
}
