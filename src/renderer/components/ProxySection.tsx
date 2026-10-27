import React, { useEffect, useState } from 'react';
import { Shield } from 'lucide-react';
import { Button, Group, Input, Row, Section, Segmented, Switch, useToast } from '@/renderer/ui';

const ipcRenderer = window.electronAPI;

interface ProxyConfig {
  enabled: boolean;
  protocol: 'http' | 'https';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/** 网络：代理与 TLS 指纹在同一页（1.9.0 起两者不再各占导航项）。 */
const ProxySection: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [protocol, setProtocol] = useState<'http' | 'https'>('http');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('8080');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { show } = useToast();

  const loadProxyConfig = async () => {
    try {
      const proxy: ProxyConfig = await ipcRenderer.invoke('settings:getProxy');
      setEnabled(proxy.enabled);
      setProtocol(proxy.protocol);
      setHost(proxy.host);
      setPort(String(proxy.port));
      setUsername(proxy.username || '');
      setPassword(proxy.password || '');
    } catch (error) {
      console.error('加载代理设置失败:', error);
    }
  };

  useEffect(() => { loadProxyConfig(); }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const config: ProxyConfig = {
        enabled,
        protocol,
        host,
        port: parseInt(port, 10) || 8080,
      };
      if (username) config.username = username;
      if (password) config.password = password;
      const result = await ipcRenderer.invoke('settings:setProxy', config);
      if (result.success) show('代理设置已保存并立即生效', { tone: 'success' });
      else show('保存失败: ' + result.error, { tone: 'danger' });
    } catch (error) {
      console.error('保存代理设置失败:', error);
      show('保存失败', { tone: 'danger' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section id="proxy">
      <div className="settings-page__title">
        <Shield size={16} aria-hidden="true" />
        <h1>网络</h1>
      </div>
      <div className="settings-page__lead">代理与 TLS 指纹都只影响出网请求，改完立即生效，无需重启。</div>

      <div className="settings-page__stack">
        <Section title="代理" footer="默认不使用系统代理；留空表示直连。">
          <Group>
            <Row
              label="启用代理"
              detail={enabled ? '已启用' : '未启用'}
              trailing={<Switch checked={enabled} onChange={setEnabled} ariaLabel="启用代理" />}
            />
            <Row
              label="协议"
              trailing={
                <Segmented
                  options={['http', 'https'] as const}
                  value={protocol}
                  onChange={(value) => setProtocol(value as 'http' | 'https')}
                  size="sm"
                  ariaLabel="代理协议"
                />
              }
            />
            <div className="settings-page__field">
              <div className="settings-page__field-label">主机地址</div>
              <Input aria-label="代理主机" value={host} onChange={(e) => setHost(e.target.value)} placeholder="例如 127.0.0.1" disabled={!enabled} />
            </div>
            <div className="settings-page__field">
              <div className="settings-page__field-label">端口</div>
              <Input aria-label="代理端口" value={port} onChange={(e) => setPort(e.target.value)} placeholder="8080" disabled={!enabled} inputMode="numeric" />
            </div>
            <div className="settings-page__field">
              <div className="settings-page__field-label">用户名（可选）</div>
              <Input aria-label="代理用户名" value={username} onChange={(e) => setUsername(e.target.value)} disabled={!enabled} />
            </div>
            <div className="settings-page__field">
              <div className="settings-page__field-label">密码（可选）</div>
              <Input aria-label="代理密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={!enabled} />
            </div>
            <div className="settings-page__actions">
              <Button variant="primary" disabled={isSaving} onClick={handleSave}>
                保存代理设置
              </Button>
            </div>
          </Group>
        </Section>
      </div>
    </section>
  );
};

export default ProxySection;
