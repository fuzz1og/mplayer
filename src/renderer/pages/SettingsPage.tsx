import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { PageHeader } from '@/renderer/ui';
import '@/renderer/styles/settings.css';

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
 * 1.9.0 设置分组（#708）：按语义合并成 5 组，设置仍是独立全屏路由。
 * 更新/关于不再单独占底栏，并入「关于与更新」；诊断只在开发者模式出现（#477）。
 */
const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: '音频与播放',
    entries: [{ id: 'playback', label: '播放', icon: <Music2 size={13} /> }],
  },
  {
    title: '外观',
    entries: [{ id: 'appearance', label: '外观', icon: <Palette size={13} /> }],
  },
  {
    title: '存储与下载',
    entries: [
      { id: 'cache', label: '缓存', icon: <Database size={13} /> },
      { id: 'download', label: '下载', icon: <Folder size={13} /> },
    ],
  },
  {
    title: '网络与来源',
    entries: [
      { id: 'source', label: '直连状态', icon: <Zap size={13} /> },
      { id: 'tier3', label: '第三方解析源', icon: <FlaskConical size={13} /> },
      { id: 'network', label: '网络', icon: <Shield size={13} /> },
    ],
  },
  {
    title: '关于与更新',
    entries: [
      { id: 'update', label: '更新', icon: <Download size={13} /> },
      { id: 'about', label: '关于', icon: <Music size={13} /> },
    ],
  },
];

const DIAGNOSTICS_ENTRY: SettingsEntry = { id: 'diagnostics', label: '诊断', icon: <Activity size={13} /> };

/** 可深链的分区 id（#/settings/:section）；诊断只在开发者模式下有内容。 */
const SECTION_IDS = new Set([
  ...SETTINGS_GROUPS.flatMap((group) => group.entries.map((entry) => entry.id)),
  DIAGNOSTICS_ENTRY.id,
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
  const navigate = useNavigate();
  // 深链优先（#/settings/appearance 直接落外观页）；无参数或非法 id 落「缓存」（原型默认页，规格未另行约定）。
  const [active, setActive] = useState(() => (section && SECTION_IDS.has(section) ? section : 'cache'));
  const [devMode, setDevMode] = useState(isDevMode);

  useEffect(() => subscribeDevMode(setDevMode), []);

  // 深链在已挂载时换分区（#/settings/cache → #/settings/appearance）也要跟着切页
  useEffect(() => {
    if (section && SECTION_IDS.has(section)) setActive(section);
  }, [section]);

  /** 诊断只在开发者模式追加到「关于与更新」组尾，关闭时整项不渲染。 */
  const groups = useMemo(
    () => (devMode
      ? SETTINGS_GROUPS.map((group, index) => (index === SETTINGS_GROUPS.length - 1
        ? { ...group, entries: [...group.entries, DIAGNOSTICS_ENTRY] }
        : group))
      : SETTINGS_GROUPS),
    [devMode],
  );

  // 关掉开发者模式时若正停在诊断页，退回到「关于」，否则会停在一个不存在的页
  useEffect(() => {
    if (devMode || active !== 'diagnostics') return;
    setActive('about');
    navigate('/settings/about', { replace: true });
  }, [devMode, active, navigate]);

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
        onClick={() => {
          setActive(entry.id);
          navigate('/settings/' + entry.id, { replace: true });
        }}
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
        {groups.map((group) => (
          <div key={group.title} className="settings-nav__group">
            <div className="settings-nav__group-title">{group.title}</div>
            {group.entries.map(renderItem)}
          </div>
        ))}
      </nav>

      <div className="settings-content" role="region" aria-label="设置内容">
        <div className="settings-column">
          {active === 'about' && <PageHeader title="关于" />}
          {content}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
