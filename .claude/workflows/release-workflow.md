# release-workflow

MPlayer 发布工作流，自动化版本管理、构建和发布流程。

## 使用方式

```bash
/workflow release-workflow [patch|minor|major]
```

## 工作流阶段

### 阶段 1: 预检查

1. **代码质量检查**
   ```bash
   npm run lint
   npm run typecheck
   ```

2. **测试验证**
   ```bash
   npm run test:run
   ```

3. **Git 状态检查**
   ```bash
   git status
   git stash list
   ```

### 阶段 2: 版本管理

1. **确定版本号**
   - `patch`: 修复版本 (1.0.0 → 1.0.1)
   - `minor`: 功能版本 (1.0.0 → 1.1.0)
   - `major`: 主版本 (1.0.0 → 2.0.0)

2. **更新版本号**
   ```bash
   npm version $VERSION_TYPE --no-git-tag-version
   ```

3. **生成变更日志**
   - 分析自上次发布以来的提交
   - 生成结构化变更日志

### 阶段 3: 构建

1. **清理旧构建**
   ```bash
   rm -rf dist/
   rm -rf dist-electron/
   ```

2. **构建应用**
   ```bash
   npm run build
   ```

3. **打包安装程序**
   ```bash
   # 当前平台
   npm run electron:build
   
   # 或指定平台
   npm run electron:build:win
   npm run electron:build:mac
   npm run electron:build:linux
   ```

### 阶段 4: 发布准备

1. **创建 Git 标签**
   ```bash
   git add .
   git commit -m "release: v$VERSION"
   git tag -a "v$VERSION" -m "Release v$VERSION"
   ```

2. **生成发布说明**
   - 从变更日志提取关键信息
   - 格式化为 Markdown

3. **创建 GitHub Release**
   ```bash
   gh release create "v$VERSION" \
     --title "MPlayer v$VERSION" \
     --notes-file RELEASE_NOTES.md \
     dist/*
   ```

### 阶段 5: 发布后

1. **推送更改**
   ```bash
   git push origin main
   git push origin --tags
   ```

2. **清理临时文件**
   ```bash
   rm -f RELEASE_NOTES.md
   ```

3. **通知发布完成**
   - 显示发布摘要
   - 提供下载链接

## 配置选项

### 环境变量

- `SKIP_TESTS`: 跳过测试 (不推荐)
- `SKIP_LINT`: 跳过 lint 检查 (不推荐)
- `DRY_RUN`: 模拟运行，不实际发布

### 发布渠道

- `latest`: 最新稳定版
- `beta`: 测试版
- `alpha`: 内测版

## 注意事项

1. 确保所有测试通过后再发布
2. 遵循语义化版本规范
3. 发布前检查变更日志
4. 跨平台构建需要相应环境
5. GitHub Release 需要适当的权限

## 故障回滚

如果发布出现问题：

1. **删除 GitHub Release**
   ```bash
   gh release delete "v$VERSION" --yes
   ```

2. **删除 Git 标签**
   ```bash
   git tag -d "v$VERSION"
   git push origin :refs/tags/"v$VERSION"
   ```

3. **回滚版本号**
   ```bash
   git revert HEAD
   git push origin main
   ```
