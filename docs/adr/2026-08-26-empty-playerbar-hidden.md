# 空播放栏：首次播放前隐藏（对齐 Apple Music 惯例）

迷你播放栏此前以 0.6 透明度常驻屏底显示「未在播放 / 选择一首歌曲开始播放」。按 iOS 主流惯例（Apple Music / Spotify 首次播放前无 mini player），决定：首次播放前完全隐藏（不占位），第一首歌开始播放时 spring 滑入；此后队列清空仍显示空态提示。各 tab 屏内容底部让位由固定值改为按「是否有播放」动态计算（`bottomChromeHeight` 联动播放状态订阅），避免内容底部留白跳变。

**Status**: accepted

**Considered Options**: 常驻现状（被否：空态视觉噪音、非主流）；空态压缩为低矮引导条（被否：保留占位但布局收益小、交互价值低）。

**Consequences**: 播放栏出现/消失时底部 padding 变化，所有依赖 `bottomChromeHeight` 的 tab 屏（recommend/discover/download/playlists 及 DiscoverTabs 各子 tab）需订阅播放状态；首次播放动画与底部 tab 栏收起/弹起（搜索页）可能叠加，需真机回归。
