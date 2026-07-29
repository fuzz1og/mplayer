import React, { useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Song } from '@mplayer/core';
import SongRow from './SongRow';

interface SongListVirtualProps {
  songs: Song[];
  currentSongId?: string;
  isPlaying?: boolean;
  favoriteIds?: string[];
  onPlay: (song: Song) => void;
  onToggleFavorite?: (song: Song) => void;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  showCheckbox?: boolean;
  showRemoveFromPlaylist?: boolean;
  onRemoveFromPlaylist?: (song: Song) => void;
  onDownload?: (song: Song) => void;
  onAddToPlaylist?: (song: Song) => void;
}

const THRESHOLD = 30;

const SongListVirtual: React.FC<SongListVirtualProps> = ({
  songs, currentSongId, isPlaying, favoriteIds = [],
  onPlay, onToggleFavorite, selectedIds, onSelectionChange,
  showCheckbox = false, showRemoveFromPlaylist = false,
  onRemoveFromPlaylist, onDownload, onAddToPlaylist,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [activeDropdown, setActiveDropdown] = React.useState<string | null>(null);

  const handleToggleDropdown = useCallback((songId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveDropdown(prev => prev === songId ? null : songId);
  }, []);

  const handleCloseDropdown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setActiveDropdown(null);
  }, []);

  const handleToggleSelect = useCallback((songId: string) => {
    if (!onSelectionChange) return;
    const current = selectedIds ?? [];
    if (current.includes(songId)) {
      onSelectionChange(current.filter(id => id !== songId));
    } else {
      onSelectionChange([...current, songId]);
    }
  }, [selectedIds, onSelectionChange]);

  if (songs.length < THRESHOLD) {
    return (
      <div>
        {songs.map((song, index) => (
          <SongRow
            key={song.id}
            song={song}
            index={index}
            isCurrentSong={currentSongId === song.id}
            isPlaying={isPlaying ?? false}
            isFavorite={favoriteIds.includes(song.id)}
            showIndex={true}
            showCheckbox={showCheckbox}
            isSelected={selectedIds?.includes(song.id) ?? false}
            showRemoveFromPlaylist={showRemoveFromPlaylist}
            activeDropdown={activeDropdown}
            onPlay={onPlay}
            onToggleFavorite={onToggleFavorite}
            onDownload={onDownload}
            onAddToPlaylist={onAddToPlaylist}
            onRemoveFromPlaylist={onRemoveFromPlaylist}
            onToggleSelect={handleToggleSelect}
            onToggleDropdown={handleToggleDropdown}
            onCloseDropdown={handleCloseDropdown}
          />
        ))}
      </div>
    );
  }

  const virtualizer = useVirtualizer({
    count: songs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 60,
    overscan: 10,
  });

  return (
    <div ref={parentRef} style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const song = songs[virtualItem.index];
          const isCurrentSong = currentSongId === song.id;
          const isFavorite = favoriteIds.includes(song.id);
          const isSelected = selectedIds?.includes(song.id) ?? false;

          return (
            <div
              key={song.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <SongRow
                song={song}
                index={virtualItem.index}
                isCurrentSong={isCurrentSong}
                isPlaying={isPlaying ?? false}
                isFavorite={isFavorite}
                showIndex={true}
                showCheckbox={showCheckbox}
                isSelected={isSelected}
                showRemoveFromPlaylist={showRemoveFromPlaylist}
                activeDropdown={activeDropdown}
                onPlay={onPlay}
                onToggleFavorite={onToggleFavorite}
                onDownload={onDownload}
                onAddToPlaylist={onAddToPlaylist}
                onRemoveFromPlaylist={onRemoveFromPlaylist}
                onToggleSelect={handleToggleSelect}
                onToggleDropdown={handleToggleDropdown}
                onCloseDropdown={handleCloseDropdown}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SongListVirtual;
