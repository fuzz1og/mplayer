import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import '@/renderer/styles/songlist.css';

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
      <div className="row-menu__scrim" onClick={onClose} />
      <div
        className="row-menu"
        style={{ top: `${pos.top}px`, right: `${pos.right}px` }}
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
            className="row-menu__item"
            data-danger={item.danger || undefined}
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
