/**
 * 这个闩把语义定死：- `beginClose()` 只有第一次返回 true，退场中的重复请求一律忽略（不重启动画）；-
 * 退场结束条件 = 面板已离屏 **且** 遮罩已淡出，两个信号先到先记账，齐了才 `settle()`，且落定幂等（
 * 动画回调与离屏监听可能都触发）；- `reopen()` 复位，下一次开合不受上一轮影响。
 */
export interface SheetExitLatch {
  /** 请求关闭：true = 本次接管退场；false = 已在退场中，调用方必须忽略 */
  beginClose(): boolean;
  /** 是否处于退场中（含动画播放期间） */
  isClosing(): boolean;
  /** 面板已离屏；true = 两个结束条件都齐了 */
  markPanelOffscreen(): boolean;
  /** 遮罩已淡出；true = 两个结束条件都齐了 */
  markMaskFaded(): boolean;
  /** 落定退场：true = 首次落定（幂等） */
  settle(): boolean;
  /** 重新打开：复位闩 */
  reopen(): void;
}

export function createSheetExitLatch(): SheetExitLatch {
  let closing = false;
  let settled = false;
  let panelOffscreen = false;
  let maskFaded = false;
  let ready = false;

  /** 两个结束条件齐了、且本轮还没报过「就绪」 */
  const reportReady = () => {
    if (ready || !closing || !panelOffscreen || !maskFaded) return false;
    ready = true;
    return true;
  };

  const reset = () => {
    settled = false;
    panelOffscreen = false;
    maskFaded = false;
    ready = false;
  };

  return {
    beginClose() {
      if (closing) return false;
      closing = true;
      reset();
      return true;
    },
    isClosing: () => closing,
    markPanelOffscreen() {
      panelOffscreen = true;
      return reportReady();
    },
    markMaskFaded() {
      maskFaded = true;
      return reportReady();
    },
    settle() {
      if (settled) return false;
      settled = true;
      return true;
    },
    reopen() {
      closing = false;
      reset();
    },
  };
}
