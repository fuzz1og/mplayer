import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import router from './router';
import { ThemeManager } from './theme/ThemeManager';
import { installRendererLogCapture } from './services/rendererLogStore';
import { initDevMode } from './services/devMode';
import './styles/global.css';

// #477：开发者模式的持久开关 + 渲染层 console 全局捕获，都必须在渲染前接线一次。
initDevMode();
installRendererLogCapture();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeManager>
      <RouterProvider router={router} />
    </ThemeManager>
  </React.StrictMode>
);
