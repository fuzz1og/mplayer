import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { moveItem, reorderIndices } from '@/renderer/utils/reorder';
import { useSortableReorder } from '@/renderer/hooks/useSortableReorder';

describe('moveItem（拖拽索引数学）', () => {
  it('把 from 位置的元素挪到 to 位置，其余相对顺序不变', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('越界或原地不动时返回等值副本，不抛错', () => {
    const list = ['a', 'b'];
    expect(moveItem(list, 0, 0)).toEqual(list);
    expect(moveItem(list, -1, 1)).toEqual(list);
    expect(moveItem(list, 0, 5)).toEqual(list);
    expect(moveItem(list, 0, 0)).not.toBe(list);
  });

  it('reorderIndices 把 dnd 的 active/over id 折算成下标，找不到返回 null', () => {
    const items = [{ id: 'x' }, { id: 'y' }, { id: 'z' }];
    expect(reorderIndices(items, 'z', 'x')).toEqual({ from: 2, to: 0 });
    expect(reorderIndices(items, 'y', 'y')).toBeNull();
    expect(reorderIndices(items, 'y', 'nope')).toBeNull();
  });
});

describe('useSortableReorder（拖拽 → 语义下标）', () => {
  it('拖拽结束以正确下标回调调用方', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() =>
      useSortableReorder({ items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], onReorder })
    );

    act(() => {
      result.current.handleDragEnd({
        active: { id: 'a' },
        over: { id: 'c' },
      } as unknown as Parameters<typeof result.current.handleDragEnd>[0]);
    });

    expect(onReorder).toHaveBeenCalledWith(0, 2);
  });

  it('拖回自身或拖到列表外不回调', () => {
    const onReorder = vi.fn();
    const { result } = renderHook(() =>
      useSortableReorder({ items: [{ id: 'a' }, { id: 'b' }], onReorder })
    );

    act(() => {
      result.current.handleDragEnd({ active: { id: 'a' }, over: { id: 'a' } } as never);
      result.current.handleDragEnd({ active: { id: 'a' }, over: null } as never);
    });

    expect(onReorder).not.toHaveBeenCalled();
  });

  it('回调始终用最新的列表顺序（items 变化后不读旧闭包）', () => {
    const onReorder = vi.fn();
    const { result, rerender } = renderHook(
      ({ ids }: { ids: string[] }) => useSortableReorder({ items: ids.map(id => ({ id })), onReorder }),
      { initialProps: { ids: ['a', 'b', 'c'] } }
    );

    rerender({ ids: ['c', 'b', 'a'] });
    act(() => {
      result.current.handleDragEnd({ active: { id: 'c' }, over: { id: 'a' } } as never);
    });

    expect(onReorder).toHaveBeenCalledWith(0, 2);
  });
});
