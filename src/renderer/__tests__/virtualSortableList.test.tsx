import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { useSortable } from '@dnd-kit/sortable';
import VirtualSortableList from '@/renderer/components/VirtualSortableList';

interface Item {
  id: string;
  name: string;
}

const song = (i: number): Item => ({ id: `netease:${i}`, name: `歌曲 ${i}` });

/** 可排序行：把 dnd-kit 依据 items 数组算出的下标暴露出来，用于断言「传进去的是全量有序 id」 */
function SortableRow({ item }: { item: Item; index: number }) {
  const { setNodeRef, index } = useSortable({ id: item.id });
  return (
    <div ref={setNodeRef} data-testid={`row-${item.id}`} data-sortable-index={index}>
      {item.name}
    </div>
  );
}

function PreviewRow({ item }: { item: Item; index: number }) {
  return <div data-testid={`preview-${item.id}`}>{item.name}</div>;
}

/** jsdom 没有布局：给滚动容器造一个 900x600 的视口，@tanstack/react-virtual 才能算出窗口 */
function mountScrollContainer(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'clientHeight', { value: 600, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: 900, configurable: true });
  // @tanstack/react-virtual 量的是 offsetWidth/offsetHeight，jsdom 里恒为 0
  Object.defineProperty(el, 'offsetHeight', { value: 600, configurable: true });
  Object.defineProperty(el, 'offsetWidth', { value: 900, configurable: true });
  el.getBoundingClientRect = () => ({
    width: 900, height: 600, top: 0, left: 0, right: 900, bottom: 600, x: 0, y: 0,
    toJSON: () => ({}),
  }) as DOMRect;
  document.body.appendChild(el);
  return el;
}

function renderList(items: Item[], container?: HTMLElement) {
  return render(
    <VirtualSortableList
      items={items}
      renderRow={(item, index) => <SortableRow item={item} index={index} />}
      renderDragPreview={(item, index) => <PreviewRow item={item} index={index} />}
      onReorder={() => {}}
    />,
    container ? { container } : undefined,
  );
}

const mountedRows = () => document.querySelectorAll('[data-testid^="row-"]');

afterEach(() => {
  cleanup();
  document.querySelectorAll('body > div').forEach((node) => node.remove());
});

describe('VirtualSortableList：窗口化（#428）', () => {
  it('长列表只挂窗口内的行，容器高度仍是全量总高', async () => {
    const items = Array.from({ length: 200 }, (_, i) => song(i));
    const scrollEl = mountScrollContainer();
    const { container } = renderList(items, scrollEl);

    await waitFor(() => expect(mountedRows().length).toBeGreaterThan(0));
    expect(mountedRows().length).toBeGreaterThan(5);
    expect(mountedRows().length).toBeLessThan(40);
    expect(document.querySelector('[data-testid="row-netease:0"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="row-netease:199"]')).toBeNull();
    // 200 行 × 64px：滚动条长度反映整份队列（分页/懒加载做不到这一点）
    expect((container.firstElementChild as HTMLElement).style.height).toBe('12800px');
  });

  it('传给 dnd-kit 的是全量有序 id：滚到中段后行拿到的仍是全量下标', async () => {
    const items = Array.from({ length: 200 }, (_, i) => song(i));
    const scrollEl = mountScrollContainer();
    renderList(items, scrollEl);
    await waitFor(() => expect(document.querySelector('[data-testid="row-netease:0"]')).toBeTruthy());

    scrollEl.scrollTop = 64 * 100;
    fireEvent.scroll(scrollEl);

    await waitFor(() => expect(document.querySelector('[data-testid="row-netease:100"]')).toBeTruthy());
    // 若把「窗口内的 id」交给 SortableContext，这里会退化成窗口内偏移（0..N），排序就会错位
    expect(document.querySelector('[data-testid="row-netease:100"]')!.getAttribute('data-sortable-index')).toBe('100');
    expect(document.querySelector('[data-testid="row-netease:0"]')).toBeNull();
  });

  it('短列表整表渲染，不做窗口化探测', () => {
    const items = Array.from({ length: 3 }, (_, i) => song(i));
    renderList(items);
    expect(mountedRows().length).toBe(3);
  });
});
