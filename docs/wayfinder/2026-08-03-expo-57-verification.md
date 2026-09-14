# Expo SDK 57 升级 + 播放重构 — 真机验证清单（wayfinder #83）

> Wayfinder map #79 的 research 资产。2026-08-03，subagent 对 node_modules 内 API 兼容性逐一核实。

## 版本基线（packages/mobile/package.json）

- expo **~57.0.9**，RN **0.86.2**（旧 0.76.9），React 19.2.3，`newArchEnabled: true`
- expo-audio 57.0.3（替代 expo-av）、expo-notifications 57.0.8（旧 0.29.14）、expo-router 57.0.9（旧 4.0.0）、safe-area-context 5.7.0、AsyncStorage 2.2.0（旧 1.23.1）
- ⚠️ zustand 不在 mobile package.json——依赖 monorepo 根提升（脆弱）
- 迁移提交：`48843f9`（expo-av→expo-audio 等）；`176c34d` 补安全区/通知守卫/播放竞态

## API 兼容性核实（node_modules 内）

- expo-audio：`createAudioPlayer`、`setAudioModeAsync`、`playbackStatusUpdate`、`AudioStatus`、`setActiveForLockScreen`、`remove()` 全部存在且签名一致
- expo-notifications：`setNotificationCategoryAsync`、`opensAppToForeground`、`shouldShowBanner/shouldShowList` 均匹配
- RN 0.86 Modal `statusBarTranslucent`/`navigationBarTranslucent` 未废弃；**edge-to-edge 自动开启**（targetSdk 36，Android 15 强制）→ OnePlus 上 edge-to-edge 已生效
- ⚠️ expo-audio Android 上 `shouldPlayInBackground` 未启用锁屏控制时**后台播放约 3 分钟后被系统停止**；Expo Go 下跳过 `setActiveForLockScreen` → Expo Go 后台播放受限属预期

## 🚨 Top 5 最高风险

1. **expo-audio 异步释放竞态** — `remove()` 原生异步 + `pause()` 先行的 stopAllPlayers（audioPlayer.ts:61-70）；mock 无法覆盖真实时序，真机快速切歌验证双声/卡顿/崩溃
2. **通知权限未请求 + Expo Go 全禁用** — 全项目无 `requestPermissionsAsync`，Android 13+ 媒体通知与锁屏控制**默认不出现**；必须在 dev build（expo run:android）验证
3. **Android 15 edge-to-edge 布局** — targetSdk 36 强制，11 个页面 + 7 个 Modal 的 insets 关系需目检（176c34d 只覆盖部分）
4. **URL 持久化缓存污染** — `songUrl:` 缓存从不清理、`song.id` 为空写 `'songUrl:undefined'`、升级残留旧 URL；缓存命中路径完全无测试
5. **真机错误时序下重试/跳歌级联** — `status.error` 触发时机平台相关，弱网下 isLoaded=false 与 didJustFinish 交错可能重复重试/跳歌

## 验证清单（38 项，按功能域）

### 播放（services/audioPlayer.ts）
| # | 功能点 | 自动测试 | 真机必测 | 风险 |
|---|--------|---------|---------|------|
| 1 | 切歌时旧播放器释放（livePlayers/stopAllPlayers） | 是(mock) | **是** | 原生 remove 异步，快速切歌双声/爆音 |
| 2 | 加载失败→fresh URL 重试→跳下一首 3 级级联（:138-161） | 是(mock) | **是** | status.error 时序真机不同，弱网误跳歌 |
| 3 | didJustFinish 自动下一首（播放模式分支） | 是(仅列表循环) | **是** | playerStore 模式分支无测试 |
| 4 | togglePlay 暂停/恢复 + null-player fresh 重试（:225-250） | 否 | 是 | 队列耗尽后点播放 |
| 5 | seekTo 进度条拖动（:252-256） | 否 | 是 | 快速拖动 Promise 串行回跳 |
| 6 | 进度/时长回写（250ms） | 是(部分) | 是 | 缓冲期 duration=0 跳变；isBuffering 被忽略 |
| 7 | `!isLoaded && !error` 静默 return（:141） | 否 | 是 | 播放中但无声且无重试 |
| 8 | 音频焦点打断（doNotMix） | 否 | **是** | 来电/其他 App 播放 |
| 9 | 后台播放（enableBackgroundPlayback 插件） | 否 | **是** | Expo Go 3 分钟限制；dev build 验证 |
| 10 | URL 持久化缓存命中/写回/失效（:21-38,:195） | 否 | **是** | 缓存永不清理；`songUrl:undefined`；旧缓存残留 |
| 11 | 播放历史写入（:198） | 否 | 是 | 重复播放去重 |
| 12 | 播放错误日志 + 全局 Toast（_layout.tsx:13-38） | 否 | 是 | reportError 链路 |

### 通知/锁屏（notificationService.ts）
| # | 功能点 | 自动测试 | 真机必测 | 风险 |
|---|--------|---------|---------|------|
| 13 | 通知展示/更新（:73-94） | 否 | **是** | **Expo Go 完全禁用**（:10-29）；无 requestPermissionsAsync |
| 14 | 通知分类按钮（prev/play-pause/next，:44-60） | 否 | **是** | 需 dev build；category 注册时机 |
| 15 | 通知点击→打开播放器（_layout.tsx:50-68） | 否 | 是 | actionIdentifier 与 data.songId 链路 |
| 16 | 锁屏控制 setActiveForLockScreen（audioPlayer.ts:184-191） | 否 | **是** | Expo Go 跳过；dev build 验证 |

### 安全区 / edge-to-edge（Android 15 强制）
| # | 功能点 | 自动测试 | 真机必测 | 风险 |
|---|--------|---------|---------|------|
| 17 | 列表页顶部 SafeAreaView + StatusBar light（8 个页面） | 否 | **是** | 状态栏重叠/颜色对比 |
| 18 | 自绘 TabBar 底部安全区 + 搜索页收起动画 | 否 | 是 | insets + Animated 动画 |
| 19 | 无 tab 页面 BottomSafePlayerBar | 否 | 是 | 手势条覆盖播放条 |
| 20 | 7 处 Modal 底部手势条/遮罩 | 否 | **是** | edge-to-edge 下遮罩/insets 目检 |
| 21 | PlayerOverlay 全屏层（edges=['top']+insets.bottom+24） | 否 | 是 | 下滑关闭动画 |

### 搜索
| # | 功能点 | 自动测试 | 真机必测 | 风险 |
|---|--------|---------|---------|------|
| 22 | 关键词搜索/分页/加载更多 | 是(searchStore) | 是 | 弱网分页/去重 |
| 23 | 音源切换 + probeAudio 探活 | 否 | 是 | cleartext 已开；真机网络 |
| 24 | 搜索框键盘行为（adjustResize） | 否 | 是 | RN0.86 键盘回归 |

### 收藏
| # | 功能点 | 自动测试 | 真机必测 | 风险 |
|---|--------|---------|---------|------|
| 25 | 收藏/取消 + persist（favorites-storage） | 否 | 是 | AsyncStorage 1.x→2.x 数据兼容；hydrate 闪烁 |
| 26 | 收藏列表播放（URL 过期场景） | 否 | **是** | 核心链路：旧 URL→fresh→跳歌 |

### 歌单
| # | 功能点 | 自动测试 | 真机必测 | 风险 |
|---|--------|---------|---------|------|
| 27 | 歌单 CRUD + persist | 否 | 是 | persist；AddToPlaylistModal 反馈 |
| 28 | 播放队列弹窗/队列内切歌（PlayerBar:85-129） | 否 | 是 | setQueue+playSong 组合 |
| 29 | 歌单详情页操作 Modal | 否 | 是 | Modal+手势条 |

### 详情页
| # | 功能点 | 自动测试 | 真机必测 | 风险 |
|---|--------|---------|---------|------|
| 30 | 路由参数传递（useLocalSearchParams） | 否 | 是 | expo-router 4→57 大跳变；数组/编码 |
| 31 | 详情列表滚动 + 底部播放条共存 | 否 | 是 | FlatList 新架构回归 |
| 32 | 返回手势/系统返回键（预测性返回） | 否 | 是 | screens 4.4→4.26；Modal onRequestClose |

### 设置
| # | 功能点 | 自动测试 | 真机必测 | 风险 |
|---|--------|---------|---------|------|
| 33 | apiBaseUrl/proxy 保存并同步 core | 否 | 是 | persist 恢复时序 |
| 34 | 播放模式设置 | 否 | 是 | 影响 next/prev 分支 |
| 35 | 版本号/检查更新（Constants.expoConfig?.version） | 否 | 是 | constants 57 字段兼容 |

### 架构/通用
| # | 功能点 | 自动测试 | 真机必测 | 风险 |
|---|--------|---------|---------|------|
| 36 | New Architecture 原生兼容 | 否 | **是** | RN0.86 强制新架构；Expo Go 旧包体 |
| 37 | expo-file-system/legacy 导入（fileBackend.ts:1） | 否 | 否 | 未来版本将移除 legacy 层 |
| 38 | zustand 根依赖提升 | 否 | 否 | 工作但脆弱；移除根依赖即炸 |
