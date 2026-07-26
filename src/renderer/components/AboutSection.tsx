import React, { useEffect, useState } from 'react';
import { Music } from 'lucide-react';

const { ipcRenderer } = window.require('electron');

const AboutSection: React.FC = () => {
  const [version, setVersion] = useState('');

  useEffect(() => {
    ipcRenderer.invoke('update:getVersion').then(setVersion).catch(() => {});
  }, []);
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <Music size={20} color="var(--accent-color)" />
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)' }}>关于</h2>
      </div>
      <div style={{ backgroundColor: 'var(--content-bg)', borderRadius: '12px', padding: '24px', border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
          <div style={{ width: '60px', height: '60px', borderRadius: '12px', background: 'linear-gradient(135deg, #2D3436 0%, #636E72 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Music size={28} color="white" />
          </div>
          <div>
            <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>MPlayer</div>
            <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)' }}>简约优雅的音乐播放器</div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', fontSize: 'var(--text-base)' }}>
          <div style={{ color: 'var(--text-secondary)' }}>版本: <span style={{ color: 'var(--text-primary)' }}>v{version || '...'}</span></div>
          <div style={{ color: 'var(--text-secondary)' }}>技术栈: <span style={{ color: 'var(--text-primary)' }}>Electron + React + TypeScript</span></div>
        </div>
      </div>
    </section>
  );
};

export default AboutSection;
