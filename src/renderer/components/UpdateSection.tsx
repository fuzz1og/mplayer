import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

const { ipcRenderer } = window.require('electron');

const UpdateSection: React.FC = () => {
  const [currentVersion, setCurrentVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState<string>('idle');
  const [latestVersion, setLatestVersion] = useState('');
  const [updateProgress, setUpdateProgress] = useState(0);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);

  const loadVersion = async () => {
    try {
      const ver = await ipcRenderer.invoke('update:getVersion');
      setCurrentVersion(ver);
    } catch (e) {
      console.error('获取版本号失败:', e);
    }
  };

  useEffect(() => {
    loadVersion();
  }, []);

  useEffect(() => {
    const handler = (_event: any, status: any) => {
      setUpdateStatus(status.status);
      if (status.version) setLatestVersion(status.version);
      if (status.progress) setUpdateProgress(status.progress.percent);
      if (status.status === 'idle' || status.status === 'not-available' || status.status === 'downloaded' || status.status === 'error') {
        setIsCheckingUpdate(false);
      }
    };
    ipcRenderer.on('update:status', handler);
    return () => { ipcRenderer.removeListener('update:status', handler); };
  }, []);

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    setUpdateStatus('checking');
    const safetyTimer = setTimeout(() => {
      setIsCheckingUpdate(false);
      setUpdateStatus('error');
    }, 15000);
    try {
      await ipcRenderer.invoke('update:check');
    } catch (_e) {
      // handled by update:status push
    } finally {
      clearTimeout(safetyTimer);
    }
  };

  const handleDownloadUpdate = async () => {
    setUpdateStatus('downloading');
    try {
      await ipcRenderer.invoke('update:download');
    } catch (_e) {
      // handled by update:status push
    }
  };

  const handleInstallUpdate = () => {
    ipcRenderer.invoke('update:install');
  };

  return (
    <section style={{ marginBottom: '32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <Download size={20} color="var(--accent-color)" />
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)' }}>检查更新</h2>
      </div>
      <div style={{ backgroundColor: 'var(--content-bg)', borderRadius: '12px', padding: '24px', border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)', marginBottom: '4px' }}>当前版本</div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)' }}>v{currentVersion || '...'}</div>
          </div>
          <button
            onClick={handleCheckUpdate}
            disabled={isCheckingUpdate}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 20px',
              backgroundColor: isCheckingUpdate ? 'var(--hover-bg)' : 'var(--accent-color)',
              color: isCheckingUpdate ? 'var(--text-secondary)' : '#fff',
              border: 'none', borderRadius: '8px', fontSize: 'var(--text-base)', fontWeight: 500,
              cursor: isCheckingUpdate ? 'not-allowed' : 'pointer', transition: 'all 0.15s ease',
            }}
          >
            {isCheckingUpdate ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
            {isCheckingUpdate ? '检查中...' : '检查更新'}
          </button>
        </div>

        {updateStatus === 'available' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', backgroundColor: '#00B89420', borderRadius: '8px', border: '1px solid #00B89440' }}>
            <div>
              <div style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: '#00B894', marginBottom: '4px' }}>发现新版本 v{latestVersion}</div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>点击下载按钮开始下载更新</div>
            </div>
            <button onClick={handleDownloadUpdate} style={{ padding: '8px 16px', backgroundColor: '#00B894', color: '#fff', border: 'none', borderRadius: '8px', fontSize: 'var(--text-base)', fontWeight: 500, cursor: 'pointer' }}>
              <Download size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />下载更新
            </button>
          </div>
        )}

        {updateStatus === 'downloading' && (
          <div style={{ padding: '16px', backgroundColor: '#0984E320', borderRadius: '8px', border: '1px solid #0984E340' }}>
            <div style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: '#0984E3', marginBottom: '8px' }}>正在下载更新...</div>
            <div style={{ height: '8px', backgroundColor: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${updateProgress}%`, backgroundColor: '#0984E3', borderRadius: '4px', transition: 'width 0.3s' }} />
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{updateProgress.toFixed(1)}%</div>
          </div>
        )}

        {updateStatus === 'downloaded' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', backgroundColor: '#6C5CE720', borderRadius: '8px', border: '1px solid #6C5CE740' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle size={18} color="#6C5CE7" />
              <div style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: '#6C5CE7' }}>更新已下载完成，点击安装并重启</div>
            </div>
            <button onClick={handleInstallUpdate} style={{ padding: '8px 16px', backgroundColor: '#6C5CE7', color: '#fff', border: 'none', borderRadius: '8px', fontSize: 'var(--text-base)', fontWeight: 500, cursor: 'pointer' }}>立即安装</button>
          </div>
        )}

        {updateStatus === 'not-available' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0' }}>
            <CheckCircle size={16} color="#00B894" />
            <span style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)' }}>已是最新版本</span>
          </div>
        )}

        {updateStatus === 'error' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0' }}>
            <AlertCircle size={16} color="#FF6B6B" />
            <span style={{ fontSize: 'var(--text-base)', color: '#FF6B6B' }}>检查更新失败，请检查网络连接</span>
          </div>
        )}

        {updateStatus === 'idle' && (
          <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>点击按钮检查是否有新版本可用</div>
        )}
      </div>
    </section>
  );
};

export default UpdateSection;
