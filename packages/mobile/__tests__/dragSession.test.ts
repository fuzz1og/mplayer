import { describe, expect, it } from 'vitest';
import {
  allowsTerminationRequest, claimsOnTouchStart, createDragSession, createTouchSequenceGate,
  isVerticalDragClaim, shouldCaptureDrag,
} from '../gestures/dragSession';
import { DISMISS_POSITION_RATIO, DISMISS_PROJECT_RATIO } from '../theme/motion';

const SIZE = 800;
const SLOW = 500; // dt ≥ 100ms：速度样本被丢弃，落点即为位置本身，便于测阈值边界

/** 慢拖到某个位置（速度样本全部因 dt 越界丢弃 → 松手速度 0） */
function slowDragTo(target: number) {
  const s = createDragSession();
  s.grab();
  s.calibrate(0);
  s.move({ dy: 0, timestamp: 0, rubberbandSize: SIZE }); // 校准基准帧（首帧无速度样本）
  s.move({ dy: target, timestamp: SLOW, rubberbandSize: SIZE });
  return s;
}

describe('拖拽会话：抓取 / 校准（Fabric 异步回路）', () => {
  it('中途抓住进行中的动画：从呈现值接续，不回到 0 也不跳变', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(120); // 入场/退场动画当前呈现到 120px
    expect(s.move({ dy: 400, timestamp: 1000, rubberbandSize: SIZE })).toBe(120);
    expect(s.move({ dy: 500, timestamp: 1016, rubberbandSize: SIZE })).toBe(220);
  });

  it('基准未就绪（stopAnimation 回调未回）的 move 被丢弃，就绪后从首个 move 校准原点', () => {
    const s = createDragSession();
    s.grab();
    expect(s.move({ dy: 50, timestamp: 1000, rubberbandSize: SIZE })).toBeNull();
    s.calibrate(0);
    expect(s.move({ dy: 50, timestamp: 1016, rubberbandSize: SIZE })).toBe(0);
  });

  it('首帧校准：认领前累计的位移不参与跟手（防瞬移）', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    expect(s.move({ dy: 30, timestamp: 1000, rubberbandSize: SIZE })).toBe(0);
    expect(s.move({ dy: 60, timestamp: 1016, rubberbandSize: SIZE })).toBe(30);
  });
});

describe('拖拽会话：跟手位移与橡皮筋', () => {
  it('下拉 1:1 跟手（越界到面板之外也不设限）', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 0, rubberbandSize: SIZE });
    expect(s.move({ dy: 900, timestamp: SLOW, rubberbandSize: SIZE })).toBe(900);
  });

  it('上推越界走橡皮筋：跟随量小于线性外推，且维度越小阻力越强', () => {
    const at = (size: number) => {
      const s = createDragSession();
      s.grab();
      s.calibrate(0);
      s.move({ dy: 0, timestamp: 0, rubberbandSize: size });
      return s.move({ dy: -100, timestamp: SLOW, rubberbandSize: size })!;
    };
    expect(at(SIZE)).toBeLessThan(0);
    expect(Math.abs(at(SIZE))).toBeLessThan(100);
    expect(Math.abs(at(400))).toBeLessThan(Math.abs(at(SIZE)));
  });
});

describe('拖拽会话：自采样速度（EMA + 钳幅）', () => {
  it('首个速度样本直接播种，不与 0 做 EMA（否则起步半速）', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, rubberbandSize: SIZE });
    s.move({ dy: 40, timestamp: 1016, rubberbandSize: SIZE }); // 40px/16ms = 2500px/s
    expect(s.release(SIZE).velocity).toBe(2500);
  });

  it('后续样本按 0.6/0.4 平滑（速度衰减不突跳）', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, rubberbandSize: SIZE });
    s.move({ dy: 40, timestamp: 1016, rubberbandSize: SIZE }); // 播种 2500
    s.move({ dy: 40, timestamp: 1032, rubberbandSize: SIZE }); // 瞬时 0 → 2500×0.6 = 1500
    s.move({ dy: 40, timestamp: 1048, rubberbandSize: SIZE }); // → 1500×0.6 = 900
    expect(s.release(SIZE).velocity).toBe(900);
  });

  it('瞬时速度钳到 ±4000：否则一帧大跳会把天文速度灌给弹簧', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, rubberbandSize: SIZE });
    s.move({ dy: 200, timestamp: 1010, rubberbandSize: SIZE }); // 200px/10ms = 20000 → 钳 4000
    s.move({ dy: 200, timestamp: 1026, rubberbandSize: SIZE }); // 瞬时 0 → 4000×0.6 = 2400（未钳则 14400）
    expect(s.release(SIZE).velocity).toBe(2400);
  });

  it('dt<4ms 视为时间戳抖动：该样本丢弃，不污染速度估计', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, rubberbandSize: SIZE });
    s.move({ dy: 40, timestamp: 1002, rubberbandSize: SIZE }); // dt=2ms → 丢弃速度，位置照常跟手
    expect(s.release(SIZE)).toEqual({ dismiss: false, velocity: 0 });
  });

  it('dt≥100ms 说明中间断了帧：该样本丢弃', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, rubberbandSize: SIZE });
    s.move({ dy: 40, timestamp: 1200, rubberbandSize: SIZE }); // dt=200ms → 丢弃
    expect(s.release(SIZE).velocity).toBe(0);
  });
});

describe('拖拽会话：松手判决（动量投影 vs 面板比例）', () => {
  const threshold = SIZE * DISMISS_PROJECT_RATIO;

  it('阈值取自 motion 的 DISMISS_PROJECT_RATIO（唯一事实源，不是本地魔数）', () => {
    expect(slowDragTo(threshold - 1).release(SIZE)).toEqual({ dismiss: false, velocity: 0 });
    expect(slowDragTo(threshold).release(SIZE)).toEqual({ dismiss: true, velocity: 0 });
  });

  it('快甩：位移很小但速度够，投影落点照样越过阈值 → 判关', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, rubberbandSize: SIZE });
    s.move({ dy: 100, timestamp: 1016, rubberbandSize: SIZE }); // 高速（钳 4000 → 松手钳 3000）
    const verdict = s.release(SIZE);
    expect(verdict.dismiss).toBe(true);
    expect(verdict.velocity).toBe(3000);
    expect(100 + (verdict.velocity / 1000) * 499).toBeGreaterThanOrEqual(threshold);
  });

  it('慢拖半途：速度可忽略时落点即位置，回弹由调用点做弹簧', () => {
    const s = slowDragTo(threshold - 1);
    expect(s.release(SIZE).dismiss).toBe(false);
  });

  it('面板尺寸现取：同一手势在更矮的面板上更容易判关', () => {
    const s = slowDragTo(300);
    expect(s.release(1024).dismiss).toBe(false); // 1024 × 0.35 = 358 > 300
    expect(s.release(800).dismiss).toBe(true);   // 800 × 0.35 = 280 ≤ 300
  });
});

describe('拖拽会话：terminate 与跨会话无残留', () => {
  it('terminate（系统抢走手势）零速回弹，不继承速度也不判关', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, rubberbandSize: SIZE });
    s.move({ dy: 600, timestamp: 1016, rubberbandSize: SIZE }); // 高速下拉中
    expect(s.terminate()).toEqual({ dismiss: false, velocity: 0 });
  });

  it('抓取后一帧 move 都没收到就松手：绝不判关（不拿上一次手势的残留落点）', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(700); // 抓住正在退场的面板
    expect(s.release(SIZE)).toEqual({ dismiss: false, velocity: 0 });
  });

  it('跨会话无残留：上一次手势的落点不污染下一次', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, rubberbandSize: SIZE });
    s.move({ dy: 600, timestamp: 1016, rubberbandSize: SIZE });
    expect(s.release(SIZE).dismiss).toBe(true);

    // 第二次手势只在顶部轻轻下压一帧就松手：旧实现读上一次的 lastY=600 → 误判关闭
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 2000, rubberbandSize: SIZE });
    expect(s.release(SIZE)).toEqual({ dismiss: false, velocity: 0 });
  });
});
describe('认领判定：bubble 与 capture 开 / 关（真机 drop-claim 竞争）', () => {
  const T = 24;

  it('纵向意图：bubble 与 capture 都认领（拇指弧线纵向占优那一帧起认领）', () => {
    // 真机轨迹「先横后竖」：前几帧 |dy| 还不占优 → 都不认领；到 |dy|>|dx| 才认领
    expect(isVerticalDragClaim(132, 70, T)).toBe(false);
    expect(isVerticalDragClaim(102, 190, T)).toBe(true);
    expect(shouldCaptureDrag(102, 190, T, true)).toBe(true);
  });

  it('capture 关闭（歌词页）：绝不抢先认领，横向分页照常先接管', () => {
    expect(shouldCaptureDrag(0, 400, T, false)).toBe(false);
    expect(shouldCaptureDrag(102, 190, T, false)).toBe(false);
  });

  it('横向占优 / 未过阈值：两种阶段都不认领（Slider 横向拖动、ScalePress 点按不受影响）', () => {
    const cases: [number, number][] = [[120, 8], [200, 30], [40, 39], [0, 24], [0, 10]];
    for (const [dx, dy] of cases) {
      expect(isVerticalDragClaim(dx, dy, T)).toBe(false);
      expect(shouldCaptureDrag(dx, dy, T, true)).toBe(false);
    }
  });

  it('阈值严格大于：恰好等于阈值不认领（与旧实现逐字一致）', () => {
    expect(isVerticalDragClaim(0, 24, T)).toBe(false);
    expect(isVerticalDragClaim(0, 25, T)).toBe(true);
  });
});

describe('拖拽会话：判关基准 = 面板高度（底部弹层短面板）', () => {
  const SCREEN = 3840; // 真机整屏高度（橡皮筋维度）
  const SHEET = 700;   // 底部弹层实测面板高度

  /** 短面板上的慢拖：位置即落点（速度样本按 dt 越界丢弃） */
  function slowSheetDragTo(target: number) {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 0, rubberbandSize: SCREEN });
    s.move({ dy: target, timestamp: SLOW, rubberbandSize: SCREEN });
    return s;
  }

  it('低速整段下拉越过面板高度 1/3 → 判关（旧实现拿整屏当基准必然回弹）', () => {
    expect(slowSheetDragTo(SHEET * DISMISS_PROJECT_RATIO).release(SHEET))
      .toEqual({ dismiss: true, velocity: 0 });
  });

  it('未越过面板高度 1/3 → 回弹', () => {
    expect(slowSheetDragTo(SHEET * DISMISS_PROJECT_RATIO - 1).release(SHEET))
      .toEqual({ dismiss: false, velocity: 0 });
  });

  it('同一手势若仍拿整屏当判关基准 → 回弹（护栏：基准必须来自面板高度）', () => {
    const s = slowSheetDragTo(SHEET * DISMISS_PROJECT_RATIO);
    expect(s.release(SCREEN).dismiss).toBe(false);
  });

  it('橡皮筋维度与判关基准解耦：越界阻力只跟传入的橡皮筋维度走', () => {
    const at = (size: number) => {
      const s = createDragSession();
      s.grab();
      s.calibrate(0);
      s.move({ dy: 0, timestamp: 0, rubberbandSize: size });
      return s.move({ dy: -100, timestamp: SLOW, rubberbandSize: size })!;
    };
    // 维度越小阻力越强、跟随越少（同 rubberband 公式，与上面 SIZE/400 那条一致）
    expect(Math.abs(at(SHEET))).toBeLessThan(Math.abs(at(SCREEN)));
  });

  it('全屏面板行为不变：不传 dismissSize → 基准回退屏高，阈值仍是 0.35 屏高', () => {
    expect(slowDragTo(SIZE * DISMISS_PROJECT_RATIO).release(SIZE).dismiss).toBe(true);
    expect(slowDragTo(SIZE * DISMISS_PROJECT_RATIO - 1).release(SIZE)).toEqual({ dismiss: false, velocity: 0 });
  });
});
describe('拖拽会话：位置兜底判关（底部弹层，不依赖速度）', () => {
  const SHEET = 700; // 底部弹层面板高度
  const POS = DISMISS_POSITION_RATIO;

  /** 短面板上的慢拖：位置即落点（速度样本按 dt 越界丢弃 → vy = 0） */
  function slowSheetDragTo(target: number) {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 0, rubberbandSize: SIZE });
    s.move({ dy: target, timestamp: SLOW, rubberbandSize: SIZE });
    return s;
  }

  it('低速长拖越过判关线 → 判关（位置 0.4 与投影 0.35 取先到者，速度全程为 0）', () => {
    const verdict = slowSheetDragTo(SHEET * POS).release(SHEET, POS);
    expect(verdict).toEqual({ dismiss: true, velocity: 0 });
    expect(verdict.velocity).toBe(0); // 不依赖速度：速度样本全被丢弃也判关
  });

  it('低速长拖未过任一判关线（< 0.35 面板高度）→ 回弹', () => {
    expect(slowSheetDragTo(SHEET * DISMISS_PROJECT_RATIO - 1).release(SHEET, POS))
      .toEqual({ dismiss: false, velocity: 0 });
  });

  it('位置兜底独立于投影：拖过 0.4 面板高度后向上回甩，投影不足仍判关', () => {
    // 慢拖到 400（> 0.4 × 700 = 280），再在 16ms 内回甩到 300：
    // vy 被钳到 -3000 → 投影落点 300 - 1497 = -1197，远在 0.35 × 700 = 245 之下，
    // 只有位置判据（300 ≥ 280）能判关
    const pullBack = () => {
      const s = createDragSession();
      s.grab();
      s.calibrate(0);
      s.move({ dy: 0, timestamp: 0, rubberbandSize: SIZE });
      s.move({ dy: 400, timestamp: SLOW, rubberbandSize: SIZE });      // 慢拖到位（速度样本丢弃）
      s.move({ dy: 300, timestamp: SLOW + 16, rubberbandSize: SIZE }); // 回甩 → vy 钳到 -3000
      return s;
    };
    expect(pullBack().release(SHEET).dismiss).toBe(false);       // 不启用位置判据：投影不足 → 回弹
    expect(pullBack().release(SHEET, POS).dismiss).toBe(true);   // 位置判据兜住 → 判关
    expect(pullBack().release(SHEET, POS).velocity).toBe(-3000);
  });

  it('位置远未到线但快甩：投影判据照样判关（加分项保留）', () => {
    const s = createDragSession();
    s.grab();
    s.calibrate(0);
    s.move({ dy: 0, timestamp: 1000, rubberbandSize: SIZE });
    s.move({ dy: 100, timestamp: 1016, rubberbandSize: SIZE }); // 高速下拉
    expect(100).toBeLessThan(SHEET * POS); // 位置离 0.4 倍面板高度还远
    expect(s.release(SHEET, POS).dismiss).toBe(true);
  });

  it('全屏面板不传位置比例：拖过 0.4 后向上回甩仍回弹（原手感不变）', () => {
    // 拖到 400（0.5 × SIZE）再在 16ms 内回甩到 380：投影落点被拉回阈值之下
    const dragThenFlickUp = () => {
      const s = createDragSession();
      s.grab();
      s.calibrate(0);
      s.move({ dy: 0, timestamp: 0, rubberbandSize: SIZE });           // 校准基准帧
      s.move({ dy: 400, timestamp: SLOW, rubberbandSize: SIZE });      // 慢拖到位（速度样本丢弃）
      s.move({ dy: 380, timestamp: SLOW + 16, rubberbandSize: SIZE }); // 回甩 → vy = -1250px/s
      return s;
    };
    const noPositionRule = dragThenFlickUp().release(SIZE); // 全屏面板：不传 positionRatio
    expect(noPositionRule.dismiss).toBe(false);
    expect(noPositionRule.velocity).toBe(-1250);

    // 同一手势若开启位置兜底（面板 0.4 线 = 320 ≤ 380）→ 判关
    expect(dragThenFlickUp().release(SIZE, POS).dismiss).toBe(true);
  });
});

describe('认领总开关：弹层打开期间下层不被认领（连带关闭护栏）', () => {
  const T = 24;

  it('enabled=false 时 bubble 与 capture 都不认领', () => {
    expect(isVerticalDragClaim(0, 400, T, false)).toBe(false);
    expect(shouldCaptureDrag(0, 400, T, false)).toBe(false);
  });

  it('缺省 enabled=true：正常路径不受影响', () => {
    expect(isVerticalDragClaim(0, 400, T)).toBe(true);
    expect(isVerticalDragClaim(0, 400, T, true)).toBe(true);
  });
});
describe('触摸序列归属闸：Modal 卸载后的残余事件不认领（真机第三轮）', () => {
  it('本层收到 start（bubble 或 capture 任一阶段）→ 该序列可认领', () => {
    const g = createTouchSequenceGate();
    expect(g.allows(true)).toBe(false); // 尚未见到本层 DOWN
    g.begin();                          // onStartShouldSetPanResponder / …Capture
    expect(g.allows(true)).toBe(true);
  });

  it('未 begin（只挂 capture、而目标自身的 capture 不被调用）→ 不可认领', () => {
    // 真机第三轮根因：PanResponder 挂在触摸目标自身时 capture 阶段不触发；
    // 若只有 capture 一条路径置位，序列归属恒为 false → 认领被全拒、把手拖不动
    const g = createTouchSequenceGate();
    expect(g.allows(true)).toBe(false);
  });

  it('Modal 卸载后漏到本层的残余 move（DOWN 落在别层）→ 不认领', () => {
    const g = createTouchSequenceGate();
    expect(g.allows(true)).toBe(false);  // 本层只收到 move/release，没有本层 DOWN
    expect(g.allows(false)).toBe(false);
  });

  it('调用点总开关关闭（弹层打开期间）→ 即使本层见过 DOWN 也不认领', () => {
    const g = createTouchSequenceGate();
    g.begin();
    expect(g.allows(false)).toBe(false);
  });

  it('序列结束（release/terminate）后回到未认领，等下一次本层 DOWN', () => {
    const g = createTouchSequenceGate();
    g.begin();
    g.end();
    expect(g.allows(true)).toBe(false);
    g.begin();
    expect(g.allows(true)).toBe(true);
  });

  it('bubble 与 capture 都置位时幂等', () => {
    const g = createTouchSequenceGate();
    g.begin();
    g.begin();
    expect(g.allows(true)).toBe(true);
    g.end();
    expect(g.allows(true)).toBe(false);
  });
});
describe('认领模式：Modal 内必须「触摸开始即认领」（RN#14295 + 官方 responder 语义）', () => {
  it("'start' 模式（BottomSheet 把手，挂在 Modal 内）：DOWN 即成响应者", () => {
    expect(claimsOnTouchStart('start')).toBe(true);
  });

  it("'start' 模式拒绝让出响应者（否则 Modal/Dialog 拖动途中抢走）", () => {
    expect(allowsTerminationRequest('start')).toBe(false);
  });

  it("'move' 模式（全屏播放器根节点）：start 不认领、允许让出——点按与横向滑动不被抢", () => {
    expect(claimsOnTouchStart('move')).toBe(false);
    expect(allowsTerminationRequest('move')).toBe(true);
  });

  it("'start' 模式 grant 即 owned：序列归属置位后 move 兜底判定可用", () => {
    const g = createTouchSequenceGate();
    g.begin(); // onStartShouldSetPanResponder / onPanResponderGrant
    expect(g.allows(true)).toBe(true);
    expect(isVerticalDragClaim(0, 100, 10, g.allows(true))).toBe(true); // 竖直 move 进入会话
    expect(isVerticalDragClaim(0, 5, 10, g.allows(true))).toBe(false);  // 未过阈值的抖动不认领
  });

  it('兜底语义不变：Modal 外（全屏播放器）仍按 move 阈值认领', () => {
    expect(isVerticalDragClaim(0, 100, 24)).toBe(true);
    expect(isVerticalDragClaim(0, 12, 24)).toBe(false);
  });
});
