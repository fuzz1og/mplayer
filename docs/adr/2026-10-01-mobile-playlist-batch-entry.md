# ADR: 移动端歌单页批量模式的入口（修订 #490 的「显式入口已否决」）

- 状态：已接受
- 日期：2026-10-01
- 关联：**#490**（批量模式本体，票面把「长按进入」定为唯一入口）· **#514**（实现该功能的 PR；真机验收发现入口在真机不可达）· `2026-09-29-queue-virtualized-sortable-list.md`（批量栏必须与列表同父容器的布局约束）· 桌面先例：`src/renderer/components/SongList.tsx` 的常驻「批量管理」键（commit `a65daa3e`，Closes #217）

## 背景

#490 把「长按任意歌曲行进入选择模式」定为唯一入口，并在备选方案里**否决**了对齐桌面的显式入口，理由写得很明确：

> 显式「批量管理」入口（对齐桌面）：不碰长按。但会保留"长按静默移除"这个危险手势，且移动端用户对"长按进选择"有强习惯。已否决。

2026-10-01 的真机验收（PR #514 验收评论）把这条理由的两个前提都推翻了：

1. **「长按静默移除」从来没有生效过**。它在 master 上写成外层 `<Pressable onLongPress>` 包住 `<SongRow>`，而 SongRow 本身是 `ScalePress`（内部即 Pressable）——RN 的 responder 由**最内层**先认领，外层的 `onLongPress` 永不触发，长按松手时走的是内层 `onPress`（= 播放）。真机取证：master 与本分支上长按同一行都只是播放，不弹「移除歌曲」。
2. **新的长按入口写在同一个外层 Pressable 里**，于是同样不生效 → 批量模式在真机上**零入口**（票面第一条验收标准无法通过；本 PR 的三条单测是纯逻辑/挂载测试，覆盖不到 responder 归属）。

平台口径也不支持「长按当唯一入口」：Apple HIG 要求自定义手势必须 Discoverable，且 **Not the only way to perform an important action**，并用「Use shortcut gestures to **supplement** standard gestures, not replace them」收口；Material 的 selection 模式把长按列为触摸端标准进入方式，同时给出「**or use a shortcut**」。同类 App 两派并存：Apple 自家（音乐/邮件/文件）用显式「选择/编辑」，Google 自家 Android（Gmail/Photos）用长按，Files 列表视图两者都有；网易云/QQ音乐用显式键。

## 决策

1. **长按保留，但必须挂在行自身的可按压组件上**：`SongRow` 暴露 `onLongPress` 并透传给它的 `ScalePress`；`PlaylistHero` 不再用外层 `<Pressable>` 包行。**「外层包装承接手势」在本组件树里永远是死代码**（responder 归属），不要再用。
2. **歌单详情页英雄区新增可见入口**：`CollapsingHero` 增加次级动作 `secondaryActionLabel` / `onSecondaryAction`（与既有 `actionLabel`/`onAction` 同形的「两者都给才渲染」），歌单页传「选择」，进入选择模式且**不预选任何行**（与桌面 `SongList` 的「批量管理」一致）。选择模式内不渲染该按钮——入口让位给顶部条的「完成」。
3. **视觉**：次级按钮与「播放全部」同处一行（`actionRow`：`gap: spacing[2]`、同 padding/圆角），走语义 token（`borderDefault` + `bgHover` + `textPrimary`），双主题成立；**不传新 prop 的页面（专辑/歌手/网络歌单）渲染结果与改动前一致**。
4. **不做**：悬浮导航栏「选择」文字键（压在封面上要做与返回箭头同款的两层同色；右侧插槽现按单个 40×40 图标设计，塞两个键会与 ⋮ 贴死——真机原型实测）；⋮ 面板再加一项（作为后续补充，不当作唯一入口）。

## 备选与否决

| 备选 | 否决理由 |
| --- | --- |
| 只修长按、不加可见入口（维持 #490 原样） | 违反 HIG「不能是完成重要操作的唯一方式」；无视觉提示 = 只能靠猜（隐藏手势的可发现性有实证研究支撑） |
| 悬浮导航栏加「选择」文字键 | 真机原型实测：与 ⋮ 贴死需额外间距；封面态要做两层同色；选择模式内还要隐藏——成本最高、收益与英雄区键相同 |
| 去掉长按，只留显式键（网易云/QQ音乐路线） | 与 Material 触摸端默认模式背道而驰，且丢掉熟手的零成本路径；两者并存互不冲突 |
| ⋮ 面板加「选择歌曲」项 | 可实施（成本最低），但多一层、可发现性中等；作为后续补充而非唯一入口 |

## 后果

- 歌单页的批量模式有两个入口：长按行（预选该行）+ 英雄区「选择」（不预选）。两者落到同一份 `PlaylistSelection` 状态机。
- `CollapsingHero` 多两个可选 prop；不传即保持既有渲染（共享该组件的四个消费页不受影响）。
- #490 票面的「备选方案」一节与 `docs/wayfinder/2026-08-03-wayfinder-gap-list.md:13`「mobile `playlist/[id].tsx` 仅长按移除单曲」的记述与事实不符，以本 ADR 为准（历史会话资产不回改）。
- 源码守卫：`packages/mobile/__tests__/playlistSelection.test.ts` 钉住「长按挂在行自身」与「英雄区显式入口」；外层 Pressable 的写法一旦回归即红。
