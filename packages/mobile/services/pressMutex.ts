/**
 * 嵌套按压互斥（#304）：行内按钮（收藏 / 更多）按下时同步认领，行自身的
 * onPress 读到认领即忽略。
 *
 * 旧实现是行内 `pressingAction` state + `setTimeout(…, 100)`：行 onPress
 * 读的是上一次渲染闭包里的值，内层 setState 尚未提交重渲染时（JS 线程忙）
 * 会漏判——点收藏 / 更多顺带播歌。这里改为同步 ref 判定，不再依赖渲染时序。
 *
 * 与 PlayerBar 的 e.stopPropagation() 纪律互补：stopPropagation 拦事件派发，
 * 本原语兜底「事件已派发行」的情况；认领在窗口期后自动释放，避免吞掉下一次
 * 真实行点击。定时器只此一份实现（node 可测），行内不再各写 setTimeout。
 */

export interface PressMutex {
  /** 内层按钮按下：认领这次手势（同步生效，不依赖重渲染） */
  claimInner(): void;
  /** 行 onPress 入口：true = 本次行按压属于内层按钮，应忽略并解除认领 */
  consumeRowPress(): boolean;
  /** 卸载清理：释放未到期的认领定时器 */
  dispose(): void;
}

export function createPressMutex(windowMs = 100): PressMutex {
  let claimed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const release = () => {
    claimed = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    claimInner() {
      claimed = true;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(release, windowMs);
    },
    consumeRowPress() {
      if (!claimed) return false;
      release();
      return true;
    },
    dispose: release,
  };
}
