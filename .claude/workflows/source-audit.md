# source-audit

音源集成审计工作流，用于检查和验证 MPlayer 支持的所有音乐源的集成状态。

## 使用方式

```bash
/workflow source-audit
```

## 审计范围

### 支持的音乐源

| 音源 | 代码 | 状态 |
|------|------|------|
| 网易云音乐 | `netease` | ✅ |
| QQ 音乐 | `qq` | ✅ |
| 酷狗音乐 | `kugou` | ✅ |
| 咪咕音乐 | `migu` | ✅ |
| 酷我音乐 | `kuwo` | ✅ |
| 千千音乐 | `qianqian` | ✅ |
| Soda | `soda` | ✅ |

## 审计阶段

### 阶段 1: 代码审查

1. **检查 API 集成文件**
   ```
   src/main/api/musicApi.ts
   ```

2. **验证音源适配器**
   - 检查每个音源的搜索实现
   - 验证音频 URL 获取逻辑
   - 检查歌词获取功能

3. **检查错误处理**
   - 网络错误处理
   - API 限流处理
   - 数据格式异常处理

### 阶段 2: 功能测试

1. **搜索功能测试**
   ```bash
   # 测试每个音源的搜索
   for source in netease qq kugou migu kuwo qianqian soda; do
     echo "测试 $source 搜索..."
     curl "$MUSIC_API_URL/search?keywords=周杰伦&type=$source&limit=5"
   done
   ```

2. **播放功能测试**
   ```bash
   # 测试音频 URL 获取
   for source in netease qq kugou migu kuwo qianqian soda; do
     echo "测试 $source 播放..."
     curl "$MUSIC_API_URL/url?id=SONG_ID&type=$source"
   done
   ```

3. **歌词功能测试**
   ```bash
   # 测试歌词获取
   for source in netease qq kugou migu kuwo qianqian soda; do
     echo "测试 $source 歌词..."
     curl "$MUSIC_API_URL/lyric?id=SONG_ID&type=$source"
   done
   ```

### 阶段 3: 集成检查

1. **检查音源切换**
   - 验证音源选择器 UI
   - 测试音源切换逻辑
   - 检查音源优先级

2. **检查数据一致性**
   - 歌曲信息格式统一
   - 歌词格式标准化
   - 封面图获取

3. **检查性能**
   - 搜索响应时间
   - 音频加载速度
   - 缓存策略

### 阶段 4: 报告生成

1. **生成审计报告**
   - 各音源状态汇总
   - 发现的问题列表
   - 改进建议

2. **创建问题跟踪**
   - 为发现的问题创建 GitHub Issue
   - 标记优先级
   - 分配责任人

## 审计指标

### 功能完整性

- [ ] 搜索功能正常
- [ ] 播放功能正常
- [ ] 歌词获取正常
- [ ] 封面图获取正常
- [ ] 音源切换正常

### 错误处理

- [ ] 网络错误处理
- [ ] API 限流处理
- [ ] 数据格式异常处理
- [ ] 用户友好的错误提示

### 性能表现

- [ ] 搜索响应 < 2秒
- [ ] 音频加载 < 3秒
- [ ] 缓存命中率 > 80%
- [ ] 内存使用合理

### 代码质量

- [ ] TypeScript 类型完整
- [ ] 错误边界处理
- [ ] 单元测试覆盖
- [ ] 文档完整

## 常见问题

### 音源不可用

1. 检查 API 服务器状态
2. 验证 API 密钥配置
3. 检查网络连接
4. 查看错误日志

### 搜索结果不准确

1. 检查搜索参数格式
2. 验证编码处理
3. 检查结果过滤逻辑
4. 对比其他音源结果

### 播放失败

1. 验证音频 URL 有效性
2. 检查音频格式支持
3. 测试网络带宽
4. 检查 DRM 限制

## 输出

审计完成后将生成：

1. **审计报告** (`audit-report.md`)
   - 各音源状态汇总
   - 问题详细描述
   - 改进建议

2. **问题跟踪** (GitHub Issues)
   - 自动创建的问题
   - 优先级标记
   - 相关代码引用

3. **性能报告**
   - 响应时间统计
   - 资源使用情况
   - 优化建议

## 定期审计建议

- **每周**: 快速功能检查
- **每月**: 完整审计
- **每季度**: 性能优化审计
- **重大更新后**: 全面回归测试
