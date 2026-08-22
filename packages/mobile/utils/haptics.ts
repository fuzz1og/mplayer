import * as Haptics from 'expo-haptics';

/**
 * 轻触觉反馈（多模态 §13：与视觉同帧触发；utility 原则——只加在
 * 开合落定、播放暂停等有意义的 commit 时刻）。
 * expo-haptics web 端为 no-op，异常静默不阻塞交互。
 */
export const tapLight = () => {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};
