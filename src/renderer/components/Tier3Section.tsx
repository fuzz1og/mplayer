import React, { useEffect, useState } from 'react';
import { FlaskConical, Plus, Trash2, RefreshCw, FileJson, Link } from 'lucide-react';
import { Button, Input, Switch, Tag, message, Typography } from 'antd';
import type { Tier3State, Tier3Subscription } from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';

/**
 * tier3 第三方解析源订阅执行器（#144）设置区。
 * 默认彻底关闭；订阅源支持 URL / 本地 JSON 文件 / 手动粘贴，公开仓库零端点。
 * 实验性功能：第三方源随时可能失效，失败自动降级回官方/换元。
 */

const { TextArea } = Input;
const { Text } = Typography;

const Tier3Section: React.FC = () => {
  const [state, setState] = useState<Tier3State | null>(null);
  const [stats, setStats] = useState<Record<string, { hits: number; misses: number }> | null>(null);
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    try {
      const data = await IpcClient.invoke<Tier3State>('settings:getTier3State');
      setState(data);
      // 仅在开关开启且有订阅时展示每源累计命中/失败统计
      if (data.enabled && data.subscriptions.length > 0) {
        const statData = await IpcClient.invoke<Record<string, { hits: number; misses: number }>>('settings:getTier3Stats');
        setStats(statData);
      } else {
        setStats(null);
      }
    } catch (error) {
      console.error('加载 tier3 设置失败:', error);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleToggle = async (value: boolean): Promise<void> => {
    if (!state) return;
    setState({ ...state, enabled: value });
    try {
      await IpcClient.invoke('settings:setTier3Enabled', value);
      message.success(value ? '已开启第三方解析源（实验性）' : '已关闭第三方解析源');
      await refresh();
    } catch (error) {
      console.error('保存 tier3 开关失败:', error);
      void load();
    }
  };

  const refresh = async (): Promise<void> => {
    await load();
  };

  const addUrl = async (): Promise<void> => {
    const trimmed = url.trim();
    if (!/^https?:\/\/.+/.test(trimmed)) {
      message.warning('请输入 http(s) 开头的订阅 URL');
      return;
    }
    setBusy(true);
    try {
      await IpcClient.invoke('settings:addTier3Url', { url: trimmed });
      setUrl('');
      await refresh();
      message.success('URL 订阅已添加');
    } catch (error) {
      console.error('添加 URL 订阅失败:', error);
      message.error(error instanceof Error ? error.message : '添加 URL 订阅失败');
    } finally {
      setBusy(false);
    }
  };

  const addFile = async (): Promise<void> => {
    setBusy(true);
    try {
      const file = await IpcClient.invoke<{ name: string; content: string; source: string } | null>('dialog:openTier3File');
      if (!file) return;
      await IpcClient.invoke('settings:addTier3Text', {
        name: file.name,
        text: file.content,
        kind: 'file',
        source: file.source,
      });
      await refresh();
      message.success('本地文件订阅已添加');
    } catch (error) {
      console.error('添加本地文件订阅失败:', error);
      message.error(error instanceof Error ? error.message : '添加本地文件订阅失败');
    } finally {
      setBusy(false);
    }
  };

  const addPaste = async (): Promise<void> => {
    if (!paste.trim()) {
      message.warning('请粘贴 JSON 音源清单');
      return;
    }
    setBusy(true);
    try {
      await IpcClient.invoke('settings:addTier3Text', { text: paste });
      setPaste('');
      await refresh();
      message.success('粘贴清单已添加');
    } catch (error) {
      console.error('添加粘贴清单失败:', error);
      message.error(error instanceof Error ? error.message : '添加粘贴清单失败');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      await IpcClient.invoke('settings:removeTier3Subscription', id);
      await refresh();
      message.success('订阅已删除');
    } catch (error) {
      console.error('删除订阅失败:', error);
      message.error(error instanceof Error ? error.message : '删除订阅失败');
    }
  };

  const refreshSub = async (id: string): Promise<void> => {
    try {
      await IpcClient.invoke('settings:refreshTier3Subscription', id);
      await refresh();
      message.success('订阅已刷新');
    } catch (error) {
      console.error('刷新订阅失败:', error);
      message.error(error instanceof Error ? error.message : '刷新订阅失败');
    }
  };

  const kindLabel = (kind: Tier3Subscription['kind']): string => {
    if (kind === 'url') return 'URL';
    if (kind === 'file') return '本地文件';
    return '粘贴';
  };

  const sourceName = (sourceId: string): string => {
    for (const sub of state?.subscriptions ?? []) {
      const hit = sub.manifest.sources.find((s) => s.id === sourceId);
      if (hit) return hit.name || hit.id;
    }
    return sourceId;
  };

  return (
    <section id="tier3" style={{ marginBottom: '32px', scrollMarginTop: '16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <FlaskConical size={15} color="var(--text-secondary)" />
        <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>第三方解析源（tier3）</h2>
        <Tag color="orange" style={{ marginInlineEnd: 0 }}>实验性</Tag>
      </div>
      <div style={{ backgroundColor: 'var(--content-bg)', borderRadius: '8px', padding: '20px', border: '1px solid var(--border-color)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <Switch checked={!!state?.enabled} loading={!state} onChange={(v) => void handleToggle(v)} />
          <span style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500 }}>
            {state?.enabled ? '已开启' : '已关闭'}
          </span>
        </div>
        <Text type="secondary" style={{ display: 'block', fontSize: '13px', lineHeight: 1.6, marginBottom: '16px' }}>
          默认关闭。开启后，官方直连失败的歌曲会按订阅清单依次尝试第三方解析源；全部失败换元/标记不可播。
          第三方源随时可能失效，且清单由你自行订阅，本应用不内置任何解析端点。
        </Text>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <Input
            placeholder="https://example.com/manifest.json"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onPressEnter={() => void addUrl()}
            prefix={<Link size={14} />}
            style={{ flex: 1 }}
          />
          <Button icon={<Plus size={14} />} loading={busy} onClick={() => void addUrl()}>添加 URL</Button>
          <Button icon={<FileJson size={14} />} loading={busy} onClick={() => void addFile()}>本地文件</Button>
        </div>

        <TextArea
          rows={3}
          placeholder="或直接粘贴 JSON 音源清单…"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          style={{ marginBottom: '8px', fontSize: '12px' }}
        />
        <Button icon={<Plus size={14} />} loading={busy} onClick={() => void addPaste()} style={{ marginBottom: '16px' }}>
          添加粘贴清单
        </Button>

        {state?.subscriptions?.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {state.subscriptions.map((sub) => (
              <div
                key={sub.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px 12px',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  background: 'var(--bg-surface)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>{sub.name}</span>
                    <Tag style={{ marginInlineEnd: 0 }}>{kindLabel(sub.kind)}</Tag>
                    <Tag color="blue" style={{ marginInlineEnd: 0 }}>{sub.manifest.sources.length} 源</Tag>
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sub.source}
                  </div>
                </div>
                {sub.kind === 'url' && (
                  <Button
                    size="small"
                    icon={<RefreshCw size={13} />}
                    onClick={() => void refreshSub(sub.id)}
                    title="刷新远程清单"
                  />
                )}
                <Button
                  size="small"
                  danger
                  icon={<Trash2 size={13} />}
                  onClick={() => void remove(sub.id)}
                  title="删除订阅"
                />
              </div>
            ))}
          </div>
        ) : (
          <Text type="secondary" style={{ fontSize: '13px' }}>暂无订阅。添加一份 JSON 音源清单后才会生效。</Text>
        )}

        {stats && Object.keys(stats).length > 0 && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px',
              border: '1px solid var(--border-color)',
              borderRadius: '6px',
              background: 'var(--bg-surface)',
            }}
          >
            <Text type="secondary" style={{ display: 'block', fontSize: '12px', marginBottom: '8px' }}>
              每源累计解析统计（本次会话）
            </Text>
            {Object.entries(stats).map(([sourceId, s]) => (
              <div
                key={sourceId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '13px',
                  padding: '4px 0',
                }}
              >
                <span style={{ color: 'var(--text-primary)' }}>{sourceName(sourceId)}</span>
                <span style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                  命中 {s.hits} · 失败 {s.misses}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default Tier3Section;
