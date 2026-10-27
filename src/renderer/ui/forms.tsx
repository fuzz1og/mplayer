import React, { useEffect, useRef } from 'react';
import { Check, CheckCircle2, CircleAlert, Info, Minus, Plus, TriangleAlert } from 'lucide-react';
import { IconButton } from './button';
import './forms.css';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** 无可见文案时必须给可访问名。 */
  ariaLabel?: string;
  className?: string;
}

/**
 * 开关用 button[role=switch]：原生按钮已经提供 Tab 与 pointer 语义，
 * 空格/Enter 在此显式接管，避免再自绘一套键盘逻辑。
 */
export const Switch: React.FC<SwitchProps> = ({ checked, onChange, disabled, ariaLabel, className }) => {
  const classes = ['ui-switch'];
  if (className) classes.push(className);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    // 阻止原生按钮随后再派发一次 click，否则每次按键会切换两次。
    event.preventDefault();
    if (!disabled) onChange(!checked);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={classes.join(' ')}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      onKeyDown={handleKeyDown}
    >
      <span className="ui-switch__thumb" aria-hidden="true" />
    </button>
  );
};

export type SegmentedSize = 'sm' | 'md';

export interface SegmentedProps {
  /** 值为 string 的选项数组，顺序即显示顺序。 */
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
  size?: SegmentedSize;
  /** 分段组无可见标题时必须给可访问名。 */
  ariaLabel?: string;
  className?: string;
}

/**
 * 分段控件用表面明度差表达选中，不占用品牌蓝——
 * 强调色在全站只留给主操作，避免同屏出现两个「主按钮」。
 */
export const Segmented: React.FC<SegmentedProps> = ({
  options,
  value,
  onChange,
  size = 'md',
  ariaLabel,
  className,
}) => {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const classes = ['ui-segmented', `ui-segmented--${size}`];
  if (className) classes.push(className);

  if (options.length === 0) return null;

  const selectedIndex = options.indexOf(value);
  const focusableIndex = selectedIndex === -1 ? 0 : selectedIndex;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = options.length - 1;
    if (nextIndex == null) return;

    event.preventDefault();
    onChange(options[nextIndex]);
    // 选中即焦点：radiogroup 的方向键语义要求焦点跟随选中项。
    optionRefs.current[nextIndex]?.focus();
  };

  return (
    <div className={classes.join(' ')} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option, index) => (
        <button
          key={option}
          ref={(node) => {
            optionRefs.current[index] = node;
          }}
          type="button"
          role="radio"
          aria-checked={option === value}
          tabIndex={index === focusableIndex ? 0 : -1}
          className="ui-segmented__option"
          onClick={() => onChange(option)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {option}
        </button>
      ))}
    </div>
  );
};

export type ProgressTone = 'accent' | 'success' | 'warning' | 'danger';

export interface ProgressProps {
  /** 0-100，越界值会被夹到边界。 */
  value: number;
  tone?: ProgressTone;
  label?: React.ReactNode;
  /** 进度条无可见文案时必须给可访问名。 */
  ariaLabel?: string;
  className?: string;
}

/**
 * 用原生 <progress> 而不是 div + width：填充比例由元素自身携带，
 * 组件里就不需要写内联样式来表达百分比。
 */
export const Progress: React.FC<ProgressProps> = ({
  value,
  tone = 'accent',
  label,
  ariaLabel,
  className,
}) => {
  const percent = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const rootClasses = ['ui-progress'];
  if (className) rootClasses.push(className);
  const trackClasses = ['ui-progress__track'];
  if (tone !== 'accent') trackClasses.push(`ui-progress__track--${tone}`);

  return (
    <div className={rootClasses.join(' ')}>
      {label != null ? (
        <div className="ui-progress__label">
          <span className="ui-progress__label-text">{label}</span>
          <span className="ui-progress__value">{Math.round(percent)}%</span>
        </div>
      ) : null}
      <progress
        className={trackClasses.join(' ')}
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        max={100}
        value={percent}
      />
    </div>
  );
};

export type AlertTone = 'info' | 'warning' | 'danger' | 'success';

export interface AlertProps {
  tone: AlertTone;
  title: React.ReactNode;
  children?: React.ReactNode;
  /** 右侧操作位，通常放一个文字按钮。 */
  action?: React.ReactNode;
  className?: string;
}

const ALERT_ICONS: Record<AlertTone, React.ReactNode> = {
  info: <Info size={16} />,
  warning: <TriangleAlert size={16} />,
  danger: <CircleAlert size={16} />,
  success: <CheckCircle2 size={16} />,
};

/**
 * info/success 用 status（礼貌播报），warning/danger 用 alert（立即播报）；
 * 两者都依赖 role 自带的 aria-live，不再重复声明。
 */
export const Alert: React.FC<AlertProps> = ({ tone, title, children, action, className }) => {
  const classes = ['ui-alert', `ui-alert--${tone}`];
  if (className) classes.push(className);
  const isAssertive = tone === 'warning' || tone === 'danger';

  return (
    <div className={classes.join(' ')} role={isAssertive ? 'alert' : 'status'}>
      <span className="ui-alert__icon" aria-hidden="true">
        {ALERT_ICONS[tone]}
      </span>
      <div className="ui-alert__body">
        <div className="ui-alert__title">{title}</div>
        {children != null ? <div className="ui-alert__text">{children}</div> : null}
      </div>
      {action != null ? <div className="ui-alert__action">{action}</div> : null}
    </div>
  );
};

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  indeterminate?: boolean;
  disabled?: boolean;
  /** 没有 label 时必须给可访问名。 */
  ariaLabel?: string;
  className?: string;
}

/**
 * indeterminate 只是 DOM 属性、没有对应 HTML attribute，
 * 因此必须经 ref 写入；每次 prop 变化都重新同步，避免受控值把它冲掉。
 */
export const Checkbox: React.FC<CheckboxProps> = ({
  checked,
  onChange,
  label,
  indeterminate,
  disabled,
  ariaLabel,
  className,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const classes = ['ui-checkbox'];
  if (className) classes.push(className);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = Boolean(indeterminate);
  }, [indeterminate]);

  return (
    <label className={classes.join(' ')}>
      <input
        ref={inputRef}
        type="checkbox"
        className="ui-checkbox__input"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ui-checkbox__box" aria-hidden="true">
        {indeterminate ? (
          <Minus size={12} strokeWidth={3} />
        ) : checked ? (
          <Check size={12} strokeWidth={3} />
        ) : null}
      </span>
      {label != null ? <span className="ui-checkbox__label">{label}</span> : null}
    </label>
  );
};

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** 可访问名上下文，例如「音量」；会拼进两个按钮的名字。 */
  label?: string;
  disabled?: boolean;
  className?: string;
}

/** 数字步进：边界直接禁用按钮，同时仍把步进结果夹在区间内，防止外部传入越界值。 */
export const Stepper: React.FC<StepperProps> = ({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  disabled,
  className,
}) => {
  const classes = ['ui-stepper'];
  if (className) classes.push(className);
  const precision = (String(step).split('.')[1] ?? '').length;
  const clamp = (next: number) => Number(Math.min(max, Math.max(min, next)).toFixed(precision));

  return (
    <div className={classes.join(' ')} role="group" aria-label={label}>
      <IconButton
        size="sm"
        label={label ? `减少${label}` : '减少'}
        icon={<Minus size={14} />}
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - step))}
      />
      <span className="ui-stepper__value" aria-live="polite">
        {value}
      </span>
      <IconButton
        size="sm"
        label={label ? `增加${label}` : '增加'}
        icon={<Plus size={14} />}
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + step))}
      />
    </div>
  );
};
