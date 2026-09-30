import { View, Text, Switch } from 'react-native';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSettingsStyles } from './settingsStyles';

/**
 * 开发者模式开关（#477 B 方案第一片）：**显式开关，不是连点手势**。
 *
 * 本区段只做一件事——开关本身，且**常驻可见**（若开关也藏在开关后面，用户就永远打不开）。
 * 开关之后的诊断内容（日志 + 播放诊断）由 app/settings.tsx 按 `devMode` 条件渲染，
 * 即「诊断内容默认不出现」的那道门。状态落 settingsStore（AsyncStorage persist），跨重启保持。
 */
export default function DeveloperModeSection() {
  const styles = useSettingsStyles();
  const devMode = useSettingsStore((s) => s.devMode);
  const setDevMode = useSettingsStore((s) => s.setDevMode);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>开发者选项</Text>
      <View style={styles.group}>
        <View style={styles.rowSwitch}>
          <Text style={[styles.modeLabel, { flex: 1 }]}>开发者模式</Text>
          <View style={styles.switchWrap}>
            <Switch value={devMode} onValueChange={setDevMode} style={styles.switch} />
          </View>
        </View>
      </View>
      <Text style={styles.sectionFootnote}>
        打开后设置页显示应用内日志与播放诊断；关闭时不记录详细日志，但警告与错误仍照常保留，用户可见提示不受影响。
      </Text>
    </View>
  );
}
