import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, closestCenter, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import VirtualRow from '@/renderer/components/VirtualRow';
import { SONG_ROW_HEIGHT, VIRTUALIZE_THRESHOLD, useVirtualRows } from '@/renderer/hooks/useVirtualRows';
import { useSortableReorder } from '@/renderer/hooks/useSortableReorder';

interface VirtualSortableListProps<T extends { id: string }> {
  /** 全量数据：窗口化只决定「挂了哪些行」，排序依据始终是这一份 */
  items: readonly T[];
  /**
   * 渲染一行。实现内部**必须**用 `useSortable(item.id)` 注册（如 `SortableSongRow`）；
   * `index` 是**全量下标**（行号显示与 reorder 语义都用它）。
   */
  renderRow: (item: T, index: number) => React.ReactNode;
  /**
   * 拖拽期间 overlay 里那一行的渲染。**必须是非 sortable 的实现**——同一 id 二次注册会冲突，
   * 通常是同布局的行但不接 `useSortable`。
   */
  renderDragPreview: (item: T, index: number) => React.ReactNode;
  /** 松手后提交，参数都是**全量下标** */
  onReorder: (fromIndex: number, toIndex: number) => void;
  estimateSize?: (index: number) => number;
  overscan?: number;
  threshold?: number;
}

const estimateSongRow = () => SONG_ROW_HEIGHT;

/**
 * 「窗口化 + 可排序」列表（#428 / ADR `2026-09-29-queue-virtualized-sortable-list.md`）。
 *
 * 它替调用方扛住三条容易踩坏、且踩坏了不报错只静默失效的约束：
 * 1. `SortableContext items` 必须是**全量有序 id** 且 memo 化 —— dnd-kit 的排序下标来自这个数组，
 *    不是 DOM 顺序，所以窗口化卸载的行照样参与排序；
 * 2. `setNodeRef` 由行自身持有（`VirtualRow` 只是定位壳）—— dnd-kit 测量时剥离的是**被测元素
 *    自身**的 transform，把 ref 挪到被 translate 的壳上会让所有行的 rect 塌到同一处；
 * 3. 被拖的行会随窗口推进而被卸载（拖到视口外时），所以拖拽视觉走常驻的 `DragOverlay`
 *    （官方对虚拟化列表的措辞是 "you will absolutely want to use a drag overlay"）。
 *    overlay 用 portal 挂到 body，以免被滚动容器的 overflow 裁剪；主题 token 在 `:root`，不受影响。
 */
function VirtualSortableList<T extends { id: string }>({
  items,
  renderRow,
  renderDragPreview,
  onReorder,
  estimateSize = estimateSongRow,
  overscan = 8,
  threshold = VIRTUALIZE_THRESHOLD,
}: VirtualSortableListProps<T>) {
  const ids = useMemo(() => items.map((item) => item.id), [items]);
  const virtual = useVirtualRows({
    count: items.length,
    enabled: items.length >= threshold,
    estimateSize,
    overscan,
  });
  const { sensors, handleDragEnd } = useSortableReorder({ items, onReorder });
  // 存 id 而不是下标：拖拽期间队列若被改动（删歌 / 换源）下标会漂
  const [activeId, setActiveId] = useState<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragFinish = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    handleDragEnd(event);
  }, [handleDragEnd]);

  const handleDragCancel = useCallback(() => setActiveId(null), []);

  // overlay 渲染的是同一行，行号与落点语义都用全量下标
  const activeIndex = activeId === null ? -1 : items.findIndex((item) => item.id === activeId);
  const activeItem = activeIndex >= 0 ? items[activeIndex] : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragFinish}
      onDragCancel={handleDragCancel}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div
          ref={virtual.rowsRef}
          style={virtual.mode === 'virtual' ? { position: 'relative', height: `${virtual.totalSize}px` } : undefined}
        >
          {virtual.mode === 'pending'
            ? null
            : virtual.mode === 'virtual'
              ? virtual.items.map((row) => {
                  const item = items[row.index];
                  if (!item) return null;
                  return (
                    <VirtualRow key={item.id} start={row.start} size={row.size} scrollMargin={virtual.scrollMargin}>
                      {renderRow(item, row.index)}
                    </VirtualRow>
                  );
                })
              : items.map((item, index) => (
                  <React.Fragment key={item.id}>{renderRow(item, index)}</React.Fragment>
                ))}
        </div>
      </SortableContext>

      {/* 常驻挂载（官方：条件渲染 DragOverlay 会让 drop 动画失效），只有拖拽中才有 children */}
      {createPortal(
        <DragOverlay>
          <div style={{ pointerEvents: 'none' }}>
            {activeItem ? renderDragPreview(activeItem, activeIndex) : null}
          </div>
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

export default VirtualSortableList;
