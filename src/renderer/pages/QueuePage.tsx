import React from 'react';
import { useNavigate } from 'react-router-dom';
import QueuePanel from '@/renderer/components/QueuePanel';

/**
 * 旧 /queue 路由兼容（#707）：队列不再是独立页面，统一渲染右侧非模态面板。
 * 正常入口（播放栏队列按钮 / 侧栏）由 App 直接打开全局 QueuePanel，不改变当前路由。
 */
const QueuePage: React.FC = () => {
  const navigate = useNavigate();
  return (
    <QueuePanel
      standalone
      onClose={() => {
        if (window.history.length > 1) navigate(-1);
        else navigate('/recommend');
      }}
    />
  );
};

export default QueuePage;
