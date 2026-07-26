import React from 'react';
import { Settings } from 'lucide-react';
import CacheSection from '@/renderer/components/CacheSection';
import DownloadSection from '@/renderer/components/DownloadSection';
import ApiSection from '@/renderer/components/ApiSection';
import ProxySection from '@/renderer/components/ProxySection';
import UpdateSection from '@/renderer/components/UpdateSection';
import AboutSection from '@/renderer/components/AboutSection';

const SettingsPage: React.FC = () => {
  return (
    <div style={{ padding: '24px', height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '32px', paddingBottom: '24px', borderBottom: '1px solid var(--divider-color)' }}>
        <Settings size={28} color="var(--text-primary)" />
        <h1 style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)' }}>设置</h1>
      </div>
      <CacheSection />
      <DownloadSection />
      <ApiSection />
      <ProxySection />
      <UpdateSection />
      <AboutSection />
    </div>
  );
};

export default SettingsPage;
