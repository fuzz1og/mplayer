# 移动端不引入大标题导航（保持悬浮 chrome 现状）

对比原型 `prototypes/large-title-nav/`（V1 现状无标题 / V2 页面级大标题随滚动 / V3 大标题固定导航区）真机观感验证后决定：**不引入大标题**。现状「悬浮毛玻璃搜索栏 + 内容从下穿过」已满足导航需求，大标题带来的页面层级收益不抵新增 34pt token、四 tab 首页改造与滚动回归的成本。原「大标题」改动从 issue #186 移除；原型为 throwaway 已清理（验证结论即本 ADR）。

**Status**: accepted（先前 proposed 方案经原型验证被否决）

**Considered Options**: V2 页面级大标题（被否：收益不抵成本）；V3 固定导航区大标题（被否：非 iOS 惯例）。
