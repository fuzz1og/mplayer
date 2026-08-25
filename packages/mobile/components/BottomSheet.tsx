import { Modal, View, StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';

/** 面板内容最大高度占屏比 */
const DEFAULT_MAX_HEIGHT = 0.7;

interface Props {
  visible: boolean;
  onClose: () => void;
  /** 圆角：默认 radius.sheet（12，对齐 iOS sheet 解剖，ADR-0007） */
  radiusTop?: number;
  /** 面板内容最大高度占屏比 */
  maxHeightRatio?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * 底部弹层（ADR-0007 重构版）：稳定优先——砍掉拖拽手势。
 * 真机反馈（#186 验证）：手势版 PanResponder 在 Android 不可靠（点面板内容误关、
 * 下滑失灵），改为纯 Modal：mask 与面板为 flex 兄弟层，面板区域物理不接触遮罩，
 * 点面板内容永不误关；点遮罩 / Android 返回键关闭；入场走系统 slide。
 * 把手保留为视觉指示（iOS sheet 解剖），关闭由遮罩/X 按钮承担。
 */
export default function BottomSheet({
  visible, onClose, radiusTop = radius.sheet, maxHeightRatio = DEFAULT_MAX_HEIGHT, style, children,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        {/* 遮罩：面板上方的弹性区（flex 兄弟，不覆盖面板），点击关闭 */}
        <TouchableOpacity style={styles.mask} activeOpacity={1} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              borderTopLeftRadius: radiusTop,
              borderTopRightRadius: radiusTop,
              maxHeight: `${maxHeightRatio * 100}%`,
              paddingBottom: Math.max(insets.bottom, spacing[4]) + spacing[3],
            },
            style,
          ]}
        >
          <View style={styles.handle} />
          {children}
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.bgOverlay,
  },
  // 遮罩：面板上方的弹性空白区，不覆盖面板（面板在下方兄弟节点）
  mask: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.bgSurface,
    paddingHorizontal: spacing[5],
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgActive,
    alignSelf: 'center',
    marginTop: spacing[2],
    marginBottom: spacing[2],
  },
});
