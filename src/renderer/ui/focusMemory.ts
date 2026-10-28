/**
 * 焦点记忆：菜单 / 弹窗会把焦点收进自己内部，关闭时若触发元素已随菜单卸载，
 * 就回落到「打开前最后一个稳定焦点」，避免键盘用户掉到 body。
 */
let lastStable: HTMLElement | null = null;

const isTransient = (el: HTMLElement): boolean => Boolean(el.closest('[role="menu"], [role="dialog"], dialog'));

if (typeof document !== 'undefined') {
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (isTransient(target)) return;
    lastStable = target;
  }, true);
}

export function getLastStableFocus(): HTMLElement | null {
  return lastStable && lastStable.isConnected ? lastStable : null;
}
