---
name: new-component
description: 在 renderer 中创建新 React 组件，按项目现有模式生成模板。当用户说"创建组件"、"新建组件"、"new component"时触发。
---

# MPlayer 新组件生成

按 MPlayer 现有模式创建组件。

## 使用

```
/new-component ComponentName [dir]
```

默认 `dir` 为 `components`，可选 `pages` / `hooks`。

## 模板

### 组件 (`src/renderer/components/X.tsx`)

```tsx
import { ReactNode } from 'react';

interface XProps {
  // TODO: define props
  children?: ReactNode;
}

export function X({ children }: XProps) {
  return (
    <div className="x">
      {children}
    </div>
  );
}

export default X;
```

- 使用 Ant Design 组件
- lucide-react 图标
- 类型定义在组件文件顶部（不单独建类型文件，除非多个文件共用）
- 默认导出组件

### 页面 (`src/renderer/pages/XPage.tsx`)

```tsx
import { Outlet } from 'react-router-dom';

export function XPage() {
  return (
    <div className="x-page">
      <Outlet />
    </div>
  );
}

export default XPage;
```

### Hook (`src/renderer/hooks/useX.ts`)

```ts
export function useX() {
  return {};
}
```

## 注册路由（仅页面）

在 `src/renderer/router/index.tsx` 添加路由：

```tsx
{
  path: '/x',
  lazy: () => import('../pages/XPage'),
}
```
