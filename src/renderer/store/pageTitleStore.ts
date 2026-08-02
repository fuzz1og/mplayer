import { create } from 'zustand';

/**
 * 子页面标题上报 store:各子页把自身标题写到 TopBar 右侧显示,
 * 页面卸载时清空,避免页面内再占一行标题栏
 */
interface PageTitleState {
  title: string;
  setTitle: (title: string) => void;
}

export const usePageTitleStore = create<PageTitleState>((set) => ({
  title: '',
  setTitle: (title) => set({ title }),
}));
