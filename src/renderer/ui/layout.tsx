import React from 'react';
import { ChevronRight } from 'lucide-react';
import './ui.css';

export interface GroupProps {
  children: React.ReactNode;
  className?: string;
}

/** 分组卡：行与行之间由 Row 自己画发丝线，卡片本身不带边框与阴影。 */
export const Group: React.FC<GroupProps> = ({ children, className }) => (
  <div className={className ? `ui-group ${className}` : 'ui-group'}>{children}</div>
);

export interface SectionProps {
  title?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** 分区：组标题 + 一个或多个 Group + 脚注说明。 */
export const Section: React.FC<SectionProps> = ({ title, footer, children, className }) => (
  <section className={className ? `ui-section ${className}` : 'ui-section'}>
    {title != null ? <div className="ui-section__title">{title}</div> : null}
    {children}
    {footer != null ? <div className="ui-section__footer">{footer}</div> : null}
  </section>
);

export interface RowProps {
  /** 22px 圆角图标位；不传则不占位，发丝线只缩进 14px。 */
  icon?: React.ReactNode;
  label: React.ReactNode;
  /** 右侧次要信息（数字一律等宽）。 */
  detail?: React.ReactNode;
  /** 右侧控件位；传入时本行不再承担点击（避免控件嵌套），交互交给控件自身。 */
  trailing?: React.ReactNode;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  chevron?: boolean;
  className?: string;
  ariaLabel?: string;
}

/**
 * 设置/列表通用行。可点击时渲染 div[role=button]（而不是 <button>），
 * 这样 trailing 里放开关也不会有按钮嵌套；键盘 Enter/Space 等价点击。
 */
export const Row: React.FC<RowProps> = ({
  icon,
  label,
  detail,
  trailing,
  onClick,
  selected,
  disabled,
  chevron,
  className,
  ariaLabel,
}) => {
  const interactive = Boolean(onClick) && !disabled;
  const classes = ['ui-row'];
  if (!icon) classes.push('ui-row--plain');
  if (className) classes.push(className);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick?.();
    }
  };

  return (
    <div
      className={classes.join(' ')}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={ariaLabel}
      aria-current={selected ? 'true' : undefined}
      aria-disabled={disabled ? true : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
    >
      {icon ? (
        <span className="ui-row__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className="ui-row__label">{label}</span>
      {detail != null ? <span className="ui-row__detail">{detail}</span> : null}
      {trailing != null ? <span className="ui-row__trailing">{trailing}</span> : null}
      {chevron ? <ChevronRight className="ui-row__chevron" size={14} aria-hidden="true" /> : null}
    </div>
  );
};
