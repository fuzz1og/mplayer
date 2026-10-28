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
 * 页面头（v2 统一壳）：h1 28/700 + 同行 lead/统计 + 右侧动作。
 * 详情页的 hero 仍是页面自己的内容，本组件只负责标题与动作行。
 */
export const PageHeader: React.FC<PageHeaderProps> = ({ title, lead, actions, meta, className }) => (
  <header className={className ? 'ui-page-header ' + className : 'ui-page-header'}>
    <h1 className="ui-page-header__title">{title}</h1>
    {lead != null && lead !== false && <div className="ui-page-header__lead">{lead}</div>}
    {meta != null && meta !== false && <div className="ui-page-header__meta">{meta}</div>}
    {actions != null && actions !== false && <div className="ui-page-header__actions">{actions}</div>}
  </header>
);

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

export interface PageBackProps {
  onClick: () => void;
  label?: string;
  className?: string;
}

/** 详情页左上返回：文字 + chevron，统一 13/二级色。 */
export const PageBack: React.FC<PageBackProps> = ({ onClick, label = '返回', className }) => (
  <button type="button" onClick={onClick} className={className ? 'ui-page-back ' + className : 'ui-page-back'}>
    <span aria-hidden="true">‹</span>
    {label}
  </button>
);

export interface PageSurfaceProps {
  children: React.ReactNode;
  className?: string;
}

/** 页面内容面：统一内容区留白；分组卡片由调用方的 Group/Section 负责。 */
export const PageSurface: React.FC<PageSurfaceProps> = ({ children, className }) => (
  <div className={className ? 'ui-page-surface ' + className : 'ui-page-surface'}>{children}</div>
);
