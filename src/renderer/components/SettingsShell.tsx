import React, { useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import '@/renderer/styles/settings.css';

/**
 * 设置全屏壳（原型 §2）：无自带工具条，标题在标题栏中部，退出只走 ESC。
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

  return <div className="settings-shell">{children}</div>;
};

export default SettingsShell;
