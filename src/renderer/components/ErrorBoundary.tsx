import React from 'react';

/**
 * 渲染层错误边界。
 *
 * 桌面端窗口没有 URL、没有刷新、没有返回键——渲染层任何一处抛错,在加边界之前会整窗变白、
 * 只剩一行 TypeError,侧边栏/播放器/设置全消失,用户只能重启应用。
 * 加边界之后,一个页面出错 = 一个页面出错。
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
      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: '12px',
        padding: '32px', color: 'var(--text-secondary)', fontSize: '14px',
      }}>
        <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
          这个页面出错了
        </div>
        <div style={{ maxWidth: '480px', textAlign: 'center', lineHeight: 1.6 }}>
          {error.message}
        </div>
        <button
          onClick={this.handleReset}
          style={{
            marginTop: '4px', padding: '7px 18px',
            backgroundColor: 'var(--accent)', color: 'white',
            border: 'none', borderRadius: '18px', cursor: 'pointer',
            fontSize: '13px', fontWeight: 500,
          }}>
          重试
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
