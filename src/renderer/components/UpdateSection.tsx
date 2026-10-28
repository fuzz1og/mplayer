import React, { useState, useEffect } from 'react';
import { Download, RefreshCw, Loader2, Gauge } from 'lucide-react';
import { useUpdateStore } from '@/renderer/store/updateStore';
import { Alert, Button, Group, Progress, Row, Section } from '@/renderer/ui';

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

/**
 * 设置页「更新」区段（#262 + #579）。状态来自 useUpdateStore（主进程 push + 首帧快照），
 * 组件不自己持有更新状态——同一份状态还要驱动侧栏徽标（ADR 不变量 I2）。
 */
const UpdateSection: React.FC = () => {
  const [currentVersion, setCurrentVersion] = useState('');
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [channelSources, setChannelSources] = useState<ChannelSource[]>([]);
  const [channel, setChannelState] = useState<string>('auto');
  const [speedResults, setSpeedResults] = useState<SpeedResult[] | null>(null);
  const [isTestingSpeed, setIsTestingSpeed] = useState(false);
  const [browserUrl, setBrowserUrl] = useState('');
  const [actionError, setActionError] = useState('');

  const updateStatus = useUpdateStore((s) => s.status);
  const latestVersion = useUpdateStore((s) => s.version);
  const updateProgress = useUpdateStore((s) => s.progress);
  const activeChannelLabel = useUpdateStore((s) => s.sourceLabel);
  const errorMsg = useUpdateStore((s) => s.error);

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
    setChannelState(value);
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
      const res = await ipcRenderer.invoke('update:speedTest');
      if (res?.success) setSpeedResults(res.data || []);
      else console.error('测速失败:', res?.error);
    } catch (e) {
      console.error('测速失败:', e);
    } finally {
      setIsTestingSpeed(false);
    }
  };

  const loadVersion = async () => {
    try {
      setCurrentVersion(await ipcRenderer.invoke('update:getVersion'));
    } catch (e) {
      console.error('获取版本号失败:', e);
    }
  };

  useEffect(() => {
    loadVersion();
    loadChannels();
  }, []);

  useEffect(() => {
    if (['idle', 'not-available', 'available', 'downloaded', 'error'].includes(updateStatus)) {
      setIsCheckingUpdate(false);
    }
  }, [updateStatus]);

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    setBrowserUrl('');
    setActionError('');
    try {
      await ipcRenderer.invoke('update:check');
    } catch (_e) {
      // 结果经 update:status push 回来
    }
  };

  const handleDownloadUpdate = async () => {
    try {
      const res = await ipcRenderer.invoke('update:downloadInBrowser');
      if (res?.success && res.data?.ok) setBrowserUrl(res.data.url || '');
      else setActionError(res?.data?.error || res?.error || '打开浏览器失败');
    } catch (e) {
      console.error('跳转浏览器下载失败:', e);
      setActionError('打开浏览器失败');
    }
  };

  const handleSilentDownload = () => {
    setActionError('');
    void ipcRenderer.invoke('update:download');
  };

  const handleInstallUpdate = async () => {
    setActionError('');
    try {
      const res = await ipcRenderer.invoke('update:install');
      if (!res?.success || !res.data?.ok) setActionError(res?.data?.error || res?.error || '安装失败，请稍后重试');
    } catch (e) {
      console.error('启动更新安装失败:', e);
      setActionError('安装失败，请稍后重试');
    }
  };

  const speedSummary = speedResults
    ?.map((r) => `${r.label.replace(' 镜像', '')} ${r.latencyMs == null ? '超时' : `${r.latencyMs}ms`}`)
    .join(' · ');

  return (
    <section id="update">
      <div className="settings-page__title">
        <Download size={16} aria-hidden="true" />
        <h1>更新</h1>
      </div>
      <div className="settings-page__stack">
        <Section
          title="更新通道"
          footer={speedSummary ? `测速结果：${speedSummary}` : '自动按镜像测速择优，失败回落 GitHub 直连。'}
        >
          <Group>
            <div className="settings-page__field">
              <div className="settings-page__field-label">通道</div>
              <select
                className="settings-page__select"
                aria-label="更新通道"
                value={channel}
                onChange={(e) => void handleSetChannel(e.target.value)}
              >
                <option value="auto">自动（测速择优）</option>
                {channelSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label}
                  </option>
                ))}
              </select>
            </div>
            <Row
              label="测速"
              detail={isTestingSpeed ? '测速中…' : '比较各镜像延迟'}
              trailing={
                <Button size="sm" icon={<Gauge size={13} />} disabled={isTestingSpeed} onClick={() => void handleSpeedTest()}>
                  开始测速
                </Button>
              }
            />
          </Group>
        </Section>

        <Section title="版本">
          <Group>
            <Row label="已安装" detail={`v${currentVersion || '...'}`} />
            <Row
              label="检查更新"
              detail={isCheckingUpdate ? '检查中…' : updateStatus === 'available' ? `发现 v${latestVersion}` : '手动检查一次'}
              trailing={
                <Button
                  size="sm"
                  variant="primary"
                  disabled={isCheckingUpdate}
                  icon={isCheckingUpdate ? <Loader2 size={13} /> : <RefreshCw size={13} />}
                  onClick={() => void handleCheckUpdate()}
                >
                  {isCheckingUpdate ? '检查中' : '检查'}
                </Button>
              }
            />
          </Group>
        </Section>

        {updateStatus === 'available' && (
          <Alert
            tone="success"
            title={`发现新版本 v${latestVersion}`}
            action={
              <div className="settings-page__actions">
                <Button size="sm" icon={<Download size={13} />} onClick={handleSilentDownload}>
                  静默下载
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void handleDownloadUpdate()}>
                  浏览器下载
                </Button>
              </div>
            }
          >
            已在后台准备下载；也可以交给系统浏览器下载安装包。
          </Alert>
        )}

        {updateStatus === 'downloading' && (
          <div className="settings-page__stack">
            <Alert tone="info" title={`正在静默下载更新${activeChannelLabel ? `（通道：${activeChannelLabel}）` : ''}`}>
              下载完成后可直接安装并重启。
            </Alert>
            <Progress value={updateProgress} ariaLabel="下载进度" label={`${updateProgress.toFixed(1)}%`} />
          </div>
        )}

        {updateStatus === 'downloaded' && (
          <Alert
            tone="success"
            title={`v${latestVersion} 已下载`}
            action={
              <Button size="sm" variant="primary" onClick={() => void handleInstallUpdate()}>
                退出并安装
              </Button>
            }
          >
            安装会退出应用并重启。
          </Alert>
        )}

        {browserUrl && <Alert tone="info" title="已跳转浏览器下载">浏览器完成后，用新安装包覆盖安装即可完成更新。</Alert>}
        {(actionError || errorMsg) && <Alert tone="danger" title="更新失败">{actionError || errorMsg}</Alert>}
      </div>
    </section>
  );
};

export default UpdateSection;
