import React, { useEffect, useState } from 'react';
import { FlaskConical, Plus, Trash2, RefreshCw, FileJson, Link } from 'lucide-react';
import type { Tier3Source, Tier3SourceStats, Tier3State, Tier3Subscription } from '@mplayer/core';
import { IpcClient } from '@/renderer/services/IpcClient';
import { Alert, Button, Group, Input, Row, Section, Switch, Tag, useToast, InfoHint } from '@/renderer/ui';

/**
 * tier3 第三方解析源订阅执行器（#144）设置区。
 * 默认彻底关闭；订阅源支持 URL / 本地 JSON 文件 / 手动粘贴，公开仓库零端点。
 */
const Tier3Section: React.FC = () => {
  const [state, setState] = useState<Tier3State | null>(null);
  const [stats, setStats] = useState<Record<string, Tier3SourceStats> | null>(null);
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState('');
  const [busy, setBusy] = useState(false);
  const { show } = useToast();

  const load = async (): Promise<void> => {
    try {
      const data = await IpcClient.invoke<Tier3State>('settings:getTier3State');
      setState(data);
      if (data.enabled && data.subscriptions.length > 0) {
        setStats(await IpcClient.invoke<Record<string, Tier3SourceStats>>('settings:getTier3Stats'));
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

  const refresh = async (): Promise<void> => {
    await load();
  };

  const handleToggle = async (value: boolean): Promise<void> => {
    if (!state) return;
    setState({ ...state, enabled: value });
    try {
      await IpcClient.invoke('settings:setTier3Enabled', value);
      show(value ? '已开启第三方解析源（实验性）' : '已关闭第三方解析源', { tone: 'success' });
      await refresh();
    } catch (error) {
      console.error('保存 tier3 开关失败:', error);
      show('保存失败，已恢复原状态', { tone: 'danger' });
      void load();
    }
  };

  const addUrl = async (): Promise<void> => {
    const trimmed = url.trim();
    if (!/^https?:\/\/.+/.test(trimmed)) {
      show('请输入 http(s) 开头的订阅 URL', { tone: 'warning' });
      return;
    }
    setBusy(true);
    try {
      await IpcClient.invoke('settings:addTier3Url', { url: trimmed });
      setUrl('');
      await refresh();
      show('URL 订阅已添加', { tone: 'success' });
    } catch (error) {
      console.error('添加 URL 订阅失败:', error);
      show(error instanceof Error ? error.message : '添加 URL 订阅失败', { tone: 'danger' });
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
      show('本地文件订阅已添加', { tone: 'success' });
    } catch (error) {
      console.error('添加本地文件订阅失败:', error);
      show(error instanceof Error ? error.message : '添加本地文件订阅失败', { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const addPaste = async (): Promise<void> => {
    if (!paste.trim()) {
      show('请粘贴 JSON 音源清单', { tone: 'warning' });
      return;
    }
    setBusy(true);
    try {
      await IpcClient.invoke('settings:addTier3Text', { text: paste });
      setPaste('');
      await refresh();
      show('粘贴清单已添加', { tone: 'success' });
    } catch (error) {
      console.error('添加粘贴清单失败:', error);
      show(error instanceof Error ? error.message : '添加粘贴清单失败', { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      await IpcClient.invoke('settings:removeTier3Subscription', id);
      await refresh();
      show('订阅已删除', { tone: 'success' });
    } catch (error) {
      console.error('删除订阅失败:', error);
      show(error instanceof Error ? error.message : '删除订阅失败', { tone: 'danger' });
    }
  };

  const refreshSub = async (id: string): Promise<void> => {
    try {
      await IpcClient.invoke('settings:refreshTier3Subscription', id);
      await refresh();
      show('订阅已刷新', { tone: 'success' });
    } catch (error) {
      console.error('刷新订阅失败:', error);
      show(error instanceof Error ? error.message : '刷新订阅失败', { tone: 'danger' });
    }
  };

  const kindLabel = (kind: Tier3Subscription['kind']): string => {
    if (kind === 'url') return 'URL';
    if (kind === 'file') return '本地文件';
    return '粘贴';
  };

  const sourceOf = (sourceId: string): Tier3Source | undefined => {
    for (const sub of state?.subscriptions ?? []) {
      const hit = sub.manifest.sources.find((s) => s.id === sourceId);
      if (hit) return hit;
    }
    return undefined;
  };

  const sourceName = (sourceId: string): string => sourceOf(sourceId)?.name || sourceId;

  return (
    <section id="tier3">
      <div className="settings-page__title">
        <FlaskConical size={16} aria-hidden="true" />
        <h1>第三方解析源</h1>
        <Tag tone="warning">实验性</Tag>
      </div>
      <div className="settings-page__stack">
        <Section title={<>{'总开关'} <InfoHint label="第三方解析">官方直连失败时按订阅清单依次尝试第三方解析；全部失败才换源或标记不可播。清单由你自行订阅，应用不内置任何端点。</InfoHint></>}>
          <Group>
            <Row
              label="启用第三方解析源"
              detail={state?.enabled ? '已开启' : '已关闭'}
              trailing={
                <Switch
                  checked={!!state?.enabled}
                  disabled={!state}
                  onChange={(value) => void handleToggle(value)}
                  ariaLabel="启用第三方解析源"
                />
              }
            />
          </Group>
        </Section>

        <Section
          title="添加订阅"
          footer="清单条目可写 source 声明它服务于哪个音乐源（netease / qq / kugou / kuwo / migu / qianqian / soda）。url-resolver 不写 source 会被拒绝；一个聚合端点服务多个源时请拆成多条。"
        >
          <Group>
            <div className="settings-page__field">
              <div className="settings-page__field-label">订阅 URL</div>
              <Input
                aria-label="订阅 URL"
                placeholder="https://example.com/manifest.json"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addUrl();
                }}
              />
            </div>
            <Row
              label="添加 URL 订阅"
              detail="拉取远程 JSON 清单"
              trailing={
                <Button size="sm" icon={<Link size={13} />} disabled={busy} onClick={() => void addUrl()}>
                  添加
                </Button>
              }
            />
            <Row
              label="从本地文件添加"
              detail="选择一份 JSON 清单"
              trailing={
                <Button size="sm" icon={<FileJson size={13} />} disabled={busy} onClick={() => void addFile()}>
                  选择文件
                </Button>
              }
            />
            <div className="settings-page__field">
              <div className="settings-page__field-label">或直接粘贴清单</div>
              <textarea
                className="settings-page__textarea"
                aria-label="粘贴 JSON 清单"
                rows={4}
                placeholder="粘贴 JSON 音源清单…"
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
              />
            </div>
            <div className="settings-page__actions">
              <Button size="sm" icon={<Plus size={13} />} disabled={busy} onClick={() => void addPaste()}>
                添加粘贴清单
              </Button>
            </div>
          </Group>
        </Section>

        <Section title="已订阅">
          <Group>
            {state?.subscriptions?.length ? (
              state.subscriptions.map((sub) => (
                <Row
                  key={sub.id}
                  label={sub.name}
                  detail={sub.source}
                  trailing={
                    <>
                      <Tag>{kindLabel(sub.kind)}</Tag>
                      <Tag tone="accent">{sub.manifest.sources.length} 源</Tag>
                      {sub.kind === 'url' && (
                        <Button
                          size="sm"
                          icon={<RefreshCw size={13} />}
                          aria-label={`刷新 ${sub.name}`}
                          onClick={() => void refreshSub(sub.id)}
                        />
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<Trash2 size={13} />}
                        aria-label={`删除 ${sub.name}`}
                        onClick={() => void remove(sub.id)}
                      />
                    </>
                  }
                />
              ))
            ) : (
              <Row label="暂无订阅" detail="添加一份 JSON 音源清单后才会生效" />
            )}
          </Group>
        </Section>

        {stats && Object.keys(stats).length > 0 && (
          <Section
            title="本会话解析统计"
            footer="健康度按会话内样本调整遍历顺序——只改顺序，不删源、不禁用；连续失败 2 次沉底，成功一次即回归。"
          >
            <Group>
              {Object.entries(stats).map(([sourceId, s]) => (
                <Row
                  key={sourceId}
                  label={sourceName(sourceId)}
                  detail={`交付 ${s.hits} · 丢弃 ${s.discarded ?? 0} · 失败 ${s.misses} · 跳过 ${s.skipped ?? 0}`}
                  trailing={
                    <>
                      {sourceOf(sourceId)?.source ? <Tag>{sourceOf(sourceId)?.source}</Tag> : null}
                      {s.demoted ? <Tag tone="danger">已降级</Tag> : null}
                    </>
                  }
                />
              ))}
            </Group>
          </Section>
        )}

        {!state?.enabled && (
          <Alert tone="info" title="尚未启用">
            开启后才会参与播放解析；关闭时所有请求仍只走官方直连。
          </Alert>
        )}
      </div>
    </section>
  );
};

export default Tier3Section;
