import { router } from 'expo-router';

/**
 * 返回上一页；无历史（深链直开 / 冷启进详情）时回首页兜底。
 * 用于自绘导航栏与全屏播放器这类不经过原生 Stack header 的返回入口。
 */
export function goBackOrHome(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
