import React, { useEffect, useState } from 'react';
import { Database, HardDrive } from 'lucide-react';
import { IpcClient } from '@/renderer/services/IpcClient';
import { Alert, Button, Dialog, Group, Progress, Row, Section, Tag } from '@/renderer/ui';

interface CacheStats {
  totalSize: number;
  fileCount: number;
  songsCount: number;
  coversCount: number;
  audioCount: number;
  urlsCount: number;
}

const MAX_CACHE_SIZE = 100 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 缓存页（1.9.0）：一条主行讲清「已用 / 上限 / 百分比」，构成与清理动作分组列出。
 * 旧版的 2×2 统计卡与「缓存构成」列表在这里合并成一份，不再重复讲同一组数字。
 */
const CacheSection: React.FC = () => {
  const [stats, setStats] = useState<CacheStats>({
    totalSize: 0,
    fileCount: 0,
    songsCount: 0,
    coversCount: 0,
    audioCount: 0,
    urlsCount: 0,
  });
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const loadStats = async () => {
    try {
      const data = await IpcClient.invoke<CacheStats>('cache:getStats');
      setStats(data);
    } catch (error) {
      console.error('加载缓存统计失败:', error);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const handleClearCache = async () => {
    try {
      await IpcClient.invoke<void>('cache:clear');
      setShowClearConfirm(false);
      loadStats();
    } catch (error) {
      console.error('清除缓存失败:', error);
    }
  };

  const usagePercent = Math.min((stats.totalSize / MAX_CACHE_SIZE) * 100, 100);
  const averageSize = stats.fileCount > 0 ? Math.round(stats.totalSize / stats.fileCount) : 0;
  const compositions = [
    { label: '歌曲索引', count: stats.songsCount },
    { label: '封面图片', count: stats.coversCount },
    { label: '音频文件', count: stats.audioCount },
    { label: 'URL 缓存', count: stats.urlsCount },
  ];

  return (
    <section id="cache">
      <div className="settings-page__title">
        <Database size={16} aria-hidden="true" />
        <h1>缓存</h1>
      </div>
      <div className="settings-page__lead">缓存保存歌曲索引、封面与已解析地址，删除后首次播放会重新解析。</div>

      <div className="settings-page__stack">
        <Section title="占用">
          <Group>
            <Row
              icon={<HardDrive size={13} />}
              label="已用空间"
              detail={`${formatSize(stats.totalSize)} / 100 MB`}
              trailing={<Tag tone={usagePercent > 90 ? 'danger' : 'neutral'}>{usagePercent.toFixed(1)}%</Tag>}
            />
            <Row label="剩余可用" detail={formatSize(Math.max(MAX_CACHE_SIZE - stats.totalSize, 0))} />
            <Row label="文件数" detail={String(stats.fileCount)} />
            <Row label="平均文件大小" detail={formatSize(averageSize)} />
            <div className="settings-page__progress">
              <Progress value={usagePercent} tone={usagePercent > 90 ? 'danger' : 'accent'} ariaLabel="缓存占用比例" />
            </div>
          </Group>
        </Section>

        <Section title="缓存构成" footer="按文件数量占比；点击清理只影响缓存，收藏与播放记录不变。">
          <Group>
            {compositions.map((item) => {
              const share = stats.fileCount > 0 ? (item.count / stats.fileCount) * 100 : 0;
              return (
                <Row
                  key={item.label}
                  label={item.label}
                  detail={`${item.count} 个 · ${share.toFixed(1)}%`}
                />
              );
            })}
          </Group>
        </Section>

        <Section title="清理">
          <Group>
            <Row
              label="清除所有缓存"
              detail={stats.fileCount > 0 ? `将释放 ${formatSize(stats.totalSize)}` : '当前没有可清理的缓存'}
              trailing={
                <Button variant="danger" size="sm" disabled={stats.fileCount === 0} onClick={() => setShowClearConfirm(true)}>
                  清除
                </Button>
              }
            />
          </Group>
        </Section>

        {stats.fileCount === 0 && <Alert tone="info" title="缓存是空的">首次播放与浏览后会在这里看到占用。</Alert>}
      </div>

      <Dialog
        open={showClearConfirm}
        title="清除缓存"
        onClose={() => setShowClearConfirm(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowClearConfirm(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={handleClearCache}>
              确定清除
            </Button>
          </>
        }
      >
        将释放 {formatSize(stats.totalSize)}，此操作不可恢复；播放记录与收藏不受影响。
      </Dialog>
    </section>
  );
};

export default CacheSection;
