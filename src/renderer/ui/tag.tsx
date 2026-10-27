import React from 'react';
import './ui.css';

export type TagTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface TagProps {
  children: React.ReactNode;
  tone?: TagTone;
  className?: string;
  title?: string;
}

/** 小标签：只表达状态与来源，不承担点击；tone 默认 neutral。 */
export const Tag: React.FC<TagProps> = ({ children, tone = 'neutral', className, title }) => {
  const classes = ['ui-tag'];
  if (tone !== 'neutral') classes.push(`ui-tag--${tone}`);
  if (className) classes.push(className);
  return (
    <span className={classes.join(' ')} title={title}>
      {children}
    </span>
  );
};
