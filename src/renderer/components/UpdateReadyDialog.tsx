import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { useUpdateStore } from '@/renderer/store/updateStore';
import { Button, Dialog } from '@/renderer/ui';

const ipcRenderer = window.electronAPI;

/**
 * 为什么必须有这个框：Windows 上正在运行的 exe 被占用就装不了，所以安装**必须先退出应用**；而「退出
 * 用户正在用的应用」不能替他决定，得先问。
 */
const UpdateReadyDialog: React.FC = () => {
  const status = useUpdateStore((s) => s.status);
  const version = useUpdateStore((s) => s.version);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');

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
    } catch (e) {
      console.error('启动更新安装失败:', e);
      setError('安装失败，请稍后重试');
      setInstalling(false);
    }
  };

  return (
    <Dialog
      open={status === 'downloaded' && !dismissed}
      title={
        <span className="update-ready__title">
          <Download size={16} aria-hidden="true" />
          更新已就绪
        </span>
      }
      onClose={() => setDismissed(true)}
      size="sm"
      footer={
        <>
          <Button variant="ghost" disabled={installing} onClick={() => setDismissed(true)}>
            稍后
          </Button>
          <Button variant="primary" disabled={installing} onClick={() => void handleInstall()}>
            {installing ? '正在安装…' : '立即安装并重启'}
          </Button>
        </>
      }
    >
      <p className="update-ready__body">
        新版本{version ? ` v${version}` : ''}已下载完成。安装需要先退出应用，装完会自动重新打开。
      </p>
      {error ? <p className="update-ready__error">{error}</p> : null}
    </Dialog>
  );
};

export default UpdateReadyDialog;
