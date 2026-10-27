import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
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
 * 1.9.0 原型对齐 §2：3 组 7 页 + 导航底部固定区（更新/关于）。
 * 「更新」「关于」不再是第 4 组——原型里它们钉在导航最下沿、上方一条 hairline。
 * 诊断页仍只在开发者模式出现（#477），挂在底部固定区尾部。
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
];

const SETTINGS_FOOTER_ENTRIES: SettingsEntry[] = [
  { id: 'update', label: '更新', icon: <Download size={13} /> },
  { id: 'about', label: '关于', icon: <Music size={13} /> },
];

const DIAGNOSTICS_ENTRY: SettingsEntry = { id: 'diagnostics', label: '诊断', icon: <Activity size={13} /> };

/** 可深链的分区 id（#/settings/:section）；诊断只在开发者模式下算合法。 */
const SECTION_IDS = new Set([
  ...SETTINGS_GROUPS.flatMap((group) => group.entries.map((entry) => entry.id)),
  ...SETTINGS_FOOTER_ENTRIES.map((entry) => entry.id),
]);

/** 分区 id → 页面内容。全部 9 页已迁入新壳，组件本身按需继续收敛。 */
const SECTION_CONTENT: Record<string, React.ReactNode> = {
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
  const { section } = useParams<{ section?: string }>();
  // 深链优先（#/settings/appearance 直接落外观页）；无参数或非法 id 落「缓存」（原型默认页，规格未另行约定）。
  const [active, setActive] = useState(() => (section && SECTION_IDS.has(section) ? section : 'cache'));
  const [devMode, setDevMode] = useState(isDevMode);

  useEffect(() => subscribeDevMode(setDevMode), []);

  // 深链在已挂载时换分区（#/settings/cache → #/settings/appearance）也要跟着切页
  useEffect(() => {
    if (section && SECTION_IDS.has(section)) setActive(section);
  }, [section]);

  const footerEntries = useMemo(
    () => (devMode ? [...SETTINGS_FOOTER_ENTRIES, DIAGNOSTICS_ENTRY] : SETTINGS_FOOTER_ENTRIES),
    [devMode],
  );

  // 关掉开发者模式时若正停在诊断页，退回到「关于」，否则会停在一个不存在的页
  useEffect(() => {
    if (!devMode && active === 'diagnostics') setActive('about');
  }, [devMode, active]);

  const content =
    active === 'diagnostics' && devMode ? <PlaybackDiagnosticsSection /> : SECTION_CONTENT[active] ?? null;

  const renderItem = (entry: SettingsEntry) => {
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
  };

  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置导航">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.title} className="settings-nav__group">
            <div className="settings-nav__group-title">{group.title}</div>
            {group.entries.map(renderItem)}
          </div>
        ))}

        <div className="settings-nav__footer">{footerEntries.map(renderItem)}</div>
      </nav>

      <div className="settings-content" role="region" aria-label="设置内容">
        {content}
      </div>
    </div>
  );
};

export default SettingsPage;
