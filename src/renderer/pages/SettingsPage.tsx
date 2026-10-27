import React, { useEffect, useMemo, useState } from 'react';
import { Palette, Database, Folder, Shield, Download, Music, Music2, Zap, FlaskConical, Activity, ChevronRight } from 'lucide-react';
import CacheSection from '@/renderer/components/CacheSection';
import DownloadSection from '@/renderer/components/DownloadSection';
import ProxySection from '@/renderer/components/ProxySection';
import UpdateSection from '@/renderer/components/UpdateSection';
import AboutSection from '@/renderer/components/AboutSection';
import SourceSection from '@/renderer/components/SourceSection';
import PlaybackSection from '@/renderer/components/PlaybackSection';
import TlsFingerprintSection from '@/renderer/components/TlsFingerprintSection';
import Tier3Section from '@/renderer/components/Tier3Section';
import PlaybackDiagnosticsSection from '@/renderer/components/PlaybackDiagnosticsSection';
import AppearanceSection from '@/renderer/components/AppearanceSection';
import DeveloperSection from '@/renderer/components/DeveloperSection';
import { isDevMode, subscribeDevMode } from '@/renderer/services/devMode';

interface SettingsEntry {
  id: string;
  label: string;
  icon: React.ReactNode;
}

interface SettingsGroup {
  title: string;
  entries: SettingsEntry[];
}

/**
 * 1.9.0 设置信息架构：4 组 9 页 + 开发者模式下的诊断页。
 * 原「开发者模式 / TLS 指纹伪装 / 网络代理」不再各占一页：开发者模式挂在「关于」页底部，
 * 代理与 TLS 合并进「网络」页；诊断页只在开发者模式打开时出现（#477）。
 */
const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: '通用',
    entries: [
      { id: 'appearance', label: '外观', icon: <Palette size={13} /> },
      { id: 'playback', label: '播放', icon: <Music2 size={13} /> },
    ],
  },
  {
    title: '资料库',
    entries: [
      { id: 'cache', label: '缓存', icon: <Database size={13} /> },
      { id: 'download', label: '下载', icon: <Folder size={13} /> },
    ],
  },
  {
    title: '音乐源',
    entries: [
      { id: 'source', label: '直连状态', icon: <Zap size={13} /> },
      { id: 'tier3', label: '第三方解析源', icon: <FlaskConical size={13} /> },
      { id: 'network', label: '网络', icon: <Shield size={13} /> },
    ],
  },
  {
    title: '应用',
    entries: [
      { id: 'update', label: '更新', icon: <Download size={13} /> },
      { id: 'about', label: '关于', icon: <Music size={13} /> },
    ],
  },
];

const DIAGNOSTICS_ENTRY: SettingsEntry = { id: 'diagnostics', label: '诊断', icon: <Activity size={13} /> };

/** 尚未迁移到新原语的分区仍用旧组件渲染，保证这一批不丢功能（#684 逐页替换）。 */
const LEGACY_SECTIONS: Record<string, React.ReactNode> = {
  appearance: <AppearanceSection />,
  cache: <CacheSection />,
  download: <DownloadSection />,
  playback: <PlaybackSection />,
  source: <SourceSection />,
  tier3: <Tier3Section />,
  network: (
    <>
      <ProxySection />
      <TlsFingerprintSection />
    </>
  ),
  update: <UpdateSection />,
  about: (
    <>
      <AboutSection />
      <DeveloperSection />
    </>
  ),
};

const SettingsPage: React.FC = () => {
  const [active, setActive] = useState('cache');
  const [devMode, setDevMode] = useState(isDevMode);

  useEffect(() => subscribeDevMode(setDevMode), []);

  const groups = useMemo(() => {
    if (!devMode) return SETTINGS_GROUPS;
    return SETTINGS_GROUPS.map((group) =>
      group.title === '应用' ? { ...group, entries: [...group.entries, DIAGNOSTICS_ENTRY] } : group,
    );
  }, [devMode]);

  // 关掉开发者模式时若正停在诊断页，退回到「关于」，否则会停在一个不存在的页
  useEffect(() => {
    if (!devMode && active === 'diagnostics') setActive('about');
  }, [devMode, active]);

  const content =
    active === 'diagnostics' && devMode ? <PlaybackDiagnosticsSection /> : LEGACY_SECTIONS[active] ?? null;

  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置导航">
        {groups.map((group) => (
          <div key={group.title} className="settings-nav__group">
            <div className="settings-nav__group-title">{group.title}</div>
            {group.entries.map((entry) => {
              const isActive = active === entry.id;
              return (
                <button
                  key={entry.id}
                  type="button"
                  className="settings-nav__item"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setActive(entry.id)}
                >
                  <span className="settings-nav__icon" aria-hidden="true">
                    {entry.icon}
                  </span>
                  <span>{entry.label}</span>
                  <ChevronRight className="settings-nav__chevron" size={13} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="settings-content" role="region" aria-label="设置内容">
        {content}
      </div>
    </div>
  );
};

export default SettingsPage;
