import React from 'react';
import './ui.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'plain' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'size'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
}

/** 通用按钮。主操作才用 primary（全站唯一的品牌蓝落点），次级用默认 secondary。 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, children, className, type = 'button', ...rest },
  ref,
) {
  const classes = ['ui-btn', `ui-btn--${variant}`];
  if (size !== 'md') classes.push(`ui-btn--${size}`);
  if (className) classes.push(className);
  return (
    <button ref={ref} type={type} className={classes.join(' ')} {...rest}>
      {icon}
      {children != null && children !== '' ? <span>{children}</span> : null}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon'> {
  /** 无可见文案，必须给可访问名。 */
  label: string;
  icon: React.ReactNode;
}

/** 纯图标按钮：aria-label 必填，hover/焦点行为与 Button 一致。 */
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', className, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      aria-label={label}
      title={label}
      variant={variant}
      size={size}
      icon={icon}
      className={className ? `ui-icon-btn ${className}` : 'ui-icon-btn'}
      {...rest}
    />
  );
});
