import React, { useEffect, useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';

const { ipcRenderer } = window.require('electron');

const TitleBar: React.FC = () => {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    ipcRenderer.invoke('window:isMaximized').then(setMaximized).catch(() => {});
    const handleMaximized = (_event: unknown, value: boolean) => setMaximized(value);
    ipcRenderer.on('window:maximized', handleMaximized);
    return () => {
      ipcRenderer.removeListener('window:maximized', handleMaximized);
    };
  }, []);

  return (
    <div
      style={{
        height: '36px',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--divider-color)',
        userSelect: 'none',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '14px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
        <img src="./icon.png" alt="" style={{ width: '16px', height: '16px', borderRadius: '4px', objectFit: 'contain' }} />
        <span>MPlayer</span>
      </div>

      <div style={{ display: 'flex', height: '100%', WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={() => ipcRenderer.invoke('window:minimize')}
          aria-label="最小化"
          style={buttonStyle}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => ipcRenderer.invoke('window:toggleMaximize')}
          aria-label={maximized ? '还原' : '最大化'}
          style={buttonStyle}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--hover-bg)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {maximized ? <Copy size={12} /> : <Square size={11} />}
        </button>
        <button
          onClick={() => ipcRenderer.invoke('window:close')}
          aria-label="关闭"
          style={buttonStyle}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#E81123';
            e.currentTarget.style.color = '#fff';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

const buttonStyle: React.CSSProperties = {
  width: '46px',
  height: '100%',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-secondary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  transition: 'background 0.15s ease, color 0.15s ease',
};

export default TitleBar;
