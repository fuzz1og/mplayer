import React from 'react';
import { Menu } from '@/renderer/ui';

export interface RowActionItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  danger?: boolean;
  /** 无障碍名；缺省用 label */
  ariaLabel?: string;
  onClick: () => void;
}

interface RowActionMenuProps {
  triggerRef: React.RefObject<HTMLElement | null>;
  items: RowActionItem[];
  onClose: () => void;
}

/**
 * 歌曲行的「更多」操作菜单：共享 Menu 原语负责定位、首项聚焦、
 * 方向键 / Home / End / ESC / Tab 与焦点归还；这里只管把 RowActionItem 映射过去。
 */
const RowActionMenu: React.FC<RowActionMenuProps> = ({ triggerRef, items, onClose }) => (
  <Menu
    open
    anchorRef={triggerRef}
    ariaLabel="行操作"
    placement="bottom-end"
    items={items.map((item) => ({
      key: item.key,
      label: item.label,
      icon: item.icon,
      danger: item.danger,
      ariaLabel: item.ariaLabel,
      onSelect: item.onClick,
    }))}
    onClose={onClose}
  />
);

export default RowActionMenu;
