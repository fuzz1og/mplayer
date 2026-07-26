import React, { useEffect, useState } from 'react';
import { Database, Trash2, HardDrive, FileAudio, Image, Link, Music } from 'lucide-react';
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
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
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

  const cacheItems = [
    { label: '歌曲列表缓存', count: stats.songsCount, icon: <Music size={16} />, color: '#74B9FF' },
    { label: '封面图片缓存', count: stats.coversCount, icon: <Image size={16} />, color: '#00B894' },
    { label: '音频文件缓存', count: stats.audioCount, icon: <FileAudio size={16} />, color: '#FDCB6E' },
    { label: 'URL 缓存', count: stats.urlsCount, icon: <Link size={16} />, color: '#E17055' },
  ];

  return (
    <>
      <section style={{ marginBottom: '32px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
          <Database size={20} color="var(--accent-color)" />
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)' }}>缓存管理</h2>
        </div>
        <div style={{ backgroundColor: 'var(--content-bg)', borderRadius: '12px', padding: '24px', border: '1px solid var(--border-color)' }}>
          {/* 统计卡片 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
            <div style={{ padding: '16px', backgroundColor: 'var(--bg-color)', borderRadius: '8px', textAlign: 'center' }}>
              <HardDrive size={24} color="var(--accent-color)" style={{ marginBottom: '8px' }} />
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>缓存总大小</div>
              <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>{formatSize(stats.totalSize)}</div>
            </div>
            <div style={{ padding: '16px', backgroundColor: 'var(--bg-color)', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--text-2xl)', marginBottom: '4px' }}>📁</div>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>缓存文件数</div>
              <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>{stats.fileCount}</div>
            </div>
            <div style={{ padding: '16px', backgroundColor: 'var(--bg-color)', borderRadius: '8px', textAlign: 'center' }}>
              <div style={{ fontSize: 'var(--text-2xl)', marginBottom: '4px' }}>📊</div>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>缓存使用率</div>
              <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>{usagePercent.toFixed(1)}%</div>
            </div>
          </div>

          {/* 进度条 */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ height: '8px', backgroundColor: 'var(--border-color)', borderRadius: '4px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${usagePercent}%`, backgroundColor: usagePercent > 90 ? '#FF6B6B' : 'var(--accent-color)', borderRadius: '4px', transition: 'width 0.3s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontSize: '12px', color: 'var(--text-tertiary)' }}>
              <span>0 MB</span><span>100 MB</span>
            </div>
          </div>

          {/* 缓存详情 */}
          <div style={{ marginBottom: '24px' }}>
            {cacheItems.map((item, index) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderBottom: index < cacheItems.length - 1 ? '1px solid var(--divider-color)' : 'none' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: '8px', backgroundColor: `${item.color}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: item.color }}>{item.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-primary)', marginBottom: '4px' }}>{item.label}</div>
                  <div style={{ height: '4px', backgroundColor: 'var(--border-color)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${stats.fileCount > 0 ? (item.count / stats.fileCount) * 100 : 0}%`, backgroundColor: item.color, borderRadius: '2px' }} />
                  </div>
                </div>
                <div style={{ fontSize: 'var(--text-base)', fontWeight: 500, color: 'var(--text-secondary)' }}>{item.count} 个</div>
              </div>
            ))}
          </div>

          {/* 清除缓存按钮 */}
          <button
            onClick={() => setShowClearConfirm(true)} disabled={stats.fileCount === 0}
            style={{
              display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 20px',
              backgroundColor: stats.fileCount > 0 ? 'transparent' : 'var(--hover-bg)',
              color: stats.fileCount > 0 ? '#FF6B6B' : 'var(--text-tertiary)',
              border: `1px solid ${stats.fileCount > 0 ? '#FF6B6B' : 'var(--border-color)'}`,
              borderRadius: '8px', fontSize: 'var(--text-base)', fontWeight: 500,
              cursor: stats.fileCount > 0 ? 'pointer' : 'not-allowed', transition: 'all 0.15s ease',
            }}
          >
            <Trash2 size={16} />清除所有缓存
          </button>
        </div>
      </section>

      {/* 确认弹窗 */}
      {showClearConfirm && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setShowClearConfirm(false)}>
          <div style={{ width: '360px', backgroundColor: 'var(--content-bg)', borderRadius: '12px', padding: '24px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#FF6B6B20', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
              <Trash2 size={24} color="#FF6B6B" />
            </div>
            <h3 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>清除缓存</h3>
            <p style={{ fontSize: 'var(--text-base)', color: 'var(--text-secondary)', marginBottom: '24px' }}>确定要清除所有缓存吗？此操作不可恢复。</p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowClearConfirm(false)} style={{ padding: '8px 16px', backgroundColor: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', borderRadius: '6px', fontSize: 'var(--text-base)', cursor: 'pointer', transition: 'all 0.15s ease' }}>取消</button>
              <button onClick={handleClearCache} style={{ padding: '8px 16px', backgroundColor: '#FF6B6B', color: 'white', border: 'none', borderRadius: '6px', fontSize: 'var(--text-base)', cursor: 'pointer', transition: 'all 0.15s ease' }}>确定清除</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default CacheSection;
