import React from 'react';
import './page.css';

export interface PageHeaderProps {
  title: React.ReactNode;
  lead?: React.ReactNode;
  actions?: React.ReactNode;
  /** 右侧附加的说明（与 lead 同行的轻量文字，如当前排序）。 */
  meta?: React.ReactNode;
  className?: string;
}

/**
 * 页面头（v2 统一壳）：页面名在侧栏已经点名，内容区不再重复印一遍大字。
 * h1 保留给读屏与路由标题，视觉隐藏；可见的只有计数与右侧主操作这一行。
 */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, lead, actions, meta, className }) => {
  const hasRow = (lead != null && lead !== false) || (meta != null && meta !== false) || (actions != null && actions !== false);
  return (
    <header className={className ? 'ui-page-header ' + className : 'ui-page-header'} data-bare={hasRow ? undefined : ''}>
      <h1 className="ui-page-header__title">{title}</h1>
      {lead != null && lead !== false && <div className="ui-page-header__lead">{lead}</div>}
      {meta != null && meta !== false && <div className="ui-page-header__meta">{meta}</div>}
      {actions != null && actions !== false && <div className="ui-page-header__actions">{actions}</div>}
    </header>
  );
};

export interface PageHeroProps {
  media: React.ReactNode;
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/** 详情页 hero（v2 方案 A）：媒体 + 标题/meta/动作；媒体尺寸由页面类覆盖。 */
export const PageHero: React.FC<PageHeroProps> = ({ media, eyebrow, title, meta, actions, className }) => (
  <section className={className ? 'ui-page-hero ' + className : 'ui-page-hero'}>
    <div className="ui-page-hero__media">{media}</div>
    <div className="ui-page-hero__body">
      {eyebrow != null && eyebrow !== false && <div className="ui-page-hero__eyebrow">{eyebrow}</div>}
      <h1 className="ui-page-hero__title">{title}</h1>
      {meta != null && meta !== false && <div className="ui-page-hero__meta">{meta}</div>}
      {actions != null && actions !== false && <div className="ui-page-hero__actions">{actions}</div>}
    </div>
  </section>
);
