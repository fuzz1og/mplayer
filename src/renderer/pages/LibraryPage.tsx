import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FolderOpen, Heart, History, Mic2 } from 'lucide-react';
import { Group, Row, Section } from '@/renderer/ui';

interface LibraryEntry {
  key: string;
  label: string;
  detail: string;
  icon: React.ReactNode;
  path: string;
}

/**
 * 资料库（#685 的落点）。1.9.0 把「本地音乐 / 下载管理 / 我的收藏 / 播放历史」四个并列入口
 * 收进本页分段；本批（#682）先保证四个入口各自仍然一次点到，分段视图与页内列表由 #685 补齐。
 */
const ENTRIES: LibraryEntry[] = [
  { key: 'local', label: '本地音乐', detail: '扫描目录与本地曲目', icon: <FolderOpen size={13} />, path: '/local' },
  { key: 'download', label: '下载管理', detail: '进行中与已完成', icon: <Download size={13} />, path: '/download' },
  { key: 'favorites', label: '我喜欢的音乐', detail: '收藏的歌曲', icon: <Heart size={13} />, path: '/favorites' },
  { key: 'history', label: '最近播放', detail: '播放历史', icon: <History size={13} />, path: '/history' },
  { key: 'artists', label: '歌手', detail: '关注与浏览过的歌手', icon: <Mic2 size={13} />, path: '/artists' },
];

const LibraryPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="ui-page">
      <Section title="资料库" footer="分段视图（全部 / 歌曲 / 专辑 / 歌手 / 下载 / 本地）在后续批次补齐，当前先保留每个入口的可达性。">
        <Group>
          {ENTRIES.map((entry) => (
            <Row
              key={entry.key}
              icon={entry.icon}
              label={entry.label}
              detail={entry.detail}
              chevron
              onClick={() => navigate(entry.path)}
            />
          ))}
        </Group>
      </Section>
    </div>
  );
};

export default LibraryPage;
