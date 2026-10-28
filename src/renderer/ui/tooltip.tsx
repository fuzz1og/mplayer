import React, { useId } from 'react';
import { Info } from 'lucide-react';
import './tooltip.css';

export interface InfoHintProps {
  /** 图标的可访问名称，如「榜单说明」 */
  label: string;
  children: React.ReactNode;
  className?: string;
}

/**
 * 补充信息收纳：常显的说明段落换成 info 图标，悬停或键盘聚焦才展开。
 * 浮层常驻 DOM 并由 aria-describedby 关联，读屏用户不悬停也能听到内容。
 */
export const InfoHint: React.FC<InfoHintProps> = ({ label, children, className }) => {
  const bubbleId = useId();
  return (
    <span className={className ? 'ui-info-hint ' + className : 'ui-info-hint'}>
      <button
        type="button"
        className="ui-info-hint__trigger"
        aria-label={label}
        aria-describedby={bubbleId}
      >
        <Info size={14} aria-hidden="true" />
      </button>
      <span id={bubbleId} className="ui-info-hint__bubble" role="note">
        {children}
      </span>
    </span>
  );
};
