import { useEffect } from 'react';
const ipcRenderer = window.electronAPI;
import { usePlayerStore } from '@/renderer/store/playerStore';

export function useGlobalShortcuts(): void {
  useEffect(() => {
    const handler = (_event: any, payload: { type: string }) => {
      const store = usePlayerStore.getState();
      switch (payload.type) {
        case 'playPause':
          store.togglePlay();
          break;
        case 'next':
          store.playNext();
          break;
        case 'prev':
          store.playPrevious();
          break;
      }
    };

    ipcRenderer.on('shortcut:action', handler);
    return () => {
      ipcRenderer.removeListener('shortcut:action', handler);
    };
  }, []);
}
