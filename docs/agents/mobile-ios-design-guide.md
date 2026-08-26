# 移动端 iOS 设计规范速查（MPlayer Mobile）

> 当移动端 UI 改动涉及 **iOS 观感 / 毛玻璃材质 / 分组列表 / 全屏媒体 / 设置页** 时先读本文档。
> 数值已按 iOS 系统实测 + 真机验证校准，可直接照抄；拿不准再查 Apple HIG 或系统实测。

## 背景层级（tokens.ts 已对齐 iOS systemColors）

| 语义 | 浅色 | 深色 | iOS 对应 |
|---|---|---|---|
| 页面底 `bgBase` | `#F2F2F7` | `#000000` | systemGroupedBackground |
| 卡片 `bgSurface` | `#FFFFFF` | `#1C1C1E` | secondarySystemBackground |
| 浮层 `bgElevated` | `#FFFFFF` | `#2C2C2E` | tertiarySystemBackground |

页面底灰一档让「白卡片 vs 灰底」层级立起来；深色用纯黑让卡片浮起。

## 文字层级（设置页实测）

- 节标题：**13pt 灰 + 大写**（uppercase + semibold），距卡片 8pt
- cell 主标题：**17pt** regular（primary label）
- cell 副标题：**15pt**；三级信息 **13pt**
- 组下脚注：**13pt**，距卡片 8pt
- 操作行（清理缓存类）：**17pt 居中** accent
- 全屏播放器前景：随背景明暗切换（暗背景→白系 / 浅背景→深系，见 makeFg 模式）

## 分组卡片（inset grouped）

- 组圆角 **10pt**（`radius.md`）、水平缩进 **16pt**、cell ≈ **44pt**
- cell 间 hairline 分隔（`rowSep`）；节间距 ≈ **32pt**
- 同一节连续 cells **合成一个卡片**，不拆多个圆角卡
- 表单：**「输入 cell + 下方居中按钮」紧贴成块**（非行内按钮，iOS 表单惯例）

## 控件

- **分段控件**：极浅灰底 `rgba(120,120,128,.12)`(浅) / `.24`(深) + 选中段白胶囊 + 淡阴影（iOS 13+ 默认）
- **Switch**：Android Material 默认 48dp 会撑高 cell → 外层容器**固定 31 高度**收敛占位 + `scale 0.65`
  （`transform: scale` 只改视觉**不改布局占位**，必须配合固定高度容器）

## 全屏媒体（PlayerOverlay）

- 背景层独立于 Animated 内容层，但与 contentWrap **共享下滑/缩放/淡出动画**（下拉露出底层页面）
- 固定双端渐变（深：蓝灰→近黑 / 浅：灰→浅灰），**不随封面**（防白封面歌进入时跳变，真机结论）
- 文字/图标走前景色 `makeFg`（深浅双套），accent 两端通用

## Android 毛玻璃（expo-blur）踩坑

- **tint 必须带明暗后缀**：`systemMaterialDark/Light`——无后缀映射为 DEFAULT（26% 白），深色下几乎透明（源码 TintStyle.kt 实锤）
- 实际强度 = `intensity / blurReductionFactor`；Android 端 `blurReductionFactor=1` 才对齐 iOS 感知（默认 4 缩水到 1/4）
- BlurView 必须在 blurTarget（BlurTargetView）之后渲染；BlurView 不能嵌 Animated/native-driver 容器（模糊快照不同步）
- 同一 ref 可被多个 BlurView 共享（效率更高）

## 纪律

- 色值/字号一律走 `tokens.ts` / `textVariants`（语义变体）；新增观感档位**先加 token 或语义变体**，不散落魔数（review 硬违规教训）
- 界面改动先对照本文档数值，再对照 iOS 实测；iOS 观感 ≠ 自创参数，每个值可辩护
