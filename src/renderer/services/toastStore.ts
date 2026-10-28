import { create } from 'zustand';

/**
 * 全局 Toast 队列的最小门面（1.9.0）。
 * store 与 hook 里不能调 useToast（不在 React 树里），所以由宿主组件订阅这里，
 * 调用方只管 toast.push(...)。真正的渲染与排队在 ToastProvider 内部。
 */
export interface ToastRequest {
  id: number;
  message: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}

interface ToastStore {
  requests: ToastRequest[];
  push: (message: string, tone?: ToastRequest['tone']) => void;
  consume: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastStore>((set) => ({
  requests: [],
  push: (message, tone = 'neutral') => {
    const id = nextId++;
    set((state) => ({ requests: [...state.requests, { id, message, tone }] }));
  },
  consume: (id) => set((state) => ({ requests: state.requests.filter((item) => item.id !== id) })),
}));

/** 非 React 环境的安全入口。 */
export const toast = {
  success: (message: string) => useToastStore.getState().push(message, 'success'),
  error: (message: string) => useToastStore.getState().push(message, 'danger'),
  warning: (message: string) => useToastStore.getState().push(message, 'warning'),
  info: (message: string) => useToastStore.getState().push(message, 'neutral'),
};
