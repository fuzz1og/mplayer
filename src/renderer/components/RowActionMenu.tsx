import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export interface RowActionItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  /** 无障碍名；缺省用 label */
  ariaLabel?: string;
  onClick: (e: React.MouseEvent) => void;
}

interface RowActionMenuProps {
  triggerRef: React.RefObject<HTMLElement | null>;
  items: RowActionItem[];
  onClose: (e: React.MouseEvent) => void;
}

/**
 * 歌曲行的「更多」操作菜单（共享组件）：所有列表行的操作统一收进
 * 这个下拉菜单，保持交互一致（与 spec 的入口决策一致）。
 */
const RowActionMenu: React.FC<RowActionMenuProps> = ({ triggerRef, items, onClose }) => {
  const [pos, setPos] = useState({ top: 0, right: 0 });

  useEffect(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
  }, [triggerRef]);

  return createPortal(
    <>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }} onClick={onClose} />
      <div
        style={{
          position: 'fixed',
          top: `${pos.top}px`,
          right: `${pos.right}px`,
          backgroundColor: 'var(--bg-base)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
          zIndex: 10000,
          minWidth: '120px',
          padding: '4px',
        }}
      >
        {items.map((item) => (
          <button
            key={item.key}
            aria-label={item.ariaLabel ?? item.label}
            onClick={(e) => {
              e.stopPropagation();
              item.onClick(e);
              onClose(e);
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
              padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer',
              borderRadius: 'var(--radius-xs)', fontSize: 'var(--text-sm)',
              color: item.danger ? 'var(--danger)' : 'var(--text-primary)',
            }}
          >
            {item.icon} {item.label}
          </button>
        ))}
      </div>
    </>,
    document.body
  );
};

export default RowActionMenu;
