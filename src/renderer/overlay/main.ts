import '@/renderer/styles/lyric-overlay.css';
import { mountLyricOverlay } from './lyricOverlayApp';

const root = document.getElementById('lyric-overlay-root');
if (root && window.lyricOverlay) {
  mountLyricOverlay(root, window.lyricOverlay);
}
