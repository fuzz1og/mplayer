import { Dimensions } from 'react-native';
import { spacing } from '../theme/tokens';

/**
 * 网格卡片宽度 —— 单一事实源。
 * 公式：页面沟槽(gutter×2)与列距(gap×列数-1)扣除后按列数均分。
 * 三处调用点（DiscoverTabs 新碟/歌单 2 列、歌手 3 列、recommend 猜你喜欢 2 列）
 * 统一从这里取数，禁止在调用方重写公式。
 *
 * 注意：调用点需放在组件外模块顶层时，本工具在模块顶层执行
 * Dimensions.get('window')；若未来需响应折叠屏/旋转，再改为按需取值。
 */
const { width: SCREEN_WIDTH } = Dimensions.get('window');

/** 页面沟槽：与节标题/分段控件/分类行同轴（默认 16） */
const PAGE_GUTTER = spacing[4];

export interface GridCardWidthOptions {
  /** 列数（2/3） */
  cols: number;
  /** 列间距 token 值（默认 spacing[3] = 12） */
  gap?: number;
  /** 页面左右沟槽（默认 spacing[4] = 16） */
  gutter?: number;
}

export function gridCardWidth({ cols, gap = spacing[3], gutter = PAGE_GUTTER }: GridCardWidthOptions): number {
  return (SCREEN_WIDTH - gutter * 2 - gap * (cols - 1)) / cols;
}
