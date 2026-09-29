import { View, Text } from 'react-native';
import { MULTI_SOURCE_LIST, SOURCE_DISPLAY_NAMES, hasDirectClient } from '@mplayer/core';
import { useSettingsStyles } from './settingsStyles';

/**
 * 直连状态区段（T01：每源官方直连可用性；不再配置 auto/仅直连）。
 * 只读 core 的静态能力表，无本地状态、无 store 订阅。
 */
export default function DirectStatusSection() {
  const styles = useSettingsStyles();

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>直连状态</Text>
      <View style={styles.group}>
        {MULTI_SOURCE_LIST.map((source, i) => {
          const ready = hasDirectClient(source);
          return (
            <View key={source} style={[styles.row, i > 0 && styles.rowSep]}>
              <View style={[styles.statusDot, ready && styles.statusDotReady]} />
              <Text style={styles.modeLabel}>{SOURCE_DISPLAY_NAMES[source] || source}</Text>
              <Text style={[styles.modeStatus, ready && styles.modeStatusReady]}>
                {ready ? '直连可用' : '直连未实现'}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
