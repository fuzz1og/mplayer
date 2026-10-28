import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Dialog, Button } from '@/renderer/ui';

export interface ConfirmOptions {
  title: React.ReactNode;
  message?: React.ReactNode;
  okText?: string;
  cancelText?: string;
  /** 危险操作：确认按钮走危险样式。 */
  danger?: boolean;
  onOk?: () => void | Promise<void>;
  /** 用户取消/关闭时回调；与 onOk 互斥（onOk 成功路径不触发）。 */
  onCancel?: () => void;
}

interface ConfirmState extends ConfirmOptions {
  key: number;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => void;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

/**
 * 命令式确认框（1.9.0）：替换 antd 的 Modal.confirm。
 * 用法与以前一致——const confirm = useConfirm(); confirm({ title, message, onOk })。
 * 需要 ConfirmProvider（由 ToastHost 一并挂载），拿不到时抛出清晰错误而不是静默失效。
 */
export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pending, setPending] = useState<ConfirmState | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = useCallback((options: ConfirmOptions) => {
    setPending({ ...options, key: Date.now() });
  }, []);

  const cancel = useCallback(() => {
    const current = pending;
    setPending(null);
    setBusy(false);
    current?.onCancel?.();
  }, [pending]);

  const handleOk = useCallback(async () => {
    const current = pending;
    if (!current) return;
    setBusy(true);
    try {
      await current.onOk?.();
    } finally {
      setPending(null);
      setBusy(false);
    }
  }, [pending]);

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Dialog
        open={pending !== null}
        title={pending?.title ?? ''}
        onClose={cancel}
        size="sm"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={cancel}>
              {pending?.cancelText ?? '取消'}
            </Button>
            <Button variant={pending?.danger ? 'danger' : 'primary'} disabled={busy} onClick={() => void handleOk()}>
              {pending?.okText ?? '确定'}
            </Button>
          </>
        }
      >
        {pending?.message}
      </Dialog>
    </ConfirmContext.Provider>
  );
};

const detachedConfirm = (): void => {
  throw new Error('useConfirm 必须在 ConfirmProvider 内使用（挂在 main.tsx 的 ToastHost）');
};

/**
 * 拿不到 Provider 时不在渲染期抛错（否则整页白屏，且单测里正常渲染页面也会炸），
 * 而是返回一个「一调用就报错」的占位：错误落在真正要用确认框的那一刻。
 */
export const useConfirm = (): ((options: ConfirmOptions) => void) => {
  const context = useContext(ConfirmContext);
  return context?.confirm ?? detachedConfirm;
};
