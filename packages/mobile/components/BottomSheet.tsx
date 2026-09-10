import { useEffect, useRef, useState } from 'react';
import {
  Modal, View, StyleSheet, Pressable, Animated,
  useWindowDimensions,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, spacing } from '../theme/tokens';
import type { ThemeColors } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { springs } from '../theme/motion';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useDragToDismiss } from '../hooks/useDragToDismiss';

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
 * 底部弹层（ADR-0007 v3）：iOS 形态的分层动效 + 把手区拖拽关闭。
 *
 * - 遮罩不再跟着面板一起滑：旧版 `animationType="slide"` 会把整棵 Modal 内容
 *   （含遮罩底色）一起从底部滑上来；现在原生 slide 关掉，遮罩用短 timing 淡入、
 *   面板用 springs.sheet 弹簧上滑，两者 parallel 但节奏天然分层。
 * - 拖拽只挂在把手区（grabberZone），面板内容区零接管——#186 教训：整面板挂手势
 *   会点内容误关、与 FlatList 抢滚动；把手区物理与 PlayerOverlay 共用同一份实现
 *   （gestures/dragSession + hooks/useDragToDismiss：可中断抓取 / 首帧原点校准 /
 *   自采样速度 EMA+钳幅 / 动量投影阈值 / terminate 回弹），此处只声明认领阈值与
 *   判关基准（面板自身高度，onLayout 量取）。
 * - 关闭统一走「先播退场动画、finished 后再调 onClose」——父组件 visible=false
 *   会立即卸载 Modal，必须让动画先走完（PlayerOverlay dismiss 同款约束）；
 *   外部直接把 visible 置 false 的路径也会补播退场再卸载，观感一致。
 * - 减弱动效（useReducedMotion）：无大位移，遮罩+面板 200ms 交叉淡化。
 */
export default function BottomSheet({
  visible, onClose, radiusTop = radius.sheet, maxHeightRatio = DEFAULT_MAX_HEIGHT, style, children,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const styles = makeStyles(colors);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // visible 翻 true 才挂载 Modal；内部拖拽关闭播完退场后先自隐藏，等父级 visible=false 卸载
  const [mounted, setMounted] = useState(visible);
  const mountedRef = useRef(mounted);
  mountedRef.current = mounted;
  const exitingRef = useRef(false);

  // 判关基准 = 面板自身高度（真机 review）：短面板（如「更多」面板 ~700px）若拿整屏
  // 高度当基准，正常速度的整段下拉投影也够不到 0.35×屏高，必然回弹。onLayout 量真实
  // 高度，首帧未量到前回退 winH（≈ master 行为，不会更差）
  const [sheetHeight, setSheetHeight] = useState(winH);
  const translateY = useRef(new Animated.Value(winH)).current;
  const maskOpacity = useRef(new Animated.Value(0)).current;
  const panelOpacity = useRef(new Animated.Value(1)).current;

  // ── 进场：mounted 且可见后跑一次（原生 slide 关掉，动效全在此编排）──
  useEffect(() => {
    if (!mounted) return;
    translateY.stopAnimation();
    maskOpacity.stopAnimation();
    panelOpacity.stopAnimation();
    if (reducedMotion) {
      translateY.setValue(0);
      panelOpacity.setValue(1);
      maskOpacity.setValue(0);
      const fade = Animated.timing(maskOpacity, { toValue: 1, duration: 200, useNativeDriver: true });
      fade.start();
      return () => fade.stop();
    }
    translateY.setValue(winH);
    maskOpacity.setValue(0);
    panelOpacity.setValue(1);
    const anim = Animated.parallel([
      Animated.timing(maskOpacity, { toValue: 1, duration: 180, useNativeDriver: true }), // 遮罩立即淡入到位
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, ...springs.sheet }), // 面板随后弹上
    ]);
    anim.start();
    return () => anim.stop();
    // 注：winH 变化（旋转）不重播进场——只以 mounted/reducedMotion 为准
  }, [mounted, reducedMotion]);

  /** 播退场动画；finished 后回调（onClose 或卸载）。减弱动效为整体 200ms 交叉淡化 */
  const playExit = (velocityY = 0, after?: () => void) => {
    translateY.stopAnimation();
    maskOpacity.stopAnimation();
    panelOpacity.stopAnimation();
    const done = () => { exitingRef.current = true; after?.(); };
    if (reducedMotion) {
      Animated.parallel([
        Animated.timing(maskOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(panelOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) done(); });
      return;
    }
    Animated.parallel([
      Animated.timing(maskOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.spring(translateY, {
        toValue: winH,
        velocity: velocityY, // 继承松手速度，无匀速刹车感
        useNativeDriver: true,
        ...springs.sheet,
      }),
    ]).start(({ finished }) => { if (finished) done(); });
  };

  // ── visible 编排：开 → 挂载进场；关 → 补播退场再卸载 ──
  const playExitRef = useRef(playExit);
  playExitRef.current = playExit;
  useEffect(() => {
    if (visible) {
      exitingRef.current = false;
      setMounted(true);
    } else if (mountedRef.current && !exitingRef.current) {
      // 外部直接置 false（如各弹层自己的 X 按钮）：补播退场保持观感一致
      playExitRef.current(0, () => setMounted(false));
    } else if (mountedRef.current) {
      setMounted(false); // 内部拖拽关闭已播完退场：直接卸载
    }
  }, [visible]);

  const requestClose = (velocityY = 0) => playExit(velocityY, () => onCloseRef.current());

  // ── 把手区拖拽关闭：仅 grabberZone 接管，物理在 gestures/dragSession（与 PlayerOverlay 共用）──
  const panHandlers = useDragToDismiss({
    value: translateY,
    rubberbandSize: winH, // 上推越界的阻尼维度：仍按整屏算，手感与 master 一致
    dismissSize: sheetHeight, // 判关基准：面板自身高度（0.35 的语义 = 投影超过面板 1/3）
    // 10 = 把手热区的认领阈值（PlayerOverlay 全屏面板用 24）：热区总高仅 ~28px，
    // 阈值放宽到 10 手感更跟手
    claimThreshold: 10,
    onDismiss: requestClose, // 快甩/过半 → 先播退场、finished 后再通知父级
    // 未判关 / 系统抢走手势 → 弹簧回弹到 0，release 继承松手速度，terminate 走零速兜底
    onSnapBack: (vy) => {
      Animated.spring(translateY, { toValue: 0, velocity: vy, useNativeDriver: true, ...springs.sheet }).start();
    },
  });

  if (!mounted) return null;

  return (
    <Modal
      transparent
      animationType="none" // 原生 slide 关掉：遮罩/面板分层动效在 JS 侧编排
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={() => requestClose()}
    >
      <View style={styles.overlay} pointerEvents="box-none">
        {/* 独立遮罩层：绝对铺满、opacity 动画——立即出现，不再跟面板一起滑 */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: maskOpacity }]} pointerEvents="box-none">
          {/* 点按拦截器：无动画语义（Pressable），遮罩不应有按压反馈 */}
          <Pressable style={styles.maskFill} onPress={() => requestClose()} />
        </Animated.View>
        {/* 弹性空白区把面板压到底部；pointerEvents=none 让触摸穿透到下方遮罩
            （RN 命中测试不跨兄弟节点，无此属性遮罩点按会失效） */}
        <View style={styles.spacer} pointerEvents="none" />
        <Animated.View
          // 量面板真实高度喂判关基准；亚像素抖动不回写，避免无谓重渲染
          onLayout={(e) => setSheetHeight((prev) => {
            const h = e.nativeEvent.layout.height;
            return Math.abs(prev - h) < 1 ? prev : h;
          })}
          style={[
            styles.sheetWrap,
            {
              opacity: panelOpacity,
              transform: [{ translateY }],
              borderTopLeftRadius: radiusTop,
              borderTopRightRadius: radiusTop,
              maxHeight: `${maxHeightRatio * 100}%`,
              paddingBottom: Math.max(insets.bottom, spacing[4]) + spacing[3],
            },
            style,
          ]}
        >
          {/* 把手 + 可拖拽热区（真机反馈 #c：按住把手可下拉关闭，iOS 式） */}
          <View style={styles.grabberZone} {...panHandlers}>
            <View style={styles.handle} />
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  maskFill: {
    flex: 1,
    backgroundColor: colors.bgOverlay, // 遮罩底色独立在本层，opacity 随之淡入淡出
  },
  spacer: {
    flex: 1,
  },
  sheetWrap: {
    backgroundColor: colors.bgSurface,
    paddingHorizontal: spacing[5],
  },
  // 把手拖拽热区：把手上下各留 ~12px 命中范围（总高 ~28，iOS grabber 手感）
  grabberZone: {
    alignItems: 'center',
    paddingTop: spacing[2] + 2,
    paddingBottom: spacing[2],
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgActive,
  },
});
