import React, { useEffect, useState } from 'react';
import { Link, Save } from 'lucide-react';
import { message } from 'antd';

const { ipcRenderer } = window.require('electron');

const ApiSection: React.FC = () => {
  const [apiUrl, setApiUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const loadApiUrl = async () => {
    try {
      const url = await ipcRenderer.invoke('settings:getApiUrl');
      setApiUrl(url);
    } catch (error) {
      console.error('加载API地址失败:', error);
    }
  };

  useEffect(() => { loadApiUrl(); }, []);

  const handleSave = async (url: string) => {
    setIsSaving(true);
    try {
      const result = await ipcRenderer.invoke('settings:setApiUrl', url);
      if (result.success) {
        setApiUrl(url);
        message.success('API地址已保存');
      } else {
        message.error('保存失败: ' + result.error);
      }
    } catch (error) {
      console.error('保存API地址失败:', error);
      message.error('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section id="api" style={{ marginBottom: '32px', scrollMarginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <Link size={20} color="var(--text-secondary)" />
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>API 设置</h2>
      </div>
      <div style={{ backgroundColor: 'var(--content-bg)', borderRadius: '8px', padding: '24px', border: '1px solid var(--border-color)' }}>
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)', marginBottom: '8px' }}>音乐 API 服务地址</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <input
              type="text" value={apiUrl} onChange={(e) => setApiUrl(e.target.value)}
              placeholder="请输入 API 地址，例如：https://your-api.com/"
              style={{ flex: 1, padding: '10px 14px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', outline: 'none' }}
            />
            <button
              onClick={() => handleSave(apiUrl)} disabled={isSaving}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', backgroundColor: 'var(--accent-color)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: 'var(--text-base)', fontWeight: 500, cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.7 : 1 }}
            >
              <Save size={16} />保存
            </button>
          </div>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>设置音乐搜索/播放所需的 API 服务地址，保存后需重启应用生效</div>
      </div>
    </section>
  );
};

export default ApiSection;
