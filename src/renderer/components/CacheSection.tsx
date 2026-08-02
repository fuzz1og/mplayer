import React, { useEffect, useState } from 'react';
import { Database, Trash2, HardDrive, FileAudio, Image, Link, Music, FolderOpen } from 'lucide-react';
import { IpcClient } from '@/renderer/services/IpcClient';

interface CacheStats {
  totalSize: number;
  fileCount: number;
  songsCount: number;
  coversCount: number;
  audioCount: number;
  urlsCount: number;
}

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const CacheSection: React.FC = () => {
  const [stats, setStats] = useState<CacheStats>({ totalSize: 0, fileCount: 0, songsCount: 0, coversCount: 0, audioCount: 0, urlsCount: 0 });
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const loadStats = async () => {
    try {
      const data = await IpcClient.invoke<CacheStats>('cache:getStats');
      setStats(data);
    } catch (error) {
      console.error('加载缓存统计失败:', error);
    }
  };

  useEffect(() => { loadStats(); }, []);

  const handleClearCache = async () => {
    try {
      await IpcClient.invoke<void>('cache:clear');
      setShowClearConfirm(false);
      loadStats();
    } catch (error) {
      console.error('清除缓存失败:', error);
    }
  };

  const maxCacheSize = 100 * 1024 * 1024;
  const usagePercent = Math.min((stats.totalSize / maxCacheSize) * 100, 100);
  const remainingSize = Math.max(maxCacheSize - stats.totalSize, 0);
  const avgFileSize = stats.fileCount > 0 ? Math.round(stats.totalSize / stats.fileCount) : 0;

  const cacheItems = [
    { label: '歌曲索引', count: stats.songsCount, icon: <Music size={16} />, color: '#2F5FD0' },
    { label: '封面图片', count: stats.coversCount, icon: <Image size={16} />, color: '#00B894' },
    { label: '音频文件', count: stats.audioCount, icon: <FileAudio size={16} />, color: '#FDCB6E' },
    { label: 'URL 缓存', count: stats.urlsCount, icon: <Link size={16} />, color: '#E17055' },
  ];

  const miniStats = [
    { label: '缓存文件数', value: String(stats.fileCount), icon: <FolderOpen size={18} />, color: 'var(--text-secondary)' },
    { label: '平均文件大小', value: formatSize(avgFileSize), icon: <HardDrive size={18} />, color: 'var(--text-secondary)' },
    { label: '歌曲索引', value: String(stats.songsCount), icon: <Music size={18} />, color: 'var(--accent-color)' },
    { label: '封面图片', value: String(stats.coversCount), icon: <Image size={18} />, color: '#00B894' },
  ];

  return (
    <>
      <section id="cache" style={{ marginBottom: '32px', scrollMarginTop: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <Database size={20} color="var(--text-secondary)" />
          <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>缓存管理</h2>
        </div>
        <div style={{ backgroundColor: 'var(--content-bg)', borderRadius: '8px', padding: '20px', border: '1px solid var(--border-color)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1.1fr) 1fr', gap: '16px' }}>
            <div style={{ padding: '18px', backgroundColor: 'var(--bg-color)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <HardDrive size={16} color="var(--accent-color)" />
                <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>已用缓存</span>
              </div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px', fontVariantNumeric: 'tabular-nums' }}>
                {formatSize(stats.totalSize)}
              </div>
              <div style={{ height: '8px', backgroundColor: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
                <div style={{ height: '100%', width: `${usagePercent}%`, backgroundColor: usagePercent > 90 ? '#FF6B6B' : 'var(--accent-color)', borderRadius: '4px', transition: 'width 0.3s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '6px' }}>
                <span>上限 100 MB</span>
                <span>{usagePercent.toFixed(1)}%</span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                剩余 {formatSize(remainingSize)}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              {miniStats.map((item) => (
                <div key={item.label} style={{ padding: '14px', backgroundColor: 'var(--bg-color)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', color: item.color }}>{item.icon}</div>
                  <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px', fontVariantNumeric: 'tabular-nums' }}>{item.value}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '22px 0 10px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>缓存构成</span>
            <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>按文件数量占比</span>
          </div>
          <div style={{ marginBottom: '8px' }}>
            {cacheItems.map((item, index) => {
              const share = stats.fileCount > 0 ? (item.count / stats.fileCount) * 100 : 0;
              return (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 0', borderBottom: index < cacheItems.length - 1 ? '1px solid var(--divider-color)' : 'none' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: `${item.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: item.color, flexShrink: 0 }}>{item.icon}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <span style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{item.label}</span>
                      <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{item.count} 个 · {share.toFixed(1)}%</span>
                    </div>
                    <div style={{ height: '4px', backgroundColor: 'var(--border-color)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${share}%`, backgroundColor: item.color, borderRadius: '2px' }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
            <button
              onClick={() => setShowClearConfirm(true)}
              disabled={stats.fileCount === 0}
              style={{
                display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 18px',
                backgroundColor: stats.fileCount > 0 ? 'transparent' : 'var(--hover-bg)',
                color: stats.fileCount > 0 ? '#FF6B6B' : 'var(--text-tertiary)',
                border: `1px solid ${stats.fileCount > 0 ? '#FF6B6B' : 'var(--border-color)'}`,
                borderRadius: '8px', fontSize: '13px', fontWeight: 500,
                cursor: stats.fileCount > 0 ? 'pointer' : 'not-allowed', transition: 'all 0.15s ease',
              }}
            >
              <Trash2 size={15} />
              清除所有缓存
            </button>
          </div>
        </div>
      </section>

      {showClearConfirm && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowClearConfirm(false)}>
          <div style={{ width: '360px', backgroundColor: 'var(--content-bg)', borderRadius: '8px', padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#FF6B6B20', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
              <Trash2 size={24} color="#FF6B6B" />
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>清除缓存</h3>
            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>确定要清除所有缓存吗？此操作不可恢复。</p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowClearConfirm(false)} style={{ padding: '8px 16px', backgroundColor: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: '14px', cursor: 'pointer' }}>取消</button>
              <button onClick={handleClearCache} style={{ padding: '8px 16px', backgroundColor: '#FF6B6B', color: 'white', border: 'none', borderRadius: '6px', fontSize: '14px', cursor: 'pointer' }}>确定清除</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CacheSection;
