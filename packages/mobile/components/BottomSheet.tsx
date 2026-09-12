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
import { DISMISS_POSITION_RATIO, springs } from '../theme/motion';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useDragToDismiss } from '../hooks/useDragToDismiss';
import { handlePanelLayout } from './panelHeight';
import { createSheetExitLatch } from '../services/sheetExit';

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
 * - 退场闩（services/sheetExit.ts，#308 真机回归）：退场动画播放期间遮罩仍在接
 *   点击（Android 上 Modal 窗口是模态的，触摸不穿透下层），旧实现每点一次就重播
 *   一次退场 → Modal 寿命被点击无限拉长，表现为「关掉面板后点下一行『更多』要点
 *   两下」。现在只认第一次关闭请求，且面板一离屏就落定（不等弹簧在屏外收尾），
 *   把"点击被吞"的窗口压到最短。
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
  /** 退场闩：退场中的重复关闭请求一律忽略（见 services/sheetExit.ts） */
  const exitLatch = useRef(createSheetExitLatch()).current;
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

  /** 播退场动画；退场结束（面板离屏 + 遮罩淡出）后回调（onClose 或卸载）。
   *  减弱动效为整体 200ms 交叉淡化。*/
  const playExit = (velocityY = 0, after?: () => void) => {
    // 退场闩：退场中的重复关闭请求（遮罩在动画期间仍会被点到）一律忽略，
    // 否则每次点击都重播退场动画，Modal 寿命被无限拉长（#308 真机回归）
    if (!exitLatch.beginClose()) return;
    translateY.stopAnimation();
    maskOpacity.stopAnimation();
    panelOpacity.stopAnimation();
    // 离屏判据 = 面板自身高度（sheetHeight 首帧即 winH，量到后是真实高度）
    const offscreenAt = sheetHeight;
    let listenerId: string | null = null;
    const finish = () => {
      if (!exitLatch.settle()) return;
      if (listenerId !== null) {
        translateY.removeListener(listenerId);
        listenerId = null;
      }
      translateY.stopAnimation();
      maskOpacity.stopAnimation();
      panelOpacity.stopAnimation();
      exitingRef.current = true;
      after?.();
    };
    if (reducedMotion) {
      Animated.parallel([
        Animated.timing(maskOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
        Animated.timing(panelOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) finish(); });
      return;
    }
    // 面板一离屏即记账：弹簧在屏外收尾的那段时间里，Modal 仍然会吃掉点击
    listenerId = translateY.addListener(({ value }) => {
      if (value >= offscreenAt && exitLatch.markPanelOffscreen()) finish();
    });
    Animated.timing(maskOpacity, { toValue: 0, duration: 200, useNativeDriver: true })
      .start(() => { if (exitLatch.markMaskFaded()) finish(); });
    Animated.spring(translateY, {
      toValue: winH,
      velocity: velocityY, // 继承松手速度，无匀速刹车感
      useNativeDriver: true,
      ...springs.sheet,
    }).start(({ finished }) => { if (finished) finish(); });
  };

  // ── visible 编排：开 → 挂载进场；关 → 补播退场再卸载 ──
  const playExitRef = useRef(playExit);
  playExitRef.current = playExit;
  useEffect(() => {
    if (visible) {
      exitingRef.current = false;
      exitLatch.reopen(); // 新一轮开合：复位退场闩
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
    // 位置兜底（真机第二轮）：中低速长拖不该因为速度自采样偏低而回弹——
    // 拖过面板高度 0.4 即判关，投影判据仍是「快甩更容易关」的加分项
    positionRatio: DISMISS_POSITION_RATIO,
    // 认领模式 = 触摸 DOWN 即成为响应者（RN#14295：Modal 内 onMoveShouldSetPanResponder
    // 根本不触发，只靠 move 认领在 Modal 里不可靠）。同时拒绝让出响应者，防 Modal/Dialog
    // 在拖动途中抢走——这是 Modal 内把手拖拽的标准修法
    claimMode: 'start',
    // 10 = 把手热区的认领阈值（PlayerOverlay 全屏面板用 24）：只作 'start' 模式下的 move 兜底
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
          // 量面板真实高度喂判关基准：取值必须在 handler 内同步完成（事件对象会被回收，
          // 写进 updater 里就是真机 Render Error），纪律钉在 handlePanelLayout 内
          onLayout={(e) => handlePanelLayout(setSheetHeight, e)}
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
          {/* 把手 + 可拖拽热区（真机反馈 #c：按住把手可下拉关闭，iOS 式）。
              命中区对齐 Apple HIG：热区 48dp（HIG 建议 ≥44pt）+ hitSlop 上下各 8dp 外扩
              （HIG Accessibility：无边框元素周围约 24pt 内边距）；RN 的 hitSlop 会真实扩大
              原生命中矩形且不影响兄弟节点（遮罩）。依据见
              docs/agents/mobile-bottom-sheet-drag-research.md */}
          <View style={styles.grabberZone} hitSlop={{ top: 8, bottom: 8 }} {...panHandlers}>
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
  // 把手拖拽热区：48dp 命中区（Apple HIG 建议 ≥44pt；真机第三轮原总高仅 22dp，
  // 命中率低是「拉不到把手」体感的一部分；研究结论见
  // docs/agents/mobile-bottom-sheet-drag-research.md）。JSX 侧再叠 hitSlop 上下各 8dp。
  // 视觉不变——handle 仍 4dp、在热区内居中，多出来的是透明命中范围
  grabberZone: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: spacing[12], // 48dp（token 体系已有 48 档，与 desktop --space-* 同网格）
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
