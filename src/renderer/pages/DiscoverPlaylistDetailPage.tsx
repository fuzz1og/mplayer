import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Play } from 'lucide-react';
import { Modal, message } from 'antd';
import SongList from '@/renderer/components/SongList';
import { playlistService } from '@/renderer/services/playlistService';
import { usePlayerStore } from '@/renderer/store/playerStore';
import type { Song, DiscoverPlaylist } from '@/shared/types/song';
const { ipcRenderer } = window.require('electron');

const formatPlayCount = (count: number): string => {
  if (count >= 100000000) {
    return `${(count / 100000000).toFixed(1)}亿`;
  }
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}万`;
  }
  return count.toString();
};

const DiscoverPlaylistDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { play, currentSong, isPlaying, setCurrentPlaylist } = usePlayerStore();

  const [playlist, setPlaylist] = useState<DiscoverPlaylist | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [songsLoading, setSongsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [songsError, setSongsError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    const loadPlaylist = async () => {
      try {
        setLoading(true);
        const result = await ipcRenderer.invoke('musicApi:getNeteasePlaylistDetail', parseInt(id));
        if (result.success && result.data) {
          setPlaylist(result.data);
        }
      } catch (error) {
        console.error('加载歌单详情失败:', error);
      } finally {
        setLoading(false);
      }
    };
    loadPlaylist();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const loadSongs = async () => {
      try {
        setSongsLoading(true);
        setSongsError(null);
        const playlistUrl = `https://music.163.com/#/playlist?id=${id}`;
        const result = await ipcRenderer.invoke('musicApi:getPlaylistSongsFromThirdParty', playlistUrl);
        if (result.success && result.data) {
          setSongs(result.data);
        } else {
          setSongsError('加载歌曲失败，请稍后重试');
        }
      } catch (error) {
        console.error('加载歌单歌曲失败:', error);
        setSongsError('加载歌曲失败，请稍后重试');
      } finally {
        setSongsLoading(false);
      }
    };
    loadSongs();
  }, [id]);

  const handlePlay = async (song: Song) => {
    await play(song);
  };

  const handlePlayAll = async () => {
    if (songs.length > 0) {
      setCurrentPlaylist(songs, 0);
      await play(songs[0]);
    }
  };

  const handleSaveToLocal = () => {
    if (!playlist) return;
    Modal.confirm({
      title: '保存到本地',
      content: `确定要将歌单"${playlist.name}"（${songs.length}首歌曲）保存到本地吗？`,
      okText: '保存',
      cancelText: '取消',
      onOk: async () => {
        try {
          setSaving(true);
          const playlistId = await playlistService.createPlaylist(
            playlist.name,
            playlist.description || `来自网易云歌单: ${playlist.name}`
          );
          let addedCount = 0;
          for (const song of songs) {
            try {
              await playlistService.addSongToPlaylist(playlistId, song);
              addedCount++;
            } catch (e) {
              console.error('添加歌曲失败:', song.name, e);
            }
          }
          message.success(`成功保存 ${addedCount} 首歌曲到本地歌单`);
          navigate('/playlists');
        } catch (error) {
          console.error('保存到本地失败:', error);
          message.error('保存失败，请稍后重试');
        } finally {
          setSaving(false);
        }
      },
    });
  };

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 24px', borderBottom: '1px solid var(--divider-color)', backgroundColor: 'var(--content-bg)', height: '60px' }}>
          <button onClick={() => navigate(-1)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '10px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '14px' }}>
            <ArrowLeft size={16} /><span>返回</span>
          </button>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', flex: 1, margin: 0, textAlign: 'center' }}>加载中...</h1>
          <div style={{ width: '140px' }} />
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>加载中...</div>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 24px', borderBottom: '1px solid var(--divider-color)', backgroundColor: 'var(--content-bg)', height: '60px' }}>
          <button onClick={() => navigate(-1)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '10px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '14px' }}>
            <ArrowLeft size={16} /><span>返回</span>
          </button>
          <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', flex: 1, margin: 0, textAlign: 'center' }}>歌单不存在</h1>
          <div style={{ width: '140px' }} />
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>歌单不存在或加载失败</div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '12px 24px', borderBottom: '1px solid var(--divider-color)', backgroundColor: 'var(--content-bg)', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)', height: '60px' }}>
        <button onClick={() => navigate(-1)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '10px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', transition: 'all 0.2s ease', fontSize: '14px', fontWeight: 500 }} onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--hover-bg)'; e.currentTarget.style.color = 'var(--text-primary)'; }} onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}>
          <ArrowLeft size={16} /><span>返回</span>
        </button>
        <h1 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', flex: 1, margin: 0, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{playlist.name}</h1>
        <div style={{ width: '140px' }} />
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        <div style={{ display: 'flex', gap: '24px', marginBottom: '32px' }}>
          <div style={{ width: '200px', height: '200px', borderRadius: '12px', overflow: 'hidden', flexShrink: 0, boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)' }}>
            <img src={playlist.coverImgUrl} alt={playlist.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px', marginTop: 0 }}>{playlist.name}</h2>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '12px', fontSize: '13px', color: 'var(--text-tertiary)' }}>
              <span>创建者: {playlist.creator.nickname}</span>
              <span>播放量: {formatPlayCount(playlist.playCount)}</span>
              <span>歌曲数: {playlist.trackCount}</span>
            </div>
            {playlist.tags.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                {playlist.tags.map(tag => (
                  <span key={tag} style={{ padding: '2px 10px', borderRadius: '12px', fontSize: '12px', backgroundColor: 'var(--hover-bg)', color: 'var(--text-secondary)' }}>{tag}</span>
                ))}
              </div>
            )}
            {playlist.description && (
              <p style={{ fontSize: '13px', color: 'var(--text-tertiary)', marginBottom: '16px', marginTop: 0, lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{playlist.description}</p>
            )}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={handlePlayAll} disabled={songs.length === 0 || songsLoading} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 24px', borderRadius: '24px', border: 'none', backgroundColor: 'var(--accent-color)', color: 'white', fontSize: '14px', fontWeight: 500, cursor: songs.length === 0 || songsLoading ? 'not-allowed' : 'pointer', opacity: songs.length === 0 || songsLoading ? 0.6 : 1, transition: 'all 0.2s ease' }}>
                <Play size={16} />播放全部
              </button>
              <button onClick={handleSaveToLocal} disabled={songs.length === 0 || saving} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 24px', borderRadius: '24px', border: '1px solid var(--border-color)', backgroundColor: 'transparent', color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500, cursor: songs.length === 0 || saving ? 'not-allowed' : 'pointer', opacity: songs.length === 0 || saving ? 0.6 : 1, transition: 'all 0.2s ease' }}>
                <Download size={16} />{saving ? '保存中...' : '保存到本地'}
              </button>
            </div>
          </div>
        </div>

        {songsLoading ? (
          <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: '40px' }}>正在加载歌曲列表...</div>
        ) : songsError ? (
          <div style={{ padding: '12px 16px', backgroundColor: 'var(--danger-bg)', borderRadius: '8px', color: 'var(--danger-color)', textAlign: 'center' }}>
            {songsError}
          </div>
        ) : (
          <SongList songs={songs} currentSongId={currentSong?.id} isPlaying={isPlaying} onPlay={handlePlay} showHeader={true} showIndex={true} showCheckbox={true} enableBatchDownload={true} enableBatchAddToPlaylist={true} emptyText="暂无歌曲数据" />
        )}
      </div>
    </div>
  );
};

export default DiscoverPlaylistDetailPage;
