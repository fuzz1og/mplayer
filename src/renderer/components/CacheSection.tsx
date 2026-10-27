import React, { useCallback, useEffect, useState } from 'react';
import { Folder, HardDrive, Trash2 } from 'lucide-react';
import { IpcClient } from '@/renderer/services/IpcClient';
import { Button, Dialog, Group, Progress, Row, Section, Stepper, Switch } from '@/renderer/ui';

/** cache:getStats 的渲染侧视图（IPC 在磁盘统计上并了每类别字节数，见 src/main/ipc/cache.ts）。 */
interface CacheStatsView {
  totalSize: number;
  fileCount: number;
  songsCount: number;
  coversCount: number;
  audioCount: number;
  urlsCount: number;
  bytes?: Partial<Record<'songs' | 'urls' | 'covers' | 'audio' | 'other', number>>;
}

interface CacheConfig {
  limitMb: number;
  autoClean: boolean;
  dir: string;
  stepMb: number;
  minMb: number;
  maxMb: number;
}

const FALLBACK_CONFIG: CacheConfig = { limitMb: 100, autoClean: true, dir: '', stepMb: 20, minMb: 20, maxMb: 4096 };

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/** 「0 B」拆成数字 + 小号单位（原型 §2 存储卡的大号读数）。 */
function splitSize(text: string): [string, string] {
  const match = /^([\d.,]+)\s+(\S+)$/.exec(text);
  return match ? [match[1], match[2]] : [text, ''];
}

/** 按类型清理的三组（与主进程 cache:clearKind 的入参一一对应）。 */
type CacheClearKind = 'index' | 'covers' | 'audio';

interface CacheCompositionGroup {
  /** 色点 class 后缀（沿用 --index / --cover / --audio 三套 token）。 */
  key: 'index' | 'cover' | 'audio';
  clearKind: CacheClearKind;
  label: string;
  count: number;
  bytes: number;
}

/** 三类构成：色点取 --chart-* token（唯一事实源在 global.css），JSON 条目统称「歌曲索引」。 */
function buildGroups(stats: CacheStatsView): CacheCompositionGroup[] {
  const bytes = stats.bytes ?? {};
  // fileCount 减去四类已归类计数 = 解析不了的 other；「歌曲索引」按 songs + urls + other 计。
  const otherCount = Math.max(
    stats.fileCount - stats.songsCount - stats.urlsCount - stats.coversCount - stats.audioCount,
    0,
  );
  return [
    {
      key: 'index',
      clearKind: 'index',
      label: '歌曲索引',
      count: stats.songsCount + stats.urlsCount + otherCount,
      bytes: (bytes.songs ?? 0) + (bytes.urls ?? 0) + (bytes.other ?? 0),
    },
    { key: 'cover', clearKind: 'covers', label: '封面图片', count: stats.coversCount, bytes: bytes.covers ?? 0 },
    { key: 'audio', clearKind: 'audio', label: '音频文件', count: stats.audioCount, bytes: bytes.audio ?? 0 },
  ];
}

const EMPTY_STATS: CacheStatsView = {
  totalSize: 0, fileCount: 0, songsCount: 0, coversCount: 0, audioCount: 0, urlsCount: 0,
};

/**
 * 缓存页（1.9.0 原型 §2）：存储卡 → 构成 → 位置。
 * 上限/自动清理由主进程持久化：cache:getConfig / setLimitMb / setAutoClean。
 */
interface PendingClear {
  kind: CacheClearKind;
  label: string;
  bytes: number;
}

const CacheSection: React.FC = () => {
  const [stats, setStats] = useState<CacheStatsView | null>(null);
  const [config, setConfig] = useState<CacheConfig>(FALLBACK_CONFIG);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [pendingClear, setPendingClear] = useState<PendingClear | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextStats, nextConfig] = await Promise.all([
        IpcClient.invoke<CacheStatsView | undefined>('cache:getStats'),
        IpcClient.invoke<Partial<CacheConfig> | undefined>('cache:getConfig'),
      ]);
      if (nextStats) setStats(nextStats);
      if (nextConfig) setConfig({ ...FALLBACK_CONFIG, ...nextConfig });
    } catch (error) {
      console.error('加载缓存信息失败:', error);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveLimitMb = async (limitMb: number) => {
    setConfig((prev) => ({ ...prev, limitMb }));
    try {
      const saved = await IpcClient.invoke<number>('cache:setLimitMb', limitMb);
      if (typeof saved === 'number') setConfig((prev) => ({ ...prev, limitMb: saved }));
      await load();
    } catch (error) {
      console.error('保存缓存上限失败:', error);
    }
  };

  const saveAutoClean = async (autoClean: boolean) => {
    setConfig((prev) => ({ ...prev, autoClean }));
    try {
      const saved = await IpcClient.invoke<boolean>('cache:setAutoClean', autoClean);
      setConfig((prev) => ({ ...prev, autoClean: saved !== false }));
    } catch (error) {
      console.error('保存自动清理失败:', error);
    }
  };

  const handleClearCache = async () => {
    try {
      await IpcClient.invoke<void>('cache:clear');
      setShowClearConfirm(false);
      await load();
    } catch (error) {
      console.error('清除缓存失败:', error);
    }
  };

  const handleClearKind = async () => {
    if (!pendingClear) return;
    try {
      const cleared = await IpcClient.invoke<boolean>('cache:clearKind', pendingClear.kind);
      if (cleared === false) return;
      setPendingClear(null);
      await load();
    } catch (error) {
      console.error('按类型清理缓存失败:', error);
    }
  };

  const openCacheDir = async () => {
    if (!config.dir) return;
    try {
      await IpcClient.invoke('cache:openDir', config.dir);
    } catch (error) {
      console.error('打开缓存目录失败:', error);
    }
  };

  const limitBytes = config.limitMb * 1024 * 1024;
  const used = stats?.totalSize ?? 0;
  const usagePercent = limitBytes > 0 ? Math.min((used / limitBytes) * 100, 100) : 0;
  const [usedNumber, usedUnit] = splitSize(formatSize(used));
  const groups = buildGroups(stats ?? EMPTY_STATS);

  return (
    <section id="cache">
      <div className="settings-page__head">
        <h1>缓存</h1>
        <p className="settings-page__lead">缓存封面、歌词与索引，加快重复浏览</p>
      </div>

      <div className="settings-page__stack">
        <Section title="存储">
          <Group>
            <div className="cache-usage">
              <div className="cache-usage__value">
                {usedNumber}
                {usedUnit ? <span className="cache-usage__unit"> {' ' + usedUnit}</span> : null}
              </div>
              <div className="cache-usage__limit">
                {'上限 ' + config.limitMb + ' MB · 还剩 ' + formatSize(Math.max(limitBytes - used, 0))}
              </div>
              <div className="cache-usage__bar">
                <Progress value={usagePercent} tone={usagePercent > 90 ? 'danger' : 'accent'} ariaLabel="缓存占用比例" />
              </div>
              <div className="cache-usage__legend">
                {groups.map((group) => (
                  <span className="cache-legend__item" key={group.key}>
                    <span className={'cache-legend__dot cache-legend__dot--' + group.key} aria-hidden="true" />
                    {group.label}
                  </span>
                ))}
              </div>
            </div>

            <Row
              icon={<HardDrive size={13} />}
              label="空间上限"
              trailing={
                <>
                  <Stepper
                    value={config.limitMb}
                    min={config.minMb}
                    max={config.maxMb}
                    step={config.stepMb}
                    label="空间上限"
                    onChange={(value) => void saveLimitMb(value)}
                  />
                  <span className="cache-limit__unit">MB</span>
                </>
              }
            />
            <Row
              label="超出上限时自动清理最早条目"
              trailing={
                <Switch
                  checked={config.autoClean}
                  onChange={(value) => void saveAutoClean(value)}
                  ariaLabel="超出上限时自动清理最早条目"
                />
              }
            />
            <Row
              icon={<Trash2 size={13} />}
              label="清理全部缓存"
              detail={stats && stats.fileCount > 0 ? '将释放 ' + formatSize(stats.totalSize) : '当前没有可清理的缓存'}
              trailing={
                <Button
                  variant="danger"
                  size="sm"
                  disabled={!stats || stats.fileCount === 0}
                  onClick={() => setShowClearConfirm(true)}
                >
                  清理
                </Button>
              }
            />
          </Group>
        </Section>

        <Section title="构成" footer="缓存按文件数量统计，超出上限时按写入时间从早到晚清理。">
          <Group>
            {groups.map((group) => (
              <Row
                key={group.key}
                label={
                  <span className="cache-composition__label">
                    <span className={'cache-legend__dot cache-legend__dot--' + group.key} aria-hidden="true" />
                    {group.label}
                  </span>
                }
                detail={group.count + ' 个 · ' + formatSize(group.bytes)}
                trailing={
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={'清理' + group.label}
                    disabled={group.count === 0}
                    onClick={() =>
                      setPendingClear({ kind: group.clearKind, label: group.label, bytes: group.bytes })
                    }
                  >
                    清理
                  </Button>
                }
              />
            ))}
          </Group>
        </Section>

        <Section title="位置">
          <Group>
            <Row
              icon={<Folder size={13} />}
              label="缓存目录"
              chevron
              onClick={() => void openCacheDir()}
              ariaLabel="打开缓存目录"
              trailing={<span className="cache-dir" title={config.dir}>{config.dir || '加载中…'}</span>}
            />
          </Group>
        </Section>
      </div>

      <Dialog
        open={showClearConfirm}
        title="清理全部缓存"
        onClose={() => setShowClearConfirm(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowClearConfirm(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void handleClearCache()}>
              确定清理
            </Button>
          </>
        }
      >
        {'将释放 ' + formatSize(used) + '，此操作不可恢复；播放记录与收藏不受影响。'}
      </Dialog>

      <Dialog
        open={pendingClear !== null}
        title={pendingClear ? '清理' + pendingClear.label : '清理缓存'}
        onClose={() => setPendingClear(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingClear(null)}>
              取消
            </Button>
            <Button variant="primary" onClick={() => void handleClearKind()}>
              确定清理
            </Button>
          </>
        }
      >
        {pendingClear
          ? '将释放 ' + formatSize(pendingClear.bytes) + '，此操作不可恢复；仅清理「' + pendingClear.label + '」，其他缓存保留。'
          : null}
      </Dialog>
    </section>
  );
};

export default CacheSection;
