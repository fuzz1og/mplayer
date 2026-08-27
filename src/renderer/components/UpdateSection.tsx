import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, CheckCircle, AlertCircle, Loader2, Gauge } from 'lucide-react';

const ipcRenderer = window.electronAPI;

interface ChannelSource {
  id: string;
  label: string;
}

interface SpeedResult {
  id: string;
  label: string;
  latencyMs: number | null;
}

const UpdateSection: React.FC = () => {
  const [currentVersion, setCurrentVersion] = useState('');
  const [updateStatus, setUpdateStatus] = useState<string>('idle');
  const [latestVersion, setLatestVersion] = useState('');
  const [updateProgress, setUpdateProgress] = useState(0);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  // 更新通道（#262）：auto=自动测速排序；手动选择把该源排最前
  const [channelSources, setChannelSources] = useState<ChannelSource[]>([]);
  const [channel, setChannelState] = useState<string>('auto');
  const [speedResults, setSpeedResults] = useState<SpeedResult[] | null>(null);
  const [isTestingSpeed, setIsTestingSpeed] = useState(false);
  const [activeChannelLabel, setActiveChannelLabel] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadChannels = async () => {
    try {
      const res = await ipcRenderer.invoke('update:getChannels');
      if (res) {
        setChannelSources(res.sources || []);
        setChannelState(res.channel || 'auto');
      }
    } catch (e) {
      console.error('获取更新通道失败:', e);
    }
  };

  const handleSetChannel = async (value: string) => {
    setChannelState(value); // 乐观更新，失败回读
    try {
      const res = await ipcRenderer.invoke('update:setChannel', value);
      if (!res?.success) {
        console.error('设置更新通道失败:', res?.error);
        loadChannels();
      }
    } catch (e) {
      console.error('设置更新通道失败:', e);
      loadChannels();
    }
  };

  const handleSpeedTest = async () => {
    setIsTestingSpeed(true);
    try {
      // registerIpcHandler 统一封套：{ success, data | error }
      const res = await ipcRenderer.invoke('update:speedTest');
      if (res?.success) {
        setSpeedResults(res.data || []);
      } else {
        console.error('测速失败:', res?.error);
      }
    } catch (e) {
      console.error('测速失败:', e);
    } finally {
      setIsTestingSpeed(false);
    }
  };

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
    loadChannels();
  }, []);

  useEffect(() => {
    const handler = (_event: any, status: any) => {
      setUpdateStatus(status.status);
      if (status.version) setLatestVersion(status.version);
      if (status.progress) setUpdateProgress(status.progress.percent);
      if (status.sourceLabel) setActiveChannelLabel(status.sourceLabel);
      setErrorMsg(status.error || '');
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
    <section id="update" style={{ marginBottom: '32px', scrollMarginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <Download size={20} color="var(--text-secondary)" />
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>检查更新</h2>
      </div>

      {/* 更新通道（#262）：镜像优先、GitHub 直连兜底；auto 按测速延迟排序，也可手动指定置顶 */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>更新通道</span>
        <select
          value={channel}
          onChange={(e) => handleSetChannel(e.target.value)}
          style={{
            padding: '6px 10px', backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)',
            border: '1px solid var(--border-default)', borderRadius: '8px', fontSize: '13px', cursor: 'pointer',
          }}
        >
          <option value="auto">自动（测速择优）</option>
          {channelSources.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <button
          onClick={handleSpeedTest}
          disabled={isTestingSpeed}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px',
            backgroundColor: 'transparent', color: 'var(--text-secondary)',
            border: '1px solid var(--border-default)', borderRadius: '8px', fontSize: '13px',
            cursor: isTestingSpeed ? 'not-allowed' : 'pointer', transition: 'all 0.15s ease',
          }}
        >
          {isTestingSpeed ? <Loader2 size={14} className="animate-spin" /> : <Gauge size={14} />}
          测速
        </button>
        {speedResults && (
          <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
            {speedResults.map((r) => `${r.label.replace(' 镜像', '')} ${r.latencyMs == null ? '超时' : `${r.latencyMs}ms`}`).join(' · ')}
          </span>
        )}
      </div>

      <div style={{ backgroundColor: 'var(--bg-surface)', borderRadius: '8px', padding: '24px', border: '1px solid var(--border-default)' }}>
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
              backgroundColor: isCheckingUpdate ? 'var(--bg-hover)' : 'var(--accent)',
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', backgroundColor: 'var(--success-subtle)', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)' }}>
            <div>
              <div style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--success)', marginBottom: '4px' }}>发现新版本 v{latestVersion}</div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>点击下载按钮开始下载更新</div>
            </div>
            <button onClick={handleDownloadUpdate} style={{ padding: '8px 16px', backgroundColor: 'var(--success)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: 'var(--text-base)', fontWeight: 500, cursor: 'pointer' }}>
              <Download size={14} style={{ marginRight: '4px', verticalAlign: 'middle' }} />下载更新
            </button>
          </div>
        )}

        {updateStatus === 'downloading' && (
          <div style={{ padding: '16px', backgroundColor: 'var(--accent-subtle)', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--accent) 30%, transparent)' }}>
            <div style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--accent-text)', marginBottom: '8px' }}>
              正在下载更新{activeChannelLabel ? `（通道：${activeChannelLabel}）` : ''}
            </div>
            <div style={{ height: '8px', backgroundColor: 'var(--border-default)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${updateProgress}%`, backgroundColor: 'var(--accent)', borderRadius: '4px', transition: 'width 0.3s' }} />
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>{updateProgress.toFixed(1)}%</div>
          </div>
        )}

        {updateStatus === 'downloaded' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px', backgroundColor: 'var(--info-subtle)', borderRadius: '8px', border: '1px solid color-mix(in srgb, var(--info) 30%, transparent)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle size={18} color="var(--info)" />
              <div style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--info)' }}>更新已下载完成，点击安装并重启</div>
            </div>
            <button onClick={handleInstallUpdate} style={{ padding: '8px 16px', backgroundColor: 'var(--info)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: 'var(--text-base)', fontWeight: 500, cursor: 'pointer' }}>立即安装</button>
          </div>
        )}

        {updateStatus === 'not-available' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0' }}>
            <CheckCircle size={16} color="var(--success)" />
            <span style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)' }}>已是最新版本</span>
          </div>
        )}

        {updateStatus === 'error' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 0' }}>
            <AlertCircle size={16} color="var(--danger)" />
            <span style={{ fontSize: 'var(--text-base)', color: 'var(--danger)' }}>
              {errorMsg ? `更新失败：${errorMsg}` : '更新失败，请检查网络连接'}
            </span>
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
