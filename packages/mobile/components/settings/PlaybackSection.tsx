import { View, Text, Switch } from 'react-native';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSettingsStyles } from './settingsStyles';

/**
 * 播放区段（#385「失败即跳」）。自治组件：只订阅 autoSkipOnError；
 * 决策与文案来自 core skipGuard，双端同语义。
 */
export default function PlaybackSection() {
  const styles = useSettingsStyles();
  const autoSkipOnError = useSettingsStore((s) => s.autoSkipOnError);
  const setAutoSkipOnError = useSettingsStore((s) => s.setAutoSkipOnError);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>播放</Text>
      <View style={styles.group}>
        <View style={styles.rowSwitch}>
          <Text style={[styles.modeLabel, { flex: 1 }]}>失败即跳</Text>
          <View style={styles.switchWrap}>
            <Switch value={autoSkipOnError} onValueChange={setAutoSkipOnError} style={styles.switch} />
          </View>
        </View>
      </View>
      <Text style={styles.sectionFootnote}>播放失败时自动跳到下一首；关闭后失败即暂停等你处理。</Text>
    </View>
  );
}
