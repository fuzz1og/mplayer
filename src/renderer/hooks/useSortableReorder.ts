import { useCallback } from 'react';
import { PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { useLatest } from '@/renderer/hooks/useLatest';
import { reorderIndices } from '@/renderer/utils/reorder';

interface UseSortableReorderOptions<T extends { id: string }> {
  /** 当前顺序的数据源（拖拽结束用它把 id 折算成下标） */
  items: readonly T[];
  /** 语义回调：页面只管「第 from 项挪到了第 to 项」，不碰 dnd 事件与索引查找 */
  onReorder: (fromIndex: number, toIndex: number) => void;
}

/**
 * 拖拽排序接缝：dnd-kit 的 DragEndEvent → (fromIndex, toIndex)，并把 sensors 一并给出。
 * 让「排序成为列表能力」而不是每个页面各写一份 indexOf/splice。
 */
export function useSortableReorder<T extends { id: string }>({ items, onReorder }: UseSortableReorderOptions<T>) {
  const latest = useLatest({ items, onReorder });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const hit = reorderIndices(latest.current.items, active.id, over.id);
    if (!hit) return;
    latest.current.onReorder(hit.from, hit.to);
  }, [latest]);

  return { sensors, handleDragEnd };
}
