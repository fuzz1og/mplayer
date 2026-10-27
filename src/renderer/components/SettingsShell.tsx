import React, { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@/renderer/ui';

/**
 * 设置全屏壳：1.9.0 起设置不再是「侧栏 + 二级导航 + 内容」三层，而是整窗视图。
 * 进入时侧栏/顶栏/播放栏由 .app-shell--settings 隐藏（播放器不卸载，播放不中断），
 * 退出走左上返回或 ESC。
 */
const SettingsShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();

  const close = useCallback(() => {
    // navigate(-1) 在 hash 路由下就是上一页；直接打开 settings 深链时没有上一页，回推荐页兜底。
    if (window.history.length > 1) navigate(-1);
    else navigate('/recommend');
  }, [navigate]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

  return (
    <div className="settings-shell">
      <header className="settings-shell__bar">
        <Button variant="ghost" size="sm" icon={<ChevronLeft size={15} />} onClick={close}>
          返回
        </Button>
        <span className="settings-shell__title">设置</span>
      </header>
      <div className="settings-shell__body">{children}</div>
    </div>
  );
};

export default SettingsShell;
