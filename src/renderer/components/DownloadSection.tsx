import React, { useEffect, useState } from 'react';
import { Folder, RefreshCw } from 'lucide-react';
import { message } from 'antd';

const { ipcRenderer } = window.require('electron');

const DownloadSection: React.FC = () => {
  const [downloadPath, setDownloadPath] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const loadDownloadPath = async () => {
    try {
      const path = await ipcRenderer.invoke('settings:getDownloadPath');
      setDownloadPath(path);
    } catch (error) {
      console.error('加载下载目录失败:', error);
    }
  };

  useEffect(() => { loadDownloadPath(); }, []);

  const handleSelectDirectory = async () => {
    try {
      const result = await ipcRenderer.invoke('dialog:openDirectory');
      if (result && !result.canceled && result.filePaths.length > 0) {
        const newPath = result.filePaths[0];
        setDownloadPath(newPath);
        await handleSave(newPath);
      }
    } catch (error) {
      console.error('选择目录失败:', error);
    }
  };

  const handleSave = async (path: string) => {
    setIsSaving(true);
    try {
      const result = await ipcRenderer.invoke('settings:setDownloadPath', path);
      if (result.success) {
        message.success('下载目录已更新');
      } else {
        message.error('更新失败: ' + result.error);
      }
    } catch (error) {
      console.error('保存下载目录失败:', error);
      message.error('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setIsSaving(true);
    try {
      const result = await ipcRenderer.invoke('settings:resetDownloadPath');
      if (result.success) {
        setDownloadPath(result.path);
        message.success('已重置为默认下载目录');
      } else {
        message.error('重置失败: ' + result.error);
      }
    } catch (error) {
      console.error('重置下载目录失败:', error);
      message.error('重置失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section style={{ marginBottom: '32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <Folder size={20} color="var(--accent-color)" />
        <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)' }}>下载设置</h2>
      </div>
      <div style={{ backgroundColor: 'var(--content-bg)', borderRadius: '12px', padding: '24px', border: '1px solid var(--border-color)' }}>
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)', marginBottom: '8px' }}>默认下载目录</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ flex: 1, padding: '10px 14px', backgroundColor: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: 'var(--text-sm)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {downloadPath || '加载中...'}
            </div>
            <button
              onClick={handleSelectDirectory} disabled={isSaving}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', backgroundColor: 'var(--accent-color)', color: 'white', border: 'none', borderRadius: '8px', fontSize: 'var(--text-base)', fontWeight: 500, cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.7 : 1, transition: 'all 0.15s ease' }}
            >
              <Folder size={16} />选择目录
            </button>
            <button
              onClick={handleReset} disabled={isSaving}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', backgroundColor: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: 'var(--text-base)', fontWeight: 500, cursor: isSaving ? 'not-allowed' : 'pointer', opacity: isSaving ? 0.7 : 1, transition: 'all 0.15s ease' }}
            >
              <RefreshCw size={16} />重置
            </button>
          </div>
        </div>
        <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>下载的音乐文件将保存到此目录</div>
      </div>
    </section>
  );
};

export default DownloadSection;
