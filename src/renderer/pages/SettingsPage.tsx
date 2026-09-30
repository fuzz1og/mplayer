import React, { useEffect, useState } from 'react';
import { Settings, Database, Folder, Shield, Download, Music, Music2, Zap, Fingerprint, FlaskConical, Palette, Activity } from 'lucide-react';
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

/** 左导航项（顺序 = 正文里各 <section> 的渲染顺序，锚点才滚得准）。 */
interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

/** 常驻导航项。#477 的诊断两项与「开发者模式」开关在正文里位于 tier3 与 TLS 之间。 */
const BASE_NAV_ITEMS: NavItem[] = [
  { id: 'appearance', label: '外观', icon: <Palette size={15} /> },
  { id: 'cache', label: '缓存管理', icon: <Database size={15} /> },
  { id: 'download', label: '下载设置', icon: <Folder size={15} /> },
  { id: 'playback', label: '播放', icon: <Music2 size={15} /> },
  { id: 'source', label: '直连状态', icon: <Zap size={15} /> },
  { id: 'tier3', label: '第三方解析源', icon: <FlaskConical size={15} /> },
  { id: 'developer', label: '开发者模式', icon: <FlaskConical size={15} /> },
  { id: 'tls-fingerprint', label: 'TLS 指纹伪装', icon: <Fingerprint size={15} /> },
  { id: 'proxy', label: '网络代理', icon: <Shield size={15} /> },
  { id: 'update', label: '检查更新', icon: <Download size={15} /> },
  { id: 'about', label: '关于', icon: <Music size={15} /> },
];

/** 诊断导航项只在开发者模式打开时挂——关闭时它整段不渲染，留着会「滚不到东西」（#477）。 */
const DIAGNOSTICS_NAV_ITEMS: NavItem[] = [
  { id: 'playback-trace', label: '播放诊断', icon: <Activity size={15} /> },
];

const SettingsPage: React.FC = () => {
  const [active, setActive] = useState('cache');
  const [devMode, setDevModeState] = useState(isDevMode);
  useEffect(() => subscribeDevMode(setDevModeState), []);

  /**
   * 导航项与正文渲染同受开关控制。切到「开发者模式」时本区常驻、无需额外处理；
   * 诊断项只在打开后存在，锚点因此在渲染完成后才能滚动——见 handleNav 的延后一帧。
   */
  const navItems = devMode
    ? [
        ...BASE_NAV_ITEMS.slice(0, BASE_NAV_ITEMS.findIndex((i) => i.id === 'tls-fingerprint')),
        ...DIAGNOSTICS_NAV_ITEMS,
        ...BASE_NAV_ITEMS.slice(BASE_NAV_ITEMS.findIndex((i) => i.id === 'tls-fingerprint')),
      ]
    : BASE_NAV_ITEMS;

  const handleNav = (id: string) => {
    setActive(id);
    // 目标 section 可能因本次点击才刚挂载（诊断区随开关显隐），等 React 提交后再滚，
    // 否则 document.getElementById 拿到 null——「收起后滚不到东西」的本体。
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // 关闭开发者模式时若正停在诊断锚点，把高亮挪回开关所在区，避免选中一个不存在的项
  useEffect(() => {
    if (!devMode && active === 'playback-trace') setActive('developer');
  }, [devMode, active]);

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
      <aside
        style={{
          width: '220px',
          borderRight: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-surface)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '20px 20px 12px' }}>
          <Settings size={18} color="var(--text-secondary)" />
          <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>设置</span>
        </div>
        <nav style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNav(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '9px 12px',
                border: 'none',
                background: active === item.id ? 'var(--bg-hover)' : 'transparent',
                color: active === item.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: active === item.id ? 600 : 400,
                textAlign: 'left',
                transition: 'background 0.15s ease, color 0.15s ease',
              }}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
        <AppearanceSection />
        <CacheSection />
        <DownloadSection />
        <PlaybackSection />
        <SourceSection />
        <Tier3Section />
        <DeveloperSection />
        {devMode ? <PlaybackDiagnosticsSection /> : null}
        <TlsFingerprintSection />
        <ProxySection />
        <UpdateSection />
        <AboutSection />
      </main>
    </div>
  );
};

export default SettingsPage;
