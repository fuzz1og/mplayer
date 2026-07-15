# music-api-test

音乐 API 端点测试 skill，用于验证 MPlayer 音乐播放器的 API 集成。

## 触发条件

当用户提到以下内容时使用此 skill：
- 测试音乐 API 端点
- 验证 API 集成
- 排查 API 连接问题
- 测试搜索、播放、歌词等功能

## API 端点列表

### 基础端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/search` | GET | 搜索歌曲 |
| `/toplist` | GET | 获取排行榜 |
| `/url` | GET | 获取音频 URL |
| `/lyric` | GET | 获取歌词 |
| `/playlist/catlist` | GET | 获取歌单分类 |
| `/playlist/hot` | GET | 获取热门歌单 |
| `/playlist/detail` | GET | 获取歌单详情 |

### 测试流程

#### 1. 检查 API 配置

```bash
# 检查当前 API URL 配置
# 在应用中：设置 → API 设置
# 或检查 .env.local 文件
cat .env.local | grep MUSIC_API_URL
```

#### 2. 测试基础连接

```bash
# 测试 API 服务器是否可达
curl -I $MUSIC_API_URL/

# 测试搜索端点
curl "$MUSIC_API_URL/search?keywords=test&limit=5"
```

#### 3. 测试各端点

```bash
# 测试排行榜
curl "$MUSIC_API_URL/toplist"

# 测试音频 URL
curl "$MUSIC_API_URL/url?id=SONG_ID"

# 测试歌词
curl "$MUSIC_API_URL/lyric?id=SONG_ID"

# 测试歌单
curl "$MUSIC_API_URL/playlist/hot"
```

## 常见问题排查

### 连接失败

1. 检查 API 服务器是否运行
2. 检查网络连接
3. 检查防火墙设置
4. 验证 API URL 配置

### 响应格式错误

1. 检查 API 版本兼容性
2. 验证请求参数格式
3. 检查编码问题

### 音频播放失败

1. 验证音频 URL 有效性
2. 检查音频格式支持
3. 测试网络带宽

## 音源集成测试

### NetEase (网易云音乐)

```bash
# 测试网易云 API
curl "$MUSIC_API_URL/search?keywords=周杰伦&type=netease"
```

### QQ Music (QQ 音乐)

```bash
# 测试 QQ 音乐 API
curl "$MUSIC_API_URL/search?keywords=周杰伦&type=qq"
```

### Kugou (酷狗音乐)

```bash
# 测试酷狗 API
curl "$MUSIC_API_URL/search?keywords=周杰伦&type=kugou"
```

### Migu (咪咕音乐)

```bash
# 测试咪咕 API
curl "$MUSIC_API_URL/search?keywords=周杰伦&type=migu"
```

## 自动化测试脚本

```bash
#!/bin/bash
# test-api.sh

API_URL=${MUSIC_API_URL:-"http://localhost:3000"}

echo "测试 API 服务器: $API_URL"

# 测试搜索
echo "1. 测试搜索..."
curl -s "$API_URL/search?keywords=test&limit=1" | jq .

# 测试排行榜
echo "2. 测试排行榜..."
curl -s "$API_URL/toplist" | jq .

# 测试歌单
echo "3. 测试热门歌单..."
curl -s "$API_URL/playlist/hot" | jq .

echo "测试完成"
```

## 输出

测试结果将显示：
- 各端点的响应状态
- 响应数据格式
- 错误信息（如有）
- 性能指标（响应时间）

## 注意事项

1. 确保 API 服务器已正确配置
2. 测试时注意 API 限流
3. 保护 API 密钥安全
4. 测试环境与生产环境分离
