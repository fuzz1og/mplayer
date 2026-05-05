import React, { useEffect, useState } from 'react';
import { Settings, Trash2, Database, Info, HardDrive, FileAudio, Image, Link, Music, Folder, RefreshCw } from 'lucide-react';
import { message } from 'antd';
import { cacheService, CacheStats } from '@/renderer/services/cacheService';
const { ipcRenderer } = window.require('electron');

const SettingsPage: React.FC = () => {
  const [stats, setStats] = useState<CacheStats>({
    totalSize: 0,
    fileCount: 0,
    songsCount: 0,
    coversCount: 0,
    audioCount: 0,
    urlsCount: 0
  });
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [downloadPath, setDownloadPath] = useState<string>('');
  const [apiUrl, setApiUrl] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const loadStats = async () => {
    try {
      const data = await cacheService.getCacheStats();
      setStats(data);
    } catch (error) {
      console.error('加载缓存统计失败:', error);
    }
  };

  const loadDownloadPath = async () => {
    try {
      const path = await ipcRenderer.invoke('settings:getDownloadPath');
      setDownloadPath(path);
    } catch (error) {
      console.error('加载下载目录失败:', error);
    }
  };

  const loadApiUrl = async () => {
    try {
      const url = await ipcRenderer.invoke('settings:getApiUrl');
      setApiUrl(url);
    } catch (error) {
      console.error('加载API地址失败:', error);
    }
  };

  const handleSaveApiUrl = async (url: string) => {
    setIsSaving(true);
    try {
      const result = await ipcRenderer.invoke('settings:setApiUrl', url);
      if (result.success) {
        setApiUrl(url);
        message.success('API地址已保存');
      } else {
        message.error('保存失败: ' + result.error);
      }
    } catch (error) {
      console.error('保存API地址失败:', error);
      message.error('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectDirectory = async () => {
    try {
      const result = await ipcRenderer.invoke('dialog:openDirectory');
      if (result && !result.canceled && result.filePaths.length > 0) {
        const newPath = result.filePaths[0];
        setDownloadPath(newPath);
        await handleSaveDownloadPath(newPath);
      }
    } catch (error) {
      console.error('选择目录失败:', error);
    }
  };

  const handleSaveDownloadPath = async (path: string) => {
    setIsSaving(true);
    try {
      const result = await ipcRenderer.invoke('settings:setDownloadPath', path);
      if (result.success) {
        message.success('下载目录已更新');
      } else {
        message.error('更新失败: ' + result.error);
      }
    } catch (error) {
      console.error('保存下载目录失败:', error);
      message.error('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetDownloadPath = async () => {
    setIsSaving(true);
    try {
      const result = await ipcRenderer.invoke('settings:resetDownloadPath');
      if (result.success) {
        setDownloadPath(result.path);
        message.success('已重置为默认下载目录');
      } else {
        message.error('重置失败: ' + result.error);
      }
    } catch (error) {
      console.error('重置下载目录失败:', error);
      message.error('重置失败');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    loadStats();
    loadDownloadPath();
    loadApiUrl();
  }, []);

  const handleClearCache = async () => {
    try {
      await cacheService.clearAllCache();
      setShowClearConfirm(false);
      loadStats();
    } catch (error) {
      console.error('清除缓存失败:', error);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const maxCacheSize = 100 * 1024 * 1024; // 100MB
  const usagePercent = Math.min((stats.totalSize / maxCacheSize) * 100, 100);

  const cacheItems = [
    { label: '歌曲列表缓存', count: stats.songsCount, icon: <Music size={16} />, color: '#74B9FF' },
    { label: '封面图片缓存', count: stats.coversCount, icon: <Image size={16} />, color: '#00B894' },
    { label: '音频文件缓存', count: stats.audioCount, icon: <FileAudio size={16} />, color: '#FDCB6E' },
    { label: 'URL 缓存', count: stats.urlsCount, icon: <Link size={16} />, color: '#E17055' }
  ];

  return (
    <div style={{ padding: '24px', height: '100%', overflow: 'auto' }}>
      {/* 页面头部 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          marginBottom: '32px',
          paddingBottom: '24px',
          borderBottom: '1px solid var(--divider-color)',
        }}
      >
        <Settings size={28} color="var(--text-primary)" />
        <h1
          style={{
            fontSize: '28px',
            fontWeight: 700,
            color: 'var(--text-primary)',
          }}
        >
          设置
        </h1>
      </div>

      {/* 缓存管理 */}
      <section style={{ marginBottom: '32px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '20px',
          }}
        >
          <Database size={20} color="var(--accent-color)" />
          <h2
            style={{
              fontSize: '18px',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            缓存管理
          </h2>
        </div>

        <div
          style={{
            backgroundColor: 'var(--content-bg)',
            borderRadius: '12px',
            padding: '24px',
            border: '1px solid var(--border-color)',
          }}
        >
          {/* 统计卡片 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '16px',
              marginBottom: '24px',
            }}
          >
            <div
              style={{
                padding: '16px',
                backgroundColor: 'var(--bg-color)',
                borderRadius: '8px',
                textAlign: 'center',
              }}
            >
              <HardDrive size={24} color="var(--accent-color)" style={{ marginBottom: '8px' }} />
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                缓存总大小
              </div>
              <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {formatSize(stats.totalSize)}
              </div>
            </div>

            <div
              style={{
                padding: '16px',
                backgroundColor: 'var(--bg-color)',
                borderRadius: '8px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '24px', marginBottom: '4px' }}>📁</div>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                缓存文件数
              </div>
              <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {stats.fileCount}
              </div>
            </div>

            <div
              style={{
                padding: '16px',
                backgroundColor: 'var(--bg-color)',
                borderRadius: '8px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '24px', marginBottom: '4px' }}>📊</div>
              <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                缓存使用率
              </div>
              <div style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)' }}>
                {usagePercent.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* 进度条 */}
          <div style={{ marginBottom: '24px' }}>
            <div
              style={{
                height: '8px',
                backgroundColor: 'var(--border-color)',
                borderRadius: '4px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${usagePercent}%`,
                  backgroundColor: usagePercent > 90 ? '#FF6B6B' : 'var(--accent-color)',
                  borderRadius: '4px',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '8px',
                fontSize: '12px',
                color: 'var(--text-tertiary)',
              }}
            >
              <span>0 MB</span>
              <span>100 MB</span>
            </div>
          </div>

          {/* 缓存详情 */}
          <div style={{ marginBottom: '24px' }}>
            {cacheItems.map((item, index) => (
              <div
                key={item.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 0',
                  borderBottom: index < cacheItems.length - 1 ? '1px solid var(--divider-color)' : 'none',
                }}
              >
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '8px',
                    backgroundColor: `${item.color}20`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: item.color,
                  }}
                >
                  {item.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', color: 'var(--text-primary)', marginBottom: '4px' }}>
                    {item.label}
                  </div>
                  <div
                    style={{
                      height: '4px',
                      backgroundColor: 'var(--border-color)',
                      borderRadius: '2px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${stats.fileCount > 0 ? (item.count / stats.fileCount) * 100 : 0}%`,
                        backgroundColor: item.color,
                        borderRadius: '2px',
                      }}
                    />
                  </div>
                </div>
                <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' }}>
                  {item.count} 个
                </div>
              </div>
            ))}
          </div>

          {/* 清除缓存按钮 */}
          <button
            onClick={() => setShowClearConfirm(true)}
            disabled={stats.fileCount === 0}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 20px',
              backgroundColor: stats.fileCount > 0 ? 'transparent' : 'var(--hover-bg)',
              color: stats.fileCount > 0 ? '#FF6B6B' : 'var(--text-tertiary)',
              border: `1px solid ${stats.fileCount > 0 ? '#FF6B6B' : 'var(--border-color)'}`,
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: 500,
              cursor: stats.fileCount > 0 ? 'pointer' : 'not-allowed',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => {
              if (stats.fileCount > 0) {
                e.currentTarget.style.backgroundColor = '#FF6B6B';
                e.currentTarget.style.color = 'white';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = stats.fileCount > 0 ? '#FF6B6B' : 'var(--text-tertiary)';
            }}
          >
            <Trash2 size={16} />
            清除所有缓存
          </button>
        </div>
      </section>

      {/* 下载设置 */}
      <section style={{ marginBottom: '32px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '20px',
          }}
        >
          <Folder size={20} color="var(--accent-color)" />
          <h2
            style={{
              fontSize: '18px',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            下载设置
          </h2>
        </div>

        <div
          style={{
            backgroundColor: 'var(--content-bg)',
            borderRadius: '12px',
            padding: '24px',
            border: '1px solid var(--border-color)',
          }}
        >
          <div style={{ marginBottom: '16px' }}>
            <div
              style={{
                fontSize: '14px',
                color: 'var(--text-secondary)',
                marginBottom: '8px',
              }}
            >
              默认下载目录
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <div
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  backgroundColor: 'var(--bg-color)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {downloadPath || '加载中...'}
              </div>
              <button
                onClick={handleSelectDirectory}
                disabled={isSaving}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 16px',
                  backgroundColor: 'var(--accent-color)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                  opacity: isSaving ? 0.7 : 1,
                  transition: 'all 0.15s ease',
                }}
              >
                <Folder size={16} />
                选择目录
              </button>
              <button
                onClick={handleResetDownloadPath}
                disabled={isSaving}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 16px',
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                  opacity: isSaving ? 0.7 : 1,
                  transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => {
                  if (!isSaving) {
                    e.currentTarget.style.borderColor = 'var(--text-tertiary)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }}
              >
                <RefreshCw size={16} />
                重置
              </button>
            </div>
          </div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-tertiary)',
            }}
          >
            下载的音乐文件将保存到此目录
          </div>
        </div>
      </section>

      {/* API 设置 */}
      <section style={{ marginBottom: '32px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '20px',
          }}
        >
          <Link size={20} color="var(--accent-color)"></Link>
          <h2
            style={{
              fontSize: '18px',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            API 设置
          </h2>
        </div>

        <div
          style={{
            backgroundColor: 'var(--content-bg)',
            borderRadius: '12px',
            padding: '24px',
            border: '1px solid var(--border-color)',
          }}
        >
          <div style={{ marginBottom: '16px' }}>
            <div
              style={{
                fontSize: '14px',
                color: 'var(--text-secondary)',
                marginBottom: '8px',
              }}
            >
              音乐 API 服务地址
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="请输入 API 地址，例如：https://your-api.com/"
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  backgroundColor: 'var(--bg-color)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                  outline: 'none',
                }}
              />
              <button
                onClick={() => handleSaveApiUrl(apiUrl)}
                disabled={isSaving}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '10px 16px',
                  backgroundColor: 'var(--accent-color)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '8px',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: isSaving ? 'not-allowed' : 'pointer',
                  opacity: isSaving ? 0.7 : 1,
                }}
              >
                保存
              </button>
            </div>
          </div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-tertiary)',
            }}
          >
            设置音乐搜索/播放所需的 API 服务地址，保存后需重启应用生效
          </div>
        </div>
      </section>

      {/* 关于 */}
      <section>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginBottom: '20px',
          }}
        >
          <Info size={20} color="var(--accent-color)" />
          <h2
            style={{
              fontSize: '18px',
              fontWeight: 600,
              color: 'var(--text-primary)',
            }}
          >
            关于
          </h2>
        </div>

        <div
          style={{
            backgroundColor: 'var(--content-bg)',
            borderRadius: '12px',
            padding: '24px',
            border: '1px solid var(--border-color)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
            <div
              style={{
                width: '60px',
                height: '60px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #2D3436 0%, #636E72 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Music size={28} color="white" />
            </div>
            <div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '4px' }}>
                MPlayer
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                简约优雅的音乐播放器
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: '12px',
              fontSize: '14px',
            }}
          >
            <div style={{ color: 'var(--text-secondary)' }}>
              版本: <span style={{ color: 'var(--text-primary)' }}>1.0.0</span>
            </div>
            <div style={{ color: 'var(--text-secondary)' }}>
              技术栈: <span style={{ color: 'var(--text-primary)' }}>Electron + React + TypeScript</span>
            </div>
          </div>
        </div>
      </section>

      {/* 确认弹窗 */}
      {showClearConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowClearConfirm(false)}
        >
          <div
            style={{
              width: '360px',
              backgroundColor: 'var(--content-bg)',
              borderRadius: '12px',
              padding: '24px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: '#FF6B6B20',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px',
              }}
            >
              <Trash2 size={24} color="#FF6B6B" />
            </div>

            <h3
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: '8px',
              }}
            >
              清除缓存
            </h3>

            <p style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              确定要清除所有缓存吗？此操作不可恢复。
            </p>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowClearConfirm(false)}
                style={{
                  padding: '8px 16px',
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                取消
              </button>
              <button
                onClick={handleClearCache}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#FF6B6B',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '14px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                确定清除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
