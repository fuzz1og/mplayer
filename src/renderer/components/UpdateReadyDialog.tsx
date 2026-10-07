import React, { useEffect, useState } from 'react';
import { Modal, Button } from 'antd';
import { Download, AlertCircle } from 'lucide-react';
import { useUpdateStore } from '@/renderer/store/updateStore';

const ipcRenderer = window.electronAPI;

/**
 * 「更新已下载，立即安装？」确认框（#579 / ADR 决策 4、5）。
 *
 * 为什么必须有这个框：Windows 上正在运行的 exe 被占用就装不了，所以安装**必须先退出应用**；
 * 而「退出用户正在用的应用」不能替他决定，得先问。
 *
 * 确认后走 `update:install` → `quitAndInstall(true, true)`：静默安装（`/S`）+ 装完自动重启
 * （`--force-run`）。静默的前提正是这个框已经拿到了用户同意——不再需要安装器自己再问一遍。
 *
 * 选「稍后」只是收起这个框：徽标与设置页入口都还在，而且 `autoInstallOnAppQuit` 仍然为真，
 * 用户正常退出应用时会把更新装上（只是不会自动重启）。
 */
const UpdateReadyDialog: React.FC = () => {
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');

  // 状态离开 downloaded（新一轮检查/下载）后把「稍后」复位，下次下好还要再问一次
  useEffect(() => {
    if (status !== 'downloaded') {
      setDismissed(false);
      setInstalling(false);
      setError('');
    }
  }, [status]);

  const handleInstall = async () => {
    setInstalling(true);
    setError('');
    try {
      const res = await ipcRenderer.invoke('update:install');
      if (!res?.success || !res.data?.ok) {
        setError(res?.data?.error || res?.error || '安装失败，请稍后重试');
        setInstalling(false);
      }
      // 成功时进程随即退出（安装器接管），这里不需要再改状态
    } catch (e) {
      console.error('启动更新安装失败:', e);
      setError('安装失败，请稍后重试');
      setInstalling(false);
    }
  };

  return (
    <Modal
      open={status === 'downloaded' && !dismissed}
      onCancel={() => setDismissed(true)}
      footer={null}
      width={440}
      maskClosable={false}
      destroyOnClose
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Download size={18} color="var(--accent)" />
          <span>更新已就绪</span>
        </div>
      }
    >
      <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', lineHeight: 1.7 }}>
        新版本{version ? ` v${version}` : ''}已下载完成。安装需要先退出应用，装完会自动重新打开。
      </div>

      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '12px' }}>
          <AlertCircle size={16} color="var(--danger)" />
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{error}</span>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '20px' }}>
        <Button onClick={() => setDismissed(true)} disabled={installing}>
          稍后
        </Button>
        <Button
          type="primary"
          onClick={handleInstall}
          loading={installing}
          style={{ backgroundColor: 'var(--accent)' }}
        >
          立即安装并重启
        </Button>
      </div>
    </Modal>
  );
};

export default UpdateReadyDialog;
