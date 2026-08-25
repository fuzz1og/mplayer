import React, { useEffect, useState } from 'react';
import { Music, Link2 } from 'lucide-react';

const ipcRenderer = window.electronAPI;

const AboutSection: React.FC = () => {
  const [version, setVersion] = useState('');

  useEffect(() => {
    ipcRenderer.invoke('update:getVersion').then(setVersion).catch(() => {});
  }, []);

  const infoItems = [
    { label: '版本', value: `v${version || '...'}` },
    { label: '作者', value: 'tomystack' },
    { label: 'GitHub', value: 'github.com/fuzz1og', link: 'https://github.com/fuzz1og' },
    { label: '技术栈', value: 'Electron + React + TypeScript' },
    { label: '数据源', value: '网易云 / QQ / 酷狗 等' },
    { label: '项目类型', value: '桌面音乐播放器' },
  ];

  return (
    <section id="about" style={{ scrollMarginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <Music size={20} color="var(--text-secondary)" />
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>关于</h2>
      </div>

      <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', padding: '24px', border: '1px solid var(--border-default)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '12px', background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-active) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'var(--shadow-md)' }}>
            <Music size={30} color="white" />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '22px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>MPlayer</div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>简约优雅的桌面音乐播放器，聚合多个音乐来源。</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '14px' }}>
          {infoItems.map((item) => (
            <div key={item.label} style={{ padding: '14px 16px', backgroundColor: 'var(--bg-base)', borderRadius: '8px', border: '1px solid var(--border-default)' }}>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>{item.label}</div>
              {item.link ? (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--accent)', fontWeight: 600, textDecoration: 'none', fontSize: '14px' }}
                >
                  <Link2 size={14} />
                  {item.value}
                </a>
              ) : (
                <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '14px' }}>{item.value}</div>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '18px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)', fontSize: '12px', color: 'var(--text-tertiary)' }}>
          <Link2 size={14} />
          开源项目，欢迎反馈与建议
        </div>
      </div>
    </section>
  );
};

export default AboutSection;
