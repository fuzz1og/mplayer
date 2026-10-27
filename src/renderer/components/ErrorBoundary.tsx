import React from 'react';

/**
 * 渲染层错误边界。
 * 桌面端窗口没有 URL、没有刷新、没有返回键——渲染层任何一处抛错,在加边界之前会整窗变白、只剩一行 
 * TypeError,侧边栏/播放器/设置全消失,用户只能重启应用。
 */
interface Props {
  children: React.ReactNode;
  /** 出错时展示的兜底内容;不传则用默认兜底 */
  fallback?: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // 只记日志,不吞错——原始堆栈仍要在 DevTools 里看得到
    console.error('[ErrorBoundary] 渲染层出错:', error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <div className="errb">
        <div className="errb__title">这个页面出错了</div>
        <div className="errb__msg">{error.message}</div>
        <button onClick={this.handleReset} className="errb__retry">重试</button>
      </div>
    );
  }
}

export default ErrorBoundary;
