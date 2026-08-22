#!/usr/bin/env bash
# release.sh — 一键发布新版（对齐当前工作流：version-bump.js 同步 5 文件 + CI 构建发布）
# 用法: ./scripts/release.sh 1.7.2        # 指定完整版本号
#       ./scripts/release.sh patch        # 递增 patch（1.7.1 → 1.7.2）
#       ./scripts/release.sh minor        # 递增 minor（1.7.1 → 1.8.0）
#       ./scripts/release.sh 1.7.2 --skip-verify   # 跳过本地验证（CI 也会验证）
#
# 流程: 验证 → version-bump → commit → push master → tag → push tag（触发 GitHub Actions 发布）
set -e

cd "$(dirname "$0")/.."

if [ -z "$1" ]; then
  echo "用法: ./scripts/release.sh <version|patch|minor|major> [--skip-verify]" >&2
  exit 1
fi

CUR=$(node -p 'require("./package.json").version')
NEW=""
case "$1" in
  patch) NEW=$(node -p 'const [a,b,c]=require("./package.json").version.split(".").map(Number); `${a}.${b}.${c+1}`') ;;
  minor) NEW=$(node -p 'const [a,b]=require("./package.json").version.split(".").map(Number); `${a}.${b+1}.0`') ;;
  major) NEW=$(node -p 'const [a]=require("./package.json").version.split(".").map(Number); `${a+1}.0.0`') ;;
  *)     NEW="$1" ;;
esac

echo "当前版本: $CUR → 新版本: $NEW"

# 1. 分支检查：只在 master 发版
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "master" ]; then
  echo "错误: 发布必须在 master 分支（当前 $BRANCH）" >&2
  exit 1
fi

# 2. 验证
if [ "$2" != "--skip-verify" ]; then
  ./scripts/verify.sh || { echo "验证失败，发布中止" >&2; exit 1; }
fi

# 3. bump 版本（同步 package.json / package-lock.json / app.json / mobile/core package.json）
node scripts/version-bump.js "$NEW"
node scripts/version-bump.js --check

# 4. 提交 + 推送
git add package.json package-lock.json packages/mobile/app.json packages/mobile/package.json packages/core/package.json
git commit -m "chore: bump version to $NEW" || true
git push origin master

# 5. tag + 推送（触发 release.yml 构建发布）
git tag -a "v$NEW" -m "v$NEW"
git push origin "v$NEW"

echo "✓ 已推送 v$NEW，GitHub Actions 构建发布中。监控: gh run watch"
