import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * 系统「减弱透明度」状态（iOS）：`isReduceTransparencyEnabled` 是**异步** API
 * （返回 Promise<boolean>），不能在 render 期同步调用——拿到的是 Promise 对象
 * （恒 truthy），会导致 ChromeBlur 恒走降级分支、BlurView 永不挂载（真机反馈教训）。
 * 用 state 消费 Promise 初值 + 监听 reduceTransparencyChanged 变化。
 */
export function useReducedTransparency(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceTransparencyEnabled()
      .then((v) => { if (mounted) setReduced(v); })
      .catch(() => { /* 查询失败按未开启处理 */ });
    const sub = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      (v: boolean) => { if (mounted) setReduced(v); }
    );
    return () => {
      mounted = false;
      sub?.remove();
    };
  }, []);
  return reduced;
}
