import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useUpdateStore, isUpdatePending } from '../store/updateStore';

/**
 * 渲染层更新状态桥（#579 / ADR 不变量 I2、I3）。
 * `window.electronAPI` 由 `src/renderer/__tests__/setup.ts` 注入为 vi.fn 桩。
 */
const ipc = window.electronAPI as unknown as {
  invoke: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  removeListener: ReturnType<typeof vi.fn>;
};

const IDLE_STATE = { status: 'idle' as const, version: '', progress: 0, error: '', sourceLabel: '' };

/** 让已 resolve 的 promise 回调跑完 */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('updateStore（#579）', () => {
  let unsubscribe: (() => void) | null = null;
  let pushHandler: ((event: unknown, payload: unknown) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    pushHandler = null;
    vi.mocked(ipc.on).mockImplementation((_channel: string, handler: any) => {
      pushHandler = handler;
      return () => {};
    });
    ipc.invoke.mockResolvedValue(IDLE_STATE);
    useUpdateStore.setState(IDLE_STATE);
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  describe('isUpdatePending', () => {
    it('available / downloading / downloaded 都算有更新', () => {
      expect(isUpdatePending('available')).toBe(true);
      expect(isUpdatePending('downloading')).toBe(true);
      expect(isUpdatePending('downloaded')).toBe(true);
    });

    it('其余状态不算（徽标不亮）', () => {
      expect(isUpdatePending('idle')).toBe(false);
      expect(isUpdatePending('checking')).toBe(false);
      expect(isUpdatePending('not-available')).toBe(false);
      expect(isUpdatePending('error')).toBe(false);
    });
  });

  describe('applyStatus', () => {
    it('写入状态、版本、进度与通道', () => {
      useUpdateStore.getState().applyStatus({
        status: 'downloading',
        version: '1.9.0',
        progress: { percent: 42, bytesPerSecond: 1, transferred: 1, total: 1 },
        sourceLabel: 'gh-proxy.com 镜像',
      });

      expect(useUpdateStore.getState()).toMatchObject({
        status: 'downloading',
        version: '1.9.0',
        progress: 42,
        sourceLabel: 'gh-proxy.com 镜像',
      });
    });

    it('不带版本/通道的事件不把它们清空（downloading 途中不丢版本号）', () => {
      useUpdateStore.getState().applyStatus({ status: 'available', version: '1.9.0', sourceLabel: 'gh-proxy.com 镜像' });
      useUpdateStore.getState().applyStatus({ status: 'downloading', progress: { percent: 10, bytesPerSecond: 1, transferred: 1, total: 1 } });

      expect(useUpdateStore.getState()).toMatchObject({ version: '1.9.0', sourceLabel: 'gh-proxy.com 镜像' });
    });
  });

  describe('initUpdateBridge', () => {
    it('订阅 push 并把状态写进 store', async () => {
      unsubscribe = useUpdateStore.getState().initUpdateBridge();
      expect(ipc.on).toHaveBeenCalledWith('update:status', expect.any(Function));
      expect(pushHandler).toBeTypeOf('function');

      pushHandler?.({}, { status: 'available', version: '1.9.0' });
      expect(useUpdateStore.getState().status).toBe('available');
      expect(useUpdateStore.getState().version).toBe('1.9.0');
    });

    it('首帧快照在无 push 时被应用（启动检查早于渲染层就绪的兜底）', async () => {
      ipc.invoke.mockResolvedValue({ status: 'available', version: '1.9.0' });
      unsubscribe = useUpdateStore.getState().initUpdateBridge();
      await flush();

      expect(ipc.invoke).toHaveBeenCalledWith('update:getStatus');
      expect(useUpdateStore.getState().status).toBe('available');
    });

    it('快照晚于 push 到达时整份丢弃，不回退状态（不变量 I3）', async () => {
      ipc.invoke.mockResolvedValue({ status: 'idle' });
      unsubscribe = useUpdateStore.getState().initUpdateBridge();
      // 同步放行一条 push：此刻快照还没落地
      pushHandler?.({}, { status: 'available', version: '1.9.0' });
      await flush();

      expect(useUpdateStore.getState().status).toBe('available');
      expect(useUpdateStore.getState().version).toBe('1.9.0');
    });

    it('幂等：重复调用不重复订阅', () => {
      unsubscribe = useUpdateStore.getState().initUpdateBridge();
      const second = useUpdateStore.getState().initUpdateBridge();
      expect(ipc.on).toHaveBeenCalledTimes(1);
      expect(second).toBeTypeOf('function');
    });

    it('退订后可重新订阅', () => {
      const first = useUpdateStore.getState().initUpdateBridge();
      first();
      unsubscribe = useUpdateStore.getState().initUpdateBridge();
      expect(ipc.on).toHaveBeenCalledTimes(2);
    });
  });
});
