# test-all-sources

测试所有音乐源的集成状态，验证搜索、播放、歌词等核心功能。

## 使用方式

```bash
/workflow test-all-sources
```

## 工作流阶段

### 阶段 1: 环境准备

1. **检查 API 服务器**
   ```bash
   # 确保 API 服务器可达
   curl -s "$MUSIC_API_URL/" || echo "API 服务器不可用"
   ```

2. **准备测试数据**
   - 测试关键词: "周杰伦", "晴天", "稻香"
   - 测试歌曲 ID: 从搜索结果获取

### 阶段 2: 搜索功能测试

测试每个音源的搜索功能：

```bash
#!/bin/bash
API_URL=${MUSIC_API_URL:-"http://localhost:3000"}
SOURCES=("netease" "qq" "kugou" "migu" "kuwo" "qianqian" "soda")
KEYWORDS=("周杰伦" "晴天" "稻香")

echo "=== 搜索功能测试 ==="

for source in "${SOURCES[@]}"; do
  echo ""
  echo "测试音源: $source"
  echo "---"
  
  for keyword in "${KEYWORDS[@]}"; do
    echo "搜索: $keyword"
    result=$(curl -s "$API_URL/search?keywords=$keyword&type=$source&limit=3")
    
    if [ $? -eq 0 ]; then
      count=$(echo "$result" | jq '.songs | length' 2>/dev/null)
      if [ "$count" -gt 0 ]; then
        echo "  ✅ 找到 $count 首歌曲"
      else
        echo "  ❌ 未找到结果"
      fi
    else
      echo "  ❌ 请求失败"
    fi
  done
done
```

### 阶段 3: 播放功能测试

测试音频 URL 获取：

```bash
echo ""
echo "=== 播放功能测试 ==="

for source in "${SOURCES[@]}"; do
  echo ""
  echo "测试音源: $source"
  echo "---"
  
  # 先搜索获取歌曲 ID
  search_result=$(curl -s "$API_URL/search?keywords=晴天&type=$source&limit=1")
  song_id=$(echo "$search_result" | jq -r '.songs[0].id' 2>/dev/null)
  
  if [ "$song_id" != "null" ] && [ -n "$song_id" ]; then
    echo "歌曲 ID: $song_id"
    
    # 获取音频 URL
    url_result=$(curl -s "$API_URL/url?id=$song_id&type=$source")
    audio_url=$(echo "$url_result" | jq -r '.url' 2>/dev/null)
    
    if [ "$audio_url" != "null" ] && [ -n "$audio_url" ]; then
      echo "  ✅ 音频 URL 获取成功"
      echo "  URL: ${audio_url:0:50}..."
    else
      echo "  ❌ 音频 URL 获取失败"
    fi
  else
    echo "  ❌ 无法获取歌曲 ID"
  fi
done
```

### 阶段 4: 歌词功能测试

测试歌词获取：

```bash
echo ""
echo "=== 歌词功能测试 ==="

for source in "${SOURCES[@]}"; do
  echo ""
  echo "测试音源: $source"
  echo "---"
  
  # 先搜索获取歌曲 ID
  search_result=$(curl -s "$API_URL/search?keywords=晴天&type=$source&limit=1")
  song_id=$(echo "$search_result" | jq -r '.songs[0].id' 2>/dev/null)
  
  if [ "$song_id" != "null" ] && [ -n "$song_id" ]; then
    # 获取歌词
    lyric_result=$(curl -s "$API_URL/lyric?id=$song_id&type=$source")
    lyric=$(echo "$lyric_result" | jq -r '.lyric' 2>/dev/null)
    
    if [ "$lyric" != "null" ] && [ -n "$lyric" ]; then
      echo "  ✅ 歌词获取成功"
      echo "  歌词长度: ${#lyric} 字符"
    else
      echo "  ❌ 歌词获取失败"
    fi
  fi
done
```

### 阶段 5: 结果汇总

生成测试报告：

```bash
echo ""
echo "=== 测试汇总 ==="
echo ""
echo "测试时间: $(date)"
echo "API 地址: $API_URL"
echo ""
echo "各音源状态:"
for source in "${SOURCES[@]}"; do
  echo "  - $source: 检查上述结果"
done
echo ""
echo "建议:"
echo "  1. 修复标记为 ❌ 的功能"
echo "  2. 优化响应较慢的音源"
echo "  3. 更新文档中的音源状态"
```

## 预期结果

### 成功标准

- 所有音源搜索返回结果
- 至少 80% 的音源可以获取音频 URL
- 至少 70% 的音源可以获取歌词
- 响应时间均在 3 秒以内

### 常见失败原因

1. **API 服务器未运行**
   - 检查服务器状态
   - 验证端口配置

2. **音源 API 变更**
   - 检查 API 版本
   - 更新适配器代码

3. **网络问题**
   - 检查网络连接
   - 验证代理配置

4. **限流**
   - 降低请求频率
   - 添加重试机制

## 输出

测试完成后将生成：

1. **控制台输出**
   - 实时测试结果
   - 错误详细信息
   - 性能指标

2. **测试报告** (可选)
   - 汇总统计
   - 失败详情
   - 改进建议

## 自动化集成

可以将此工作流集成到 CI/CD：

```yaml
# .github/workflows/test-sources.yml
name: Test Music Sources

on:
  schedule:
    - cron: '0 0 * * *'  # 每天运行
  workflow_dispatch:  # 手动触发

jobs:
  test-sources:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Install dependencies
        run: npm ci
      - name: Test all sources
        env:
          MUSIC_API_URL: ${{ secrets.MUSIC_API_URL }}
        run: |
          # 运行测试脚本
          npm run test:sources
```

## 注意事项

1. 测试时注意 API 限流
2. 保护 API 密钥安全
3. 测试环境与生产环境分离
4. 定期更新测试用例
5. 记录测试结果用于趋势分析
