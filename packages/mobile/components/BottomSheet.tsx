import { useMemo, useRef } from 'react';
import { Modal, View, StyleSheet, PanResponder, Animated, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { springs, projectMomentum, rubberband } from '../theme/motion';
import { useReducedMotion } from '../hooks/useReducedMotion';

/** 下滑投影超过面板高此比例即关闭 */
const DISMISS_PROJECT_RATIO = 0.35;

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
 * 底部弹层壳（ADR-0007）：统一解剖——把手 + radius.sheet + 底部安全区 padding，
 * 并内置可中断拖拽关闭（复用 PlayerOverlay 的 motion 物理：1:1 跟手 → 速度继承
 * → 动量投影 → 橡皮筋 → 落点判定）。iOS HIG 中 sheet 默认下滑关闭。
 *
 * 替换 TopBar 来源选择 / PlayerBar 队列 / SongRow 操作面板 / SourceSwapModal /
 * AddToPlaylistModal 五处散落自绘弹层。标题由各弹层自行在 children 内渲染。
 */
export default function BottomSheet({
  visible, onClose, radiusTop = radius.sheet, maxHeightRatio = 0.7, style, children,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // 拖拽物理（复用 PlayerOverlay 手法）：可中断、跟手、速度继承、动量投影、橡皮筋
  const translateY = useRef(new Animated.Value(0)).current;
  const dragStart = useRef(0);
  const lastY = useRef(0);
  const gestureBaseDy = useRef<number | null>(null);

  const dismiss = (velocityY = 0) => {
    if (reducedMotion) {
      onClose();
      return;
    }
    Animated.spring(translateY, {
      toValue: 600,
      velocity: velocityY,
      useNativeDriver: true,
      ...springs.sheet,
    }).start(({ finished }) => { if (finished) onClose(); });
  };
  const snapBack = (velocityY = 0) => {
    Animated.spring(translateY, {
      toValue: 0,
      velocity: velocityY,
      useNativeDriver: true,
      ...springs.sheet,
    }).start();
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 12 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderGrant: () => {
        translateY.stopAnimation((v) => { dragStart.current = v; });
        gestureBaseDy.current = null;
      },
      onPanResponderMove: (_, gs) => {
        if (gestureBaseDy.current === null) gestureBaseDy.current = gs.dy;
        const raw = dragStart.current + (gs.dy - gestureBaseDy.current);
        const next = raw > 0 ? raw : rubberband(raw, 600);
        lastY.current = next;
        translateY.setValue(next);
      },
      onPanResponderRelease: (_, gs) => {
        const vy = gs.vy * 1000;
        const projected = lastY.current + projectMomentum(vy);
        if (projected >= 600 * DISMISS_PROJECT_RATIO) dismiss(vy);
        else snapBack(vy);
      },
      onPanResponderTerminate: () => snapBack(),
    })
  ).current;

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
        <Animated.View
          style={[
            styles.sheet,
            { borderTopLeftRadius: radiusTop, borderTopRightRadius: radiusTop, maxHeight: `${maxHeightRatio * 100}%`, paddingBottom: Math.max(insets.bottom, spacing[4]) + spacing[3] },
            { transform: [{ translateY }] },
            style,
          ]}
          {...panResponder.panHandlers}
        >
          <View style={styles.handle} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colors.bgOverlay,
    justifyContent: 'flex-end',
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
