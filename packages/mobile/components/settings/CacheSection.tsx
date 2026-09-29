import { useState, useEffect } from 'react';
import { View, Text, Alert } from 'react-native';
import { Trash2 } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { cacheKernel, getCacheStats } from '../../services/cacheService';
import { useTheme } from '../../theme/ThemeProvider';
import ScalePress from '../ScalePress';
import { useSettingsStyles } from './settingsStyles';

/** 缓存占用条上限（对齐桌面 CacheSection 的 100MB 口径） */
const MAX_CACHE_MB = 100;

/**
 * 缓存管理区段：统计 + 用量条 + 一键清理（对齐桌面 CacheSection）。
 * 自治组件：自持 cacheStats 与清理副作用（含旧版 AsyncStorage 残留清理）。
 */
export default function CacheSection() {
  const { colors } = useTheme();
  const styles = useSettingsStyles();

  // 缓存统计（进入页面加载一次，清理后刷新）
  const [cacheStats, setCacheStats] = useState({ fileCount: 0, totalSize: 0 });
  useEffect(() => {
    let cancelled = false;
    getCacheStats().then((s) => { if (!cancelled) setCacheStats(s); });
    return () => { cancelled = true; };
  }, []);

  const handleClearCache = async () => {
    await cacheKernel.clear();
    // 清理旧版 AsyncStorage songUrl: 缓存残留（已迁移到 cacheKernel）
    try {
      const keys = await AsyncStorage.getAllKeys();
      const stale = keys.filter((k) => k.startsWith('songUrl:'));
      if (stale.length > 0) await AsyncStorage.multiRemove(stale);
    } catch { /* 忽略残留清理失败 */ }
    setCacheStats(await getCacheStats());
    Alert.alert('提示', '缓存已清理');
  };

  const cachePercent = Math.min((cacheStats.totalSize / (MAX_CACHE_MB * 1024 * 1024)) * 100, 100);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>缓存管理</Text>
      <View style={styles.group}>
        <View style={styles.groupPad}>
          <Text style={styles.cacheStatsText}>
            缓存文件 {cacheStats.fileCount} 个 · {(cacheStats.totalSize / 1024 / 1024).toFixed(1)} MB / {MAX_CACHE_MB} MB
          </Text>
          <View style={styles.cacheBarWrap}>
            <View
              style={[
                styles.cacheBarFill,
                { width: `${cachePercent}%`, backgroundColor: cachePercent > 90 ? colors.danger : colors.accent },
              ]}
            />
          </View>
        </View>
        <ScalePress style={[styles.actionRow, styles.rowSep]} onPress={handleClearCache}>
          <Trash2 size={18} color={colors.accent} style={styles.btnIcon} />
          <Text style={styles.actionRowText}>清理缓存</Text>
        </ScalePress>
      </View>
      <Text style={styles.sectionFootnote}>播放 URL 缓存 12 小时过期，清理不影响已收藏歌曲</Text>
    </View>
  );
}
