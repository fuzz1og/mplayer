/**
 * 封面图片加载的**在飞闸门**（移动端）。
 *
 * 为什么需要它：ADR `docs/adr/2026-09-26-outbound-request-governance.md` 决策 5 把
 * **图片**显式排除在 core 出网闸门之外（「两端都是原生 `Image` 直接拉 CDN，不过 core」）。
 * 当时这是如实记录，但在列表页变成了漏洞：模块一挂载就等于立刻发请求，挂多少发多少。
 * 实测（#496）：进歌手页一次挂 100 张专辑封面 → 上游限流 → 后来连已经发出的图也卡住拿不到。
 *
 * 形态与仓内既有并发闸门一致（`services/coverSearchSlot.ts`、tier3 的
 * `MAX_TIER3_IN_FLIGHT`）：**FIFO 排队、固定上限、不拒绝也不丢请求**。默认上限取 6，
 * 与 core 出网闸门（ADR 2026-09-26 决策 1）的全局在飞上限同量级——图片与接口共用同一条
 * 手机上行，封面单独放大没有意义。
 *
 * **死锁自愈**：闸门无法知道 `Image` 是否真的回调（`onLoad` / `onError` 在宿主实现差异下
 * 都可能不来），所以每个槽位自带一条 20s 墙钟，到点强制归还并放行队列。最坏情况是并发
 * 短暂超限，而不是整屏封面永久停在占位。
 */

/** 同时在飞的封面请求上限（= core 出网闸门的全局上限，见 ADR 2026-09-26 决策 1） */
export const COVER_MAX_IN_FLIGHT = 6;

/** 槽位最长持有时间（ms）：持有者不回调时的强制归还墙钟 */
export const COVER_SLOT_TIMEOUT_MS = 20_000;

export interface CoverLoadGateStats {
  /** 当前在飞 */
  inFlight: number;
  /** 当前排队等待槽位的数量 */
  waiting: number;
  /** 历史峰值（诊断用） */
  peak: number;
  /** 累计发放的槽位数 */
  granted: number;
}

export interface CoverSlot {
  /** 槽位到手后 resolve（到手即已占位）。等待期间可以 `release()` 取消排队。 */
  readonly ready: Promise<void>;
  /** 幂等：尚未到手 = 从队列摘除；已到手 = 归还槽位并放行队首。 */
  release(): void;
}

interface PendingEntry {
  cancelled: boolean;
  grant: () => void;
}

/**
 * FIFO 在飞闸门。模块级单例 `coverLoadGate` 给生产用；测试自行 `new CoverLoadGate(n)`。
 */
export class CoverLoadGate {
  private inFlight = 0;
  private peak = 0;
  private grantedCount = 0;
  private readonly queue: PendingEntry[] = [];

  constructor(
    private readonly maxInFlight: number = COVER_MAX_IN_FLIGHT,
    private readonly slotTimeoutMs: number = COVER_SLOT_TIMEOUT_MS,
  ) {}

  stats(): CoverLoadGateStats {
    return {
      inFlight: this.inFlight,
      waiting: this.queue.length,
      peak: this.peak,
      granted: this.grantedCount,
    };
  }

  /** 取一个槽位。上限内立即到手；超限则排队。 */
  acquire(): CoverSlot {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });

    /** waiting = 还在队列里；granted = 占着槽位；done = 已归还或已取消 */
    let state: 'waiting' | 'granted' | 'done' = 'waiting';
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (state !== 'granted') return;
      state = 'done';
      if (timer !== null) { clearTimeout(timer); timer = null; }
      this.inFlight = Math.max(0, this.inFlight - 1);
      this.pump();
    };

    const entry: PendingEntry = {
      cancelled: false,
      grant: () => {
        if (state !== 'waiting') return; // 排队期间已被取消
        this.inFlight++;
        this.grantedCount++;
        if (this.inFlight > this.peak) this.peak = this.inFlight;
        state = 'granted';
        timer = setTimeout(finish, this.slotTimeoutMs);
        resolveReady();
      },
    };

    if (this.inFlight < this.maxInFlight) {
      entry.grant();
    } else {
      this.queue.push(entry);
    }

    return {
      ready,
      release: () => {
        if (state === 'granted') { finish(); return; }
        if (state === 'waiting') {
          state = 'done';
          entry.cancelled = true;
          const i = this.queue.indexOf(entry);
          if (i >= 0) this.queue.splice(i, 1);
        }
      },
    };
  }

  /** 放行队首直到打满或队列空。被取消的条目直接跳过（不占额度）。 */
  private pump(): void {
    while (this.inFlight < this.maxInFlight && this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (next.cancelled) continue;
      next.grant();
    }
  }
}

/** 生产用单例：全应用共用一条封面在飞预算。 */
export const coverLoadGate = new CoverLoadGate();
