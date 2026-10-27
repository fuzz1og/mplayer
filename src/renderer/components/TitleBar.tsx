import React, { useEffect, useState } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';

const ipcRenderer = window.electronAPI;

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
    <div className="titlebar">
      <div className="titlebar__brand">
        <img className="titlebar__brand-icon" src="./icon.png" alt="" />
        <span>MPlayer</span>
      </div>

      <div className="titlebar__controls">
        <button type="button" className="titlebar__btn" onClick={() => ipcRenderer.invoke('window:minimize')} aria-label="最小化">
          <Minus size={14} />
        </button>
        <button
          type="button"
          className="titlebar__btn"
          onClick={() => ipcRenderer.invoke('window:toggleMaximize')}
          aria-label={maximized ? '还原' : '最大化'}
        >
          {maximized ? <Copy size={12} /> : <Square size={11} />}
        </button>
        <button
          type="button"
          className="titlebar__btn titlebar__btn--close"
          onClick={() => ipcRenderer.invoke('window:close')}
          aria-label="关闭"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
