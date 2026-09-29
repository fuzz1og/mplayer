import { View, Text } from 'react-native';
import Constants from 'expo-constants';
import { useSettingsStyles } from './settingsStyles';
import UpdateSection from './UpdateSection';

/**
 * 「关于」区段（检查更新，版本号作节内首行）。自治组件：只读版本号（expo-constants），
 * 不订阅 store；更新相关的全部局部状态（通道展开/测速/检查）在 UpdateSection 内，二者同属一张卡片，
 * 渲染结构与拆段前逐行一致（#425：行为与视觉零变化）。
 */
export default function AboutSection() {
  const styles = useSettingsStyles();
  const currentVersion = Constants.expoConfig?.version || '0.0.0';

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>关于</Text>
      <View style={styles.group}>
        <View style={styles.row}>
          <Text style={styles.modeLabel}>当前版本</Text>
          <Text style={styles.modeStatus}>v{currentVersion}</Text>
        </View>
        <UpdateSection />
      </View>
    </View>
  );
}
