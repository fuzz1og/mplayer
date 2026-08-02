import React, { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { message } from 'antd';

const { ipcRenderer } = window.require('electron');

interface ProxyConfig {
  enabled: boolean;
  protocol: 'http' | 'https';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

const ProxySection: React.FC = () => {
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyProtocol, setProxyProtocol] = useState<'http' | 'https'>('http');
  const [proxyHost, setProxyHost] = useState('');
  const [proxyPort, setProxyPort] = useState('8080');
  const [proxyUsername, setProxyUsername] = useState('');
  const [proxyPassword, setProxyPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const loadProxyConfig = async () => {
    try {
      const proxy: ProxyConfig = await ipcRenderer.invoke('settings:getProxy');
      setProxyEnabled(proxy.enabled);
      setProxyProtocol(proxy.protocol);
      setProxyHost(proxy.host);
      setProxyPort(String(proxy.port));
      setProxyUsername(proxy.username || '');
      setProxyPassword(proxy.password || '');
    } catch (error) {
      console.error('加载代理设置失败:', error);
    }
  };

  useEffect(() => { loadProxyConfig(); }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const proxyConfig: ProxyConfig = {
        enabled: proxyEnabled, protocol: proxyProtocol, host: proxyHost,
        port: parseInt(proxyPort, 10) || 8080,
      };
      if (proxyUsername) proxyConfig.username = proxyUsername;
      if (proxyPassword) proxyConfig.password = proxyPassword;
      const result = await ipcRenderer.invoke('settings:setProxy', proxyConfig);
      if (result.success) {
        message.success('代理设置已保存并立即生效');
      } else {
        message.error('保存失败: ' + result.error);
      }
    } catch (error) {
      console.error('保存代理设置失败:', error);
      message.error('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '8px 12px', backgroundColor: 'var(--bg-color)',
    border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', outline: 'none',
  };

  return (
    <section id="proxy" style={{ marginBottom: '32px', scrollMarginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <Shield size={20} color="var(--text-secondary)" />
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>网络代理设置</h2>
      </div>
      <div style={{ backgroundColor: 'var(--content-bg)', borderRadius: '8px', padding: '24px', border: '1px solid var(--border-color)' }}>
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginBottom: '16px' }}>
            <input type="checkbox" checked={proxyEnabled} onChange={(e) => setProxyEnabled(e.target.checked)} style={{ width: '18px', height: '18px', accentColor: 'var(--accent-color)', cursor: 'pointer' }} />
            <span style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', fontWeight: 500 }}>启用代理</span>
          </label>

          {proxyEnabled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <div style={{ flex: '0 0 80px' }}>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '4px' }}>协议</div>
                  <select value={proxyProtocol} onChange={(e) => setProxyProtocol(e.target.value as 'http' | 'https')} style={inputStyle}>
                    <option value="http">HTTP</option>
                    <option value="https">HTTPS</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '4px' }}>主机地址</div>
                  <input type="text" value={proxyHost} onChange={(e) => setProxyHost(e.target.value)} placeholder="例如: 127.0.0.1" style={inputStyle} />
                </div>
                <div style={{ flex: '0 0 100px' }}>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '4px' }}>端口</div>
                  <input type="number" value={proxyPort} onChange={(e) => setProxyPort(e.target.value)} placeholder="8080" min={1} max={65535} style={inputStyle} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '4px' }}>用户名 (可选)</div>
                  <input type="text" value={proxyUsername} onChange={(e) => setProxyUsername(e.target.value)} placeholder="proxy username" style={inputStyle} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '4px' }}>密码 (可选)</div>
                  <input type="password" value={proxyPassword} onChange={(e) => setProxyPassword(e.target.value)} placeholder="proxy password" style={inputStyle} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={handleSave} disabled={isSaving}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', backgroundColor: 'var(--accent-color)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: 'var(--text-base)', fontWeight: 500, cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.7 : 1 }}
          >
            保存代理设置
          </button>
        </div>
        <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--text-tertiary)' }}>配置后立即生效，无需重启应用。默认不使用系统代理。</div>
      </div>
    </section>
  );
};

export default ProxySection;
