import React, { useState } from 'react';
import { Play, Heart, MoreHorizontal, Download, Trash2, ListMusic } from 'lucide-react';
import type { Song } from '@/shared/types/song';
import AddToPlaylistModal from './AddToPlaylistModal';
import BatchAddToPlaylistModal from './BatchAddToPlaylistModal';
import { useCachedCover } from '@/renderer/services/coverCacheService';

const CachedCoverImage: React.FC<{ coverUrl: string; alt: string; style: React.CSSProperties }> = ({ coverUrl, alt, style }) => {
  const src = useCachedCover(coverUrl);
  return <img src={src} alt={alt} loading="lazy" style={style} />;
};

interface SongListProps {
  songs: Song[];
  currentSongId?: string;
  isPlaying?: boolean;
  favoriteIds?: string[];
  onPlay: (song: Song) => void;
  onToggleFavorite?: (song: Song) => void;
  showHeader?: boolean;
  showIndex?: boolean;
  showCheckbox?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (selectedIds: string[]) => void;
  emptyText?: string;
  enableBatchDownload?: boolean;
  onBatchDownload?: (songs: Song[]) => void;
  onDownload?: (song: Song) => void;
  enableBatchDelete?: boolean;
  onBatchDelete?: (songs: Song[]) => void;
  onAddToPlaylist?: (song: Song) => void;
  enableBatchAddToPlaylist?: boolean;
  onBatchAddToPlaylist?: (songs: Song[]) => void;
  showRemoveFromPlaylist?: boolean;
  onRemoveFromPlaylist?: (song: Song) => void;
}

const SongList: React.FC<SongListProps> = ({
  songs,
  currentSongId,
  isPlaying,
  favoriteIds = [],
  onPlay,
  onToggleFavorite,
  showHeader = true,
  showIndex = true,
  showCheckbox = false,
  selectedIds: externalSelectedIds,
  onSelectionChange: externalOnSelectionChange,
  emptyText = '暂无歌曲',
  enableBatchDownload = false,
  onBatchDownload,
  onDownload,
  enableBatchDelete = false,
  onBatchDelete,
  onAddToPlaylist,
  enableBatchAddToPlaylist = false,
  onBatchAddToPlaylist,
  showRemoveFromPlaylist = false,
  onRemoveFromPlaylist,
}) => {
  // 内部状态管理（当外部没有提供时）
  const [internalSelectedIds, setInternalSelectedIds] = useState<string[]>([]);
  // 下拉菜单状态
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  // 加入歌单弹窗状态
  const [showAddToPlaylistModal, setShowAddToPlaylistModal] = useState(false);
  const [selectedSongForPlaylist, setSelectedSongForPlaylist] = useState<Song | null>(null);
  // 批量加入歌单弹窗状态
  const [showBatchAddToPlaylistModal, setShowBatchAddToPlaylistModal] = useState(false);
  const [selectedSongsForPlaylist, setSelectedSongsForPlaylist] = useState<Song[]>([]);

  // 使用外部或内部状态
  const selectedIds = externalSelectedIds !== undefined ? externalSelectedIds : internalSelectedIds;
  const onSelectionChange = externalOnSelectionChange || setInternalSelectedIds;

  const handleToggleDropdown = (songId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[SongList] 更多按钮被点击, songId:', songId);
    setActiveDropdown(activeDropdown === songId ? null : songId);
  };

  const handleCloseDropdown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveDropdown(null);
  };

  const handleDownloadClick = (song: Song, e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[SongList] 下载按钮被点击, song:', song);
    if (onDownload) {
      console.log('[SongList] 调用 onDownload 回调');
      onDownload(song);
    } else {
      console.warn('[SongList] onDownload 回调未定义');
    }
    setActiveDropdown(null);
  };

  const handleAddToPlaylistClick = (song: Song, e: React.MouseEvent) => {
    e.stopPropagation();
    console.log('[SongList] 加入歌单按钮被点击, song:', song);
    setSelectedSongForPlaylist(song);
    setShowAddToPlaylistModal(true);
    setActiveDropdown(null);
  };

  const handleRemoveFromPlaylist = (song: Song, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRemoveFromPlaylist) {
      onRemoveFromPlaylist(song);
    }
    setActiveDropdown(null);
  };

  const handleAddToPlaylistSuccess = () => {
    if (onAddToPlaylist && selectedSongForPlaylist) {
      onAddToPlaylist(selectedSongForPlaylist);
    }
  };

  const handleToggleSelect = (songId: string) => {
    if (selectedIds.includes(songId)) {
      onSelectionChange(selectedIds.filter(id => id !== songId));
    } else {
      onSelectionChange([...selectedIds, songId]);
    }
  };

  const handleToggleSelectAll = () => {
    if (selectedIds.length === songs.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(songs.map(song => song.id));
    }
  };

  const handleBatchDownload = () => {
    if (!onBatchDownload || selectedIds.length === 0) return;
    const selectedSongs = songs.filter(song => selectedIds.includes(song.id));
    onBatchDownload(selectedSongs);
    // 清空选择
    onSelectionChange([]);
  };

  const handleBatchDelete = () => {
    if (!onBatchDelete || selectedIds.length === 0) return;
    const selectedSongs = songs.filter(song => selectedIds.includes(song.id));
    onBatchDelete(selectedSongs);
    // 清空选择
    onSelectionChange([]);
  };

  const handleBatchAddToPlaylist = () => {
    if (!onBatchAddToPlaylist || selectedIds.length === 0) return;
    const selectedSongs = songs.filter(song => selectedIds.includes(song.id));
    setSelectedSongsForPlaylist(selectedSongs);
    setShowBatchAddToPlaylistModal(true);
  };

  // 是否显示批量操作按钮栏
  const showBatchActionBar = (enableBatchDownload || enableBatchDelete || enableBatchAddToPlaylist) && selectedIds.length > 0;

  if (songs.length === 0) {
    return (
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
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎵</div>
        <div style={{ fontSize: '14px' }}>{emptyText}</div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%' }}>
      {/* 批量操作按钮栏 */}
      {(enableBatchDownload || enableBatchDelete) && (
        <div
          style={{
            height: showBatchActionBar ? '56px' : '0px',
            opacity: showBatchActionBar ? 1 : 0,
            overflow: 'hidden',
            marginBottom: showBatchActionBar ? '16px' : '0px',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              backgroundColor: 'var(--hover-bg)',
              borderRadius: '8px',
              transform: showBatchActionBar ? 'translateY(0)' : 'translateY(-10px)',
              transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          >
            <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
              已选择 {selectedIds.length} 首歌曲
            </span>
            <div style={{ display: 'flex', gap: '12px' }}>
              {enableBatchDownload && (
                <button
                  onClick={handleBatchDownload}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    backgroundColor: 'var(--primary-color)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '20px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--primary-hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--primary-color)';
                  }}
                >
                  <Download size={16} />
                  批量下载
                </button>
              )}
              {enableBatchAddToPlaylist && (
                <button
                  onClick={handleBatchAddToPlaylist}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    backgroundColor: '#4ECDC4',
                    color: 'white',
                    border: 'none',
                    borderRadius: '20px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#45B7AA';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#4ECDC4';
                  }}
                >
                  <ListMusic size={16} />
                  批量加入歌单
                </button>
              )}
              {enableBatchDelete && (
                <button
                  onClick={handleBatchDelete}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 16px',
                    backgroundColor: '#FF6B6B',
                    color: 'white',
                    border: 'none',
                    borderRadius: '20px',
                    fontSize: '13px',
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#EE5A6F';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#FF6B6B';
                  }}
                >
                  <Trash2 size={16} />
                  批量删除
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 表头 */}
      {showHeader && (
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
          {showCheckbox && (
            <div style={{ width: '40px', textAlign: 'center' }}>
              <input
                type="checkbox"
                checked={songs.length > 0 && selectedIds.length === songs.length}
                onChange={handleToggleSelectAll}
                style={{
                  cursor: 'pointer',
                  width: '16px',
                  height: '16px',
                  accentColor: 'var(--accent-color)'
                }}
              />
            </div>
          )}
          {showIndex && (
            <div style={{ width: '50px', textAlign: 'center' }}>#</div>
          )}
          <div style={{ flex: 1 }}>标题</div>
          <div style={{ width: '120px' }}>专辑</div>
          <div style={{ width: '100px', textAlign: 'center' }}>操作</div>
        </div>
      )}

      {/* 歌曲列表 */}
      <div>
        {songs.map((song, index) => {
          const isCurrentSong = currentSongId === song.id;
          const isFavorite = favoriteIds.includes(song.id);

          return (
            <div
              key={song.id}
              onDoubleClick={() => onPlay(song)}
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
              {/* 复选框 */}
              {showCheckbox && (
                <div style={{ width: '40px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(song.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      handleToggleSelect(song.id);
                    }}
                    style={{
                      cursor: 'pointer',
                      width: '16px',
                      height: '16px',
                      accentColor: 'var(--accent-color)'
                    }}
                  />
                </div>
              )}
              {/* 序号/播放图标 */}
              {showIndex && (
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
              )}

              {/* 歌曲信息 */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                {/* 封面 */}
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
                    <CachedCoverImage
                      coverUrl={song.cover}
                      alt={song.name}
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

                  {/* 悬停播放按钮 */}
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
                    onClick={() => onPlay(song)}
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

                {/* 歌曲名和歌手 */}
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
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {song.artist}
                    </span>
                    {song.sourceType === 'netease' && (
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 5px',
                        borderRadius: '3px',
                        backgroundColor: '#FF6B6B',
                        color: 'white',
                        flexShrink: 0,
                      }}>网易云</span>
                    )}
                    {song.sourceType === 'qq' && (
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 5px',
                        borderRadius: '3px',
                        backgroundColor: '#49B8FF',
                        color: 'white',
                        flexShrink: 0,
                      }}>QQ</span>
                    )}
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
                  width: '100px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                }}
              >
                {onToggleFavorite && (
                  <button
                    onClick={() => onToggleFavorite(song)}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      padding: '6px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: isFavorite ? 'var(--accent-color)' : 'var(--text-tertiary)',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    <Heart size={16} fill={isFavorite ? 'currentColor' : 'none'} />
                  </button>
                )}
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={(e) => handleToggleDropdown(song.id, e)}
                    style={{
                      border: 'none',
                      background: activeDropdown === song.id ? 'var(--hover-bg)' : 'transparent',
                      cursor: 'pointer',
                      padding: '6px',
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: activeDropdown === song.id ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      if (activeDropdown !== song.id) {
                        e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                        e.currentTarget.style.color = 'var(--text-secondary)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (activeDropdown !== song.id) {
                        e.currentTarget.style.backgroundColor = 'transparent';
                        e.currentTarget.style.color = 'var(--text-tertiary)';
                      }
                    }}
                  >
                    <MoreHorizontal size={16} />
                  </button>

                  {/* 下拉菜单 */}
                  {activeDropdown === song.id && (
                    <>
                      {/* 遮罩层，点击关闭下拉菜单 */}
                      <div
                        style={{
                          position: 'fixed',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          zIndex: 99,
                        }}
                        onClick={handleCloseDropdown}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          right: '0',
                          marginTop: '4px',
                          backgroundColor: 'var(--bg-color)',
                          border: '1px solid var(--divider-color)',
                          borderRadius: '8px',
                          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                          zIndex: 100,
                          minWidth: '120px',
                          padding: '4px',
                        }}
                      >
                        {showRemoveFromPlaylist && onRemoveFromPlaylist && (
                          <>
                            <button
                              onClick={(e) => handleRemoveFromPlaylist(song, e)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                width: '100%',
                                padding: '8px 12px',
                                border: 'none',
                                background: 'transparent',
                                cursor: 'pointer',
                                borderRadius: '4px',
                                fontSize: '13px',
                                color: '#FF6B6B',
                                transition: 'all 0.15s ease',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = 'rgba(255, 107, 107, 0.1)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                              }}
                            >
                              <Trash2 size={14} />
                              从歌单移除
                            </button>
                            <div style={{
                              height: '1px',
                              backgroundColor: 'var(--divider-color)',
                              margin: '4px 0',
                            }} />
                          </>
                        )}
                        <button
                          onClick={(e) => handleAddToPlaylistClick(song, e)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            width: '100%',
                            padding: '8px 12px',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            borderRadius: '4px',
                            fontSize: '13px',
                            color: 'var(--text-primary)',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }}
                        >
                          <ListMusic size={14} />
                          加入歌单
                        </button>
                        <button
                          onClick={(e) => handleDownloadClick(song, e)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            width: '100%',
                            padding: '8px 12px',
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            borderRadius: '4px',
                            fontSize: '13px',
                            color: 'var(--text-primary)',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--hover-bg)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }}
                        >
                          <Download size={14} />
                          下载
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes soundBar {
          0%, 100% { transform: scaleY(0.5); }
          50% { transform: scaleY(1); }
        }
      `}</style>

      {/* 加入歌单弹窗 */}
      {selectedSongForPlaylist && (
        <AddToPlaylistModal
          song={selectedSongForPlaylist}
          isVisible={showAddToPlaylistModal}
          onClose={() => {
            setShowAddToPlaylistModal(false);
            setSelectedSongForPlaylist(null);
          }}
          onSuccess={handleAddToPlaylistSuccess}
        />
      )}

      {/* 批量加入歌单弹窗 */}
      {selectedSongsForPlaylist.length > 0 && (
        <BatchAddToPlaylistModal
          songs={selectedSongsForPlaylist}
          isVisible={showBatchAddToPlaylistModal}
          onClose={() => {
            setShowBatchAddToPlaylistModal(false);
            setSelectedSongsForPlaylist([]);
            // 清空选择
            onSelectionChange([]);
          }}
          onSuccess={() => {
            if (onBatchAddToPlaylist) {
              onBatchAddToPlaylist(selectedSongsForPlaylist);
            }
          }}
        />
      )}
    </div>
  );
};

export default SongList;
