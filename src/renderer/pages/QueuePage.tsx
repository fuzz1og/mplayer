import React, { useState } from 'react';
import { Headphones, Play, Trash2, ArrowUp, ArrowDown, ListMusic } from 'lucide-react';
import { Modal } from 'antd';
import { usePlayerStore } from '@/renderer/store/playerStore';
import BatchAddToPlaylistModal from '@/renderer/components/BatchAddToPlaylistModal';
import type { Song } from '@/shared/types/song';

const QueuePage: React.FC = () => {
  const {
    currentPlaylist,
    currentSong,
    isPlaying,
    play,
    removeFromQueue,
    reorderQueue,
    clearQueue,
  } = usePlayerStore();

  const [showBatchModal, setShowBatchModal] = useState(false);
  const [selectedSongsForPlaylist, setSelectedSongsForPlaylist] = useState<Song[]>([]);

  const handlePlaySong = (song: Song) => {
    play(song);
  };

  const handleClearQueue = () => {
    Modal.confirm({
      title: '清空队列',
      content: '确定要清空试听列表吗？',
      okText: '清空',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => clearQueue(),
    });
  };

  const handleSaveToPlaylist = () => {
    if (currentPlaylist.length === 0) return;
    setSelectedSongsForPlaylist([...currentPlaylist]);
    setShowBatchModal(true);
  };

  const handleMoveUp = (index: number) => {
    if (index > 0) reorderQueue(index, index - 1);
  };

  const handleMoveDown = (index: number) => {
    if (index < currentPlaylist.length - 1) reorderQueue(index, index + 1);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 页面标题 */}
      <div
        style={{
          padding: '24px 24px 16px',
          borderBottom: '1px solid var(--divider-color)',
          backgroundColor: 'var(--content-bg)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Headphones size={24} color="var(--accent-color)" />
            <h1 style={{ fontSize: '24px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              试听列表
            </h1>
            <span style={{ fontSize: '14px', color: 'var(--text-tertiary)', marginLeft: '8px' }}>
              {currentPlaylist.length} 首歌曲
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleClearQueue}
              disabled={currentPlaylist.length === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                backgroundColor: 'transparent',
                color: currentPlaylist.length > 0 ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                border: '1px solid var(--divider-color)',
                borderRadius: '20px',
                cursor: currentPlaylist.length > 0 ? 'pointer' : 'not-allowed',
                fontSize: '14px',
                fontWeight: 500,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (currentPlaylist.length > 0) {
                  e.currentTarget.style.borderColor = '#FF6B6B';
                  e.currentTarget.style.color = '#FF6B6B';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--divider-color)';
                e.currentTarget.style.color = currentPlaylist.length > 0 ? 'var(--text-secondary)' : 'var(--text-tertiary)';
              }}
            >
              <Trash2 size={16} />
              清空队列
            </button>
            <button
              onClick={handleSaveToPlaylist}
              disabled={currentPlaylist.length === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                backgroundColor: currentPlaylist.length > 0 ? '#4ECDC4' : 'var(--hover-bg)',
                color: currentPlaylist.length > 0 ? 'white' : 'var(--text-tertiary)',
                border: 'none',
                borderRadius: '20px',
                cursor: currentPlaylist.length > 0 ? 'pointer' : 'not-allowed',
                fontSize: '14px',
                fontWeight: 500,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (currentPlaylist.length > 0) {
                  e.currentTarget.style.backgroundColor = '#45B7AA';
                }
              }}
              onMouseLeave={(e) => {
                if (currentPlaylist.length > 0) {
                  e.currentTarget.style.backgroundColor = '#4ECDC4';
                }
              }}
            >
              <ListMusic size={16} />
              保存为歌单
            </button>
          </div>
        </div>
      </div>

      {/* 歌曲列表 */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {currentPlaylist.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 20px',
              color: 'var(--text-tertiary)',
            }}
          >
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎧</div>
            <div style={{ fontSize: '14px' }}>暂无歌曲，去发现音乐吧</div>
          </div>
        ) : (
          <>
            {/* 表头 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 16px',
                borderBottom: '1px solid var(--divider-color)',
                fontSize: '12px',
                color: 'var(--text-tertiary)',
                fontWeight: 500,
              }}
            >
              <div style={{ width: '50px', textAlign: 'center' }}>#</div>
              <div style={{ flex: 1 }}>标题</div>
              <div style={{ width: '120px' }}>专辑</div>
              <div style={{ width: '140px', textAlign: 'center' }}>操作</div>
            </div>

            {/* 歌曲列表 */}
            <div>
              {currentPlaylist.map((song, index) => {
                const isCurrentSong = currentSong?.id === song.id;

                return (
                  <div
                    key={`${song.id}-${index}`}
                    onDoubleClick={() => handlePlaySong(song)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '10px 16px',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      backgroundColor: isCurrentSong ? 'rgba(116, 185, 255, 0.1)' : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!isCurrentSong) {
                        e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isCurrentSong) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }
                    }}
                  >
                    {/* 序号/播放图标 */}
                    <div style={{ width: '50px', textAlign: 'center' }}>
                      {isCurrentSong && isPlaying ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '2px' }}>
                          <span style={{
                            width: '3px',
                            height: '12px',
                            backgroundColor: 'var(--accent-color)',
                            animation: 'soundBar 0.5s ease-in-out infinite',
                            animationDelay: '0s'
                          }} />
                          <span style={{
                            width: '3px',
                            height: '16px',
                            backgroundColor: 'var(--accent-color)',
                            animation: 'soundBar 0.5s ease-in-out infinite',
                            animationDelay: '0.1s'
                          }} />
                          <span style={{
                            width: '3px',
                            height: '10px',
                            backgroundColor: 'var(--accent-color)',
                            animation: 'soundBar 0.5s ease-in-out infinite',
                            animationDelay: '0.2s'
                          }} />
                        </div>
                      ) : (
                        <span style={{
                          fontSize: '14px',
                          color: isCurrentSong ? 'var(--accent-color)' : 'var(--text-tertiary)',
                          fontWeight: isCurrentSong ? 600 : 400,
                        }}>
                          {index + 1}
                        </span>
                      )}
                    </div>

                    {/* 歌曲信息 */}
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '4px',
                          overflow: 'hidden',
                          backgroundColor: 'var(--hover-bg)',
                          flexShrink: 0,
                          position: 'relative',
                        }}
                      >
                        {song.cover ? (
                          <img
                            src={song.cover}
                            alt={song.name}
                            loading="lazy"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              background: 'linear-gradient(135deg, #E8E8E8 0%, #F0F0F0 100%)',
                            }}
                          >
                            <div
                              style={{
                                width: '16px',
                                height: '16px',
                                borderRadius: '50%',
                                background: '#D0D0D0',
                              }}
                            />
                          </div>
                        )}

                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            backgroundColor: 'rgba(0,0,0,0.4)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: 0,
                            transition: 'opacity 0.15s ease',
                          }}
                          onClick={() => handlePlaySong(song)}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.opacity = '1';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.opacity = '0';
                          }}
                        >
                          <Play size={16} color="white" fill="white" />
                        </div>
                      </div>

                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: '14px',
                            fontWeight: isCurrentSong ? 600 : 400,
                            color: isCurrentSong ? 'var(--accent-color)' : 'var(--text-primary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {song.name}
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--text-secondary)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            marginTop: '2px',
                          }}
                        >
                          {song.artist}
                        </div>
                      </div>
                    </div>

                    {/* 专辑 */}
                    <div
                      style={{
                        width: '120px',
                        fontSize: '13px',
                        color: 'var(--text-secondary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {song.album}
                    </div>

                    {/* 操作按钮 */}
                    <div
                      style={{
                        width: '140px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '2px',
                      }}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); handleMoveUp(index); }}
                        disabled={index === 0}
                        title="上移"
                        style={{
                          border: 'none',
                          background: 'transparent',
                          cursor: index === 0 ? 'not-allowed' : 'pointer',
                          padding: '6px',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: index === 0 ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                          opacity: index === 0 ? 0.3 : 1,
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          if (index > 0) e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleMoveDown(index); }}
                        disabled={index === currentPlaylist.length - 1}
                        title="下移"
                        style={{
                          border: 'none',
                          background: 'transparent',
                          cursor: index === currentPlaylist.length - 1 ? 'not-allowed' : 'pointer',
                          padding: '6px',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: index === currentPlaylist.length - 1 ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                          opacity: index === currentPlaylist.length - 1 ? 0.3 : 1,
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          if (index < currentPlaylist.length - 1) e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeFromQueue(index); }}
                        title="移除"
                        style={{
                          border: 'none',
                          background: 'transparent',
                          cursor: 'pointer',
                          padding: '6px',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--text-tertiary)',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                          e.currentTarget.style.color = '#FF6B6B';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'transparent';
                          e.currentTarget.style.color = 'var(--text-tertiary)';
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes soundBar {
          0%, 100% { transform: scaleY(0.5); }
          50% { transform: scaleY(1); }
        }
      `}</style>

      {/* 保存为歌单弹窗 */}
      <BatchAddToPlaylistModal
        isVisible={showBatchModal}
        songs={selectedSongsForPlaylist}
        onClose={() => {
          setShowBatchModal(false);
          setSelectedSongsForPlaylist([]);
        }}
      />
    </div>
  );
};

export default QueuePage;
