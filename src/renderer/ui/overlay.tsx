import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button, IconButton } from './button';
import './overlay.css';

/* ============================================================
   浮层与数据展示原语（#681）：Dialog / Toast / GridList
   — 样式全部走 overlay.css 类名，组件内不写内联 style
   ============================================================ */

/* ── Dialog ── */

export type DialogSize = 'sm' | 'md';

export interface DialogProps {
  open: boolean;
  title: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** 用户请求关闭（ESC / 关闭按钮 / 原生 cancel）。父组件负责把 open 置 false。 */
  onClose: () => void;
  size?: DialogSize;
  className?: string;
}

const DIALOG_FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * 打开原生 modal。返回 true 表示走的是浏览器原生 showModal（焦点陷阱、ESC、backdrop 由浏览器负责）。
 * jsdom / 老环境里 showModal 可能缺失或抛错，退回 open 属性模式，行为由本组件补齐。
 */
const openModal = (dialog: HTMLDialogElement): boolean => {
  if (typeof dialog.showModal === 'function') {
    try {
      dialog.showModal();
      return true;
    } catch {
      // showModal 存在但不可用（未连接 DOM / 已打开）：退回属性模式
    }
  }
  dialog.setAttribute('open', '');
  return false;
};

/** 关闭 dialog；jsdom 没有 close()，用移除 open 属性等价的 fallback。 */
const closeDialog = (dialog: HTMLDialogElement): void => {
  if (typeof dialog.close === 'function') {
    try {
      dialog.close();
      return;
    } catch {
      // 落到属性模式
    }
  }
  dialog.removeAttribute('open');
};

/**
 * 原生 <dialog> 承载的对话框：showModal 提供焦点陷阱，ESC 触发 cancel。
 * 关闭后把焦点还给打开它的元素；标题通过 aria-labelledby 关联。
 */
export const Dialog: React.FC<DialogProps> = ({
  open,
  title,
  children,
  footer,
  onClose,
  size = 'md',
  className,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const nativeModalRef = useRef(false);
  const closeRequestedRef = useRef(false);
  const openRef = useRef(open);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  /** 一次打开周期内只回调一次 onClose（ESC + cancel + close 可能叠加触发）。 */
  const requestClose = useCallback(() => {
    if (closeRequestedRef.current) return;
    closeRequestedRef.current = true;
    onCloseRef.current();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) closeDialog(dialog);
      return;
    }

    closeRequestedRef.current = false;
    triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog.open) return;

    nativeModalRef.current = openModal(dialog);
    if (!nativeModalRef.current) {
      const focusTarget = dialog.querySelector<HTMLElement>(DIALOG_FOCUSABLE) ?? dialog;
      focusTarget.focus();
    }
  }, [open]);

  // 关闭后把焦点还给触发元素（原生 modal 也会归还一次，这里保证 fallback 与受控关闭一致）。
  useEffect(() => {
    if (open) return;
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger?.isConnected) trigger.focus();
  }, [open]);

  // cancel（ESC）与 close（浏览器主动关闭）都同步回父组件；程序性 close 不重复回调。
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      requestClose();
    };
    const handleClose = () => {
      if (openRef.current) requestClose();
    };
    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('close', handleClose);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleClose);
    };
  }, [requestClose]);

  // fallback 模式没有原生 ESC：监听 document keydown 补上同样行为。
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || nativeModalRef.current) return;
      event.preventDefault();
      requestClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, requestClose]);

  const classes = ['ui-dialog', `ui-dialog--${size}`];
  if (className) classes.push(className);

  return (
    <dialog
      ref={dialogRef}
      className={classes.join(' ')}
      aria-labelledby={titleId}
      aria-modal="true"
      tabIndex={-1}
    >
      <div className="ui-dialog__header">
        <h2 id={titleId} className="ui-dialog__title">
          {title}
        </h2>
        <IconButton
          label="关闭对话框"
          icon={<X size={14} aria-hidden="true" />}
          size="sm"
          onClick={requestClose}
        />
      </div>
      <div className="ui-dialog__body">{children}</div>
      {footer != null ? <div className="ui-dialog__footer">{footer}</div> : null}
    </dialog>
  );
};

/* ── Toast ── */

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface ToastAction {
  label: React.ReactNode;
  onClick: () => void;
}

export interface ToastOptions {
  tone?: ToastTone;
  /** 毫秒；默认 4000。传 0 表示不自动消退。 */
  duration?: number;
  action?: ToastAction;
}

export interface ToastApi {
  /** 显示一条提示，返回内部 id（一般无需使用）。 */
  show: (message: React.ReactNode, options?: ToastOptions) => string;
}

interface ToastItem {
  id: string;
  message: React.ReactNode;
  tone: ToastTone;
  duration: number;
  action?: ToastAction;
}

const TOAST_VISIBLE_LIMIT = 3;
const TOAST_DEFAULT_DURATION = 4000;

const ToastContext = createContext<ToastApi | null>(null);

const ToastCard: React.FC<{ toast: ToastItem; onDismiss: (id: string) => void }> = ({
  toast,
  onDismiss,
}) => {
  useEffect(() => {
    if (toast.duration <= 0) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast.duration, toast.id, onDismiss]);

  const handleAction = () => {
    if (!toast.action) return;
    toast.action.onClick();
    onDismiss(toast.id);
  };

  return (
    <div className={`ui-toast ui-toast--${toast.tone}`}>
      <span className="ui-toast__dot" aria-hidden="true" />
      <span className="ui-toast__message">{toast.message}</span>
      {toast.action ? (
        <Button variant="plain" size="sm" className="ui-toast__action" onClick={handleAction}>
          {toast.action.label}
        </Button>
      ) : null}
      <IconButton
        label="关闭提示"
        icon={<X size={12} aria-hidden="true" />}
        size="sm"
        className="ui-toast__close"
        onClick={() => onDismiss(toast.id)}
      />
    </div>
  );
};

/**
 * 全局 Toast 宿主：最多同时展示 3 条，超出的按显示顺序排队；
 * 容器 role=status + aria-live=polite，通过 portal 挂到 body。
 */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(0);

  const show = useCallback((message: React.ReactNode, options: ToastOptions = {}) => {
    nextIdRef.current += 1;
    const id = `ui-toast-${nextIdRef.current}`;
    setToasts((previous) => [
      ...previous,
      {
        id,
        message,
        tone: options.tone ?? 'neutral',
        duration: options.duration ?? TOAST_DEFAULT_DURATION,
        action: options.action,
      },
    ]);
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {typeof document === 'undefined'
        ? null
        : createPortal(
            <div className="ui-toast-viewport" role="status" aria-live="polite" aria-atomic="false">
              {toasts.slice(0, TOAST_VISIBLE_LIMIT).map((toast) => (
                <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
              ))}
            </div>,
            document.body,
          )}
    </ToastContext.Provider>
  );
};

/** 必须在 <ToastProvider> 内使用；缺失时抛错，避免提示静默丢失。 */
export const useToast = (): ToastApi => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast 必须在 <ToastProvider> 内使用：请在应用根节点挂载 ToastProvider。');
  }
  return context;
};

/* ── GridList ── */

export type GridListAlign = 'left' | 'center' | 'right';

export interface GridListColumn<T> {
  /** 列标识；无 render 时用它从行对象取默认值。 */
  key: string;
  title: React.ReactNode;
  width?: number | string;
  align?: GridListAlign;
  render?: (row: T, index: number) => React.ReactNode;
}

export interface GridListProps<T> {
  columns: GridListColumn<T>[];
  rows: T[];
  rowKey: keyof T | ((row: T, index: number) => React.Key);
  /** 空态文案，默认「暂无数据」。 */
  empty?: React.ReactNode;
  /** 整行可点击（键盘 Enter/Space 等价）。 */
  onRowClick?: (row: T, index: number) => void;
  className?: string;
  ariaLabel?: string;
}

const resolveRowKey = <T,>(row: T, index: number, rowKey: GridListProps<T>['rowKey']): React.Key =>
  typeof rowKey === 'function'
    ? rowKey(row, index)
    : (row[rowKey] as unknown as React.Key);

const gridCellClass = <T,>(base: string, column: GridListColumn<T>): string => {
  const classes = [base];
  if (column.align && column.align !== 'left') classes.push(`${base}--${column.align}`);
  return classes.join(' ');
};

/**
 * 通用网格列表：table/thead/tbody/tr/th/td 语义，行高 44、发丝线、
 * 表头 11px 次要色。承接原先唯一的 antd Table 用法。
 */
export function GridList<T>({
  columns,
  rows,
  rowKey,
  empty = '暂无数据',
  onRowClick,
  className,
  ariaLabel,
}: GridListProps<T>) {
  const interactive = Boolean(onRowClick);
  const wrapperClasses = ['ui-grid-wrap'];
  if (className) wrapperClasses.push(className);

  const handleRowKeyDown = (
    event: React.KeyboardEvent<HTMLTableRowElement>,
    row: T,
    index: number,
  ) => {
    if (!onRowClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick(row, index);
    }
  };

  return (
    <div className={wrapperClasses.join(' ')}>
      <table className="ui-grid" aria-label={ariaLabel}>
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} width={column.width} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={gridCellClass('ui-grid__head', column)}>
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="ui-grid__empty" colSpan={columns.length}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const rowClasses = ['ui-grid__row'];
              if (interactive) rowClasses.push('ui-grid__row--clickable');
              return (
                <tr
                  key={resolveRowKey(row, index, rowKey)}
                  className={rowClasses.join(' ')}
                  tabIndex={interactive ? 0 : undefined}
                  onClick={interactive ? () => onRowClick?.(row, index) : undefined}
                  onKeyDown={interactive ? (event) => handleRowKeyDown(event, row, index) : undefined}
                >
                  {columns.map((column) => (
                    <td key={column.key} className={gridCellClass('ui-grid__cell', column)}>
                      {column.render
                        ? column.render(row, index)
                        : String((row as Record<string, unknown>)[column.key] ?? '')}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
