import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import router from './router';
import { ThemeManager } from './theme/ThemeManager';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeManager>
      <RouterProvider router={router} />
    </ThemeManager>
  </React.StrictMode>
);
