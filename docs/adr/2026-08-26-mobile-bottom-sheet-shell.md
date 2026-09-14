# 移动端 BottomSheet 壳（把手/圆角/拖拽关闭统一）

五处底部弹层（TopBar 来源选择 / PlayerBar 队列 / SongRow 操作面板 / SourceSwapModal / AddToPlaylistModal）此前各自为政：2 处有把手、3 处没有，圆角 `xl`×3 / `lg`×2 混用。决定：抽 `BottomSheet` 展示壳统一解剖（默认把手、`radius.sheet=12` 对齐 iOS sheet 圆角、安全区 padding 壳内处理），并内置可中断拖拽关闭——复用 PlayerOverlay 已验证的 motion 基建（`springs.sheet`、`projectMomentum`、`rubberband`、速度继承），实现 iOS sheet 的「下滑即关」行为。

**Status**: accepted

**Considered Options**: 壳不做拖拽、只点遮罩关闭（被否：iOS HIG 中 sheet 默认下滑关闭，且 motion 基建已备、增量小）；沿用各弹层自绘（被否：解剖不一致是本次 issue 要清的债）。

**Consequences**: `BottomSheet` 成为弹层唯一入口；拖拽关闭与「点击遮罩」「取消按钮」三路关闭并存，需保证手势与内部 FlatList/ScrollView 不打架（onMoveShouldSetPanResponder 判定沿用 PlayerOverlay 阈值）；PlayerOverlay 暂不并入壳（全屏场景特殊，保持独立）。
