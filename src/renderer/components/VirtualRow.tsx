import React, { useMemo } from 'react';

/**
 * 此前两处列表（`SongList` 与 `GroupedSongList`）各自在 map 里现场拼这个 style 对象——每行每帧一个
 * 新对象，而行组件（`SongRow`/`GroupHeaderRow`）都是 `React.memo`，等于给它们塞了一个永远不相等的 
 * prop，memo 形同虚设。
 */
const VirtualRow = React.memo(function VirtualRow({
  start,
  size,
  scrollMargin,
  children,
}: {
  /** 行在内容坐标系里的起点 */
  start: number;
  /** 行高 */
  size: number;
  /** 列表在滚动容器内的偏移 */
  scrollMargin: number;
  children: React.ReactNode;
}) {
  const style = useMemo<React.CSSProperties>(
    () => ({
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: `${size}px`,
      transform: `translateY(${start - scrollMargin}px)`,
    }),
    [size, start, scrollMargin],
  );
  return <div style={style}>{children}</div>;
});

export default VirtualRow;
