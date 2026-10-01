import { describe, it, expect } from 'vitest';
import type { Song } from '../../types/index.js';
import { alignShuffleOrder } from '../shuffleOrder.js';

const song = (id: string): Song => ({
  id,
  name: `歌${id}`,
  artist: '歌手',
  album: '',
  url: '',
  cover: '',
  lrc: '',
  duration: 180,
  sourceType: 'netease',
});

const q = (...ids: string[]) => ids.map(song);

/**
 * #543：对齐策略的作用域（authoritative / window）做成 core 的**显式参数**。
 *
 * 此前这是移动端注释里的知识，两端各写一份对齐函数且规则分叉；
 * 分叉的代价已经被实测记录过一次（#520：随机序 12 首 → 5 首的永久截断）。
 * 这里把两种作用域的语义钉死，让下一次接入不必再去读注释放大镜。
 */
describe('alignShuffleOrder（#543 作用域显式）', () => {
  const state = { order: ['a', 'b', 'c', 'd', 'e'], cursor: 2 }; // 当前 = 'c'

  it('window：只补不丢——窗口外的 id 必须原样保留（⚠️ 这条就是「12→5」的回归）', () => {
    // 队列只是原生预取窗口（子集）：序列里窗口外的歌**不能**被裁掉
    const window = q('c', 'd');
    const aligned = alignShuffleOrder(state, window, 0, 'window');
    expect(aligned.order).toEqual(['a', 'b', 'c', 'd', 'e']); // 一个都没丢
    expect(aligned.cursor).toBe(2); // 'c'
  });

  it('window：队列里出现的新 id 追加到末尾', () => {
    const window = q('c', 'new1');
    const aligned = alignShuffleOrder(state, window, 0, 'window');
    expect(aligned.order).toEqual(['a', 'b', 'c', 'd', 'e', 'new1']);
  });

  it('authoritative：裁剪幽灵 id + 补新成员（完整成员集才允许裁）', () => {
    // 队列是完整歌单：'a' 已不在队列里（幽灵），'f' 是新成员
    const full = q('b', 'c', 'd', 'e', 'f');
    const aligned = alignShuffleOrder(state, full, 1, 'authoritative');
    expect(aligned.order).toEqual(['b', 'c', 'd', 'e', 'f']); // 'a' 被裁掉
    expect(aligned.cursor).toBe(1); // 'c'
  });

  it('两种作用域都不重洗：相对顺序保持不变', () => {
    const subset = q('c', 'd');
    const win = alignShuffleOrder(state, subset, 0, 'window');
    // 保留下来的相对顺序仍是原序
    expect(win.order.slice(0, 5)).toEqual(['a', 'b', 'c', 'd', 'e']);

    const auth = alignShuffleOrder(state, q('b', 'c', 'd', 'e'), 1, 'authoritative');
    expect(auth.order).toEqual(['b', 'c', 'd', 'e']);
  });

  it('缺省作用域 = authoritative（保守默认：宁可裁幽灵，也不让序列膨胀）', () => {
    const full = q('b', 'c', 'd', 'e');
    expect(alignShuffleOrder(state, full, 1).order).toEqual(['b', 'c', 'd', 'e']);
  });

  it('window：当前曲不在原序列里 → 补进末尾并成为当前曲', () => {
    const aligned = alignShuffleOrder(state, q('x'), 0, 'window');
    expect(aligned.order).toEqual(['a', 'b', 'c', 'd', 'e', 'x']);
    expect(aligned.cursor).toBe(5); // 'x'
  });

  it('authoritative：游标锚定 queue[currentIndex]，不跟随旧游标指向的歌', () => {
    // 旧游标指向 'c'，但 'c' 已从歌单移除；当前曲由 currentIndex（=2 → 'd'）决定
    const aligned = alignShuffleOrder(state, q('a', 'b', 'd'), 2, 'authoritative');
    expect(aligned.order).toEqual(['a', 'b', 'd']);
    expect(aligned.cursor).toBe(2); // 'd'，不是旧游标那首 'c'
  });

  it('下标越界 → 游标 -1（不抛）', () => {
    expect(alignShuffleOrder(state, q('a', 'b'), 99, 'window').cursor).toBe(-1);
    expect(alignShuffleOrder(state, q('a', 'b'), -1, 'authoritative').cursor).toBe(-1);
  });

  it('空序列 + window：按队列补出顺序', () => {
    const aligned = alignShuffleOrder({ order: [], cursor: -1 }, q('a', 'b'), 0, 'window');
    expect(aligned.order).toEqual(['a', 'b']);
    expect(aligned.cursor).toBe(0);
  });
});
