import React, { useState } from 'react';
import { Settings, Database, Folder, Shield, Download, Music, Zap, Fingerprint, FlaskConical, Palette } from 'lucide-react';
import CacheSection from '@/renderer/components/CacheSection';
import DownloadSection from '@/renderer/components/DownloadSection';
import ProxySection from '@/renderer/components/ProxySection';
import UpdateSection from '@/renderer/components/UpdateSection';
import AboutSection from '@/renderer/components/AboutSection';
import SourceSection from '@/renderer/components/SourceSection';
import TlsFingerprintSection from '@/renderer/components/TlsFingerprintSection';
import Tier3Section from '@/renderer/components/Tier3Section';
import AppearanceSection from '@/renderer/components/AppearanceSection';

const NAV_ITEMS = [
  { id: 'appearance', label: '外观', icon: <Palette size={15} /> },
  { id: 'cache', label: '缓存管理', icon: <Database size={15} /> },
  { id: 'download', label: '下载设置', icon: <Folder size={15} /> },
  { id: 'source', label: '直连状态', icon: <Zap size={15} /> },
  { id: 'tier3', label: '第三方解析源', icon: <FlaskConical size={15} /> },
  { id: 'tls-fingerprint', label: 'TLS 指纹伪装', icon: <Fingerprint size={15} /> },
  { id: 'proxy', label: '网络代理', icon: <Shield size={15} /> },
  { id: 'update', label: '检查更新', icon: <Download size={15} /> },
  { id: 'about', label: '关于', icon: <Music size={15} /> },
];

const SettingsPage: React.FC = () => {
  const [active, setActive] = useState('cache');

  const handleNav = (id: string) => {
    setActive(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
          {NAV_ITEMS.map((item) => (
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
        <SourceSection />
        <Tier3Section />
        <TlsFingerprintSection />
        <ProxySection />
        <UpdateSection />
        <AboutSection />
      </main>
    </div>
  );
};

export default SettingsPage;
