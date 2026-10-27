import React, { useEffect } from 'react';
import { ToastProvider, useToast } from '@/renderer/ui';
import { useToastStore } from '@/renderer/services/toastStore';

/**
 * 把非 React 环境（store / hook / 主进程回调）推来的提示接到 ToastProvider 上。
 * 必须在 ToastProvider 内部才能调 useToast，所以单独一层。
 */
const ToastBridge: React.FC = () => {
  const { show } = useToast();
  const requests = useToastStore((s) => s.requests);
  const consume = useToastStore((s) => s.consume);

  useEffect(() => {
    if (requests.length === 0) return;
    requests.forEach((request) => {
      show(request.message, { tone: request.tone });
      consume(request.id);
    });
  }, [requests, show, consume]);

  return null;
};

/**
 * 全局 Toast 宿主（1.9.0）：替换 antd 的 message。
 * 包在应用最外层，任何组件都能 useToast 弹一条，store/hook 走 toast.success 等安全门面。
 */
const ToastHost: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ToastProvider>
    <ToastBridge />
    {children}
  </ToastProvider>
);

export default ToastHost;
