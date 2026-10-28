import React, { useEffect, useState } from 'react';
import { Folder, RefreshCw } from 'lucide-react';
import { Button, Group, Input, Row, Section, useToast, InfoHint } from '@/renderer/ui';

const ipcRenderer = window.electronAPI;

const DownloadSection: React.FC = () => {
  const [downloadPath, setDownloadPath] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { show } = useToast();

  const loadDownloadPath = async () => {
    try {
      const path = await ipcRenderer.invoke('settings:getDownloadPath');
      setDownloadPath(path);
    } catch (error) {
      console.error('加载下载目录失败:', error);
    }
  };

  useEffect(() => { loadDownloadPath(); }, []);

  const handleSave = async (path: string) => {
    setIsSaving(true);
    try {
      const result = await ipcRenderer.invoke('settings:setDownloadPath', path);
      if (result.success) show('下载目录已更新', { tone: 'success' });
      else show('更新失败: ' + result.error, { tone: 'danger' });
    } catch (error) {
      console.error('保存下载目录失败:', error);
      show('保存失败', { tone: 'danger' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectDirectory = async () => {
    try {
      // #670：显式声明用途 'download'，与「添加本地音乐文件夹」共用通道但分开记忆。
      const result = await ipcRenderer.invoke('dialog:openDirectory', 'download');
      if (result && !result.canceled && result.filePaths.length > 0) {
        const newPath = result.filePaths[0];
        setDownloadPath(newPath);
        await handleSave(newPath);
      }
    } catch (error) {
      console.error('选择目录失败:', error);
    }
  };

  const handleReset = async () => {
    setIsSaving(true);
    try {
      const result = await ipcRenderer.invoke('settings:resetDownloadPath');
      if (result.success) {
        setDownloadPath(result.path);
        show('已重置为默认下载目录', { tone: 'success' });
      } else {
        show('重置失败: ' + result.error, { tone: 'danger' });
      }
    } catch (error) {
      console.error('重置下载目录失败:', error);
      show('重置失败', { tone: 'danger' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section id="download">
      <div className="settings-page__title">
        <Folder size={16} aria-hidden="true" />
        <h1>下载</h1>
      </div>
      <div className="settings-page__stack">
        <Section title={<>{'下载目录'} <InfoHint label="下载目录">目录变更后立即生效，下载中的任务保持原目录。</InfoHint></>}>
          <Group>
            <div className="settings-page__field">
              <Input aria-label="下载目录" value={downloadPath} readOnly placeholder="加载中…" />
            </div>
            <Row
              label="选择目录"
              detail="打开系统选择框"
              trailing={
                <Button size="sm" variant="primary" disabled={isSaving} onClick={handleSelectDirectory}>
                  选择
                </Button>
              }
            />
            <Row
              label="重置为默认目录"
              detail="恢复到系统默认下载位置"
              trailing={
                <Button size="sm" icon={<RefreshCw size={13} />} disabled={isSaving} onClick={handleReset}>
                  重置
                </Button>
              }
            />
          </Group>
        </Section>
      </div>
    </section>
  );
};

export default DownloadSection;
