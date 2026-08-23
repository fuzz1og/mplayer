#!/usr/bin/env bash
# design-lint.sh — 组件内 hex 色值门禁（UI 重构指南 §9）
# 两级扫描：
#   1) mobile 严格模式：packages/mobile/{components,app} 内一切引号包裹的 hex 色值，
#      仅豁免 token 定义文件（下方 MOBILE_ALLOW_FILES）与行级豁免标记。
#      行级豁免：合法遗留在该行行尾注释 `design-lint: ok`（附原因）。
#   2) desktop 黑名单模式：src/renderer 内命中遗留 hex 黑名单（LEGACY_HEX）即 fail。
#      桌面 P2（清账 187 hex，延后）逐项清理后把对应色值填进黑名单防回归，
#      因此当前为空清单、恒通过——门禁随 P2 进度生效。
# 注：正则限定引号包裹，避免误伤注释里的 GitHub issue 引用（#172/#173 等）。
set -e

cd "$(dirname "$0")/.."

FAIL=0

# ── 1) mobile 严格模式 ────────────────────────────────────────
# token 定义文件 = 设计系统色值唯一事实源，豁免（未来新增 palette 文件在此追加）
MOBILE_ALLOW_FILES=(
  "packages/mobile/theme/tokens.ts"
)

echo "→ design-lint: mobile 严格模式（components/app）"
while IFS=: read -r file line rest; do
  allow=0
  for f in "${MOBILE_ALLOW_FILES[@]}"; do
    [ "$file" = "$f" ] && allow=1
  done
  [ "$allow" = 1 ] && continue
  if echo "$rest" | grep -q "design-lint: ok"; then continue; fi
  hit=$(echo "$rest" | grep -oE "['\"]#[0-9a-fA-F]{3,8}['\"]" | head -1)
  echo "  ✗ $file:$line 非 token hex 色值: $hit（token 文件见 MOBILE_ALLOW_FILES；合法遗留加行尾注释 design-lint: ok）"
  FAIL=1
done < <(grep -rnE "['\"]#[0-9a-fA-F]{3,8}['\"]" packages/mobile/components packages/mobile/app || true)

# ── 2) desktop 黑名单模式 ─────────────────────────────────────
# 格式: "色值|清理原因"，清一处填一处
LEGACY_HEX=()

echo "→ design-lint: desktop 黑名单模式（renderer，遗留 ${#LEGACY_HEX[@]} 项）"
if [ "${#LEGACY_HEX[@]}" -gt 0 ]; then
  for entry in "${LEGACY_HEX[@]}"; do
    hex="${entry%%|*}"
    reason="${entry#*|}"
    hits=$(grep -rnE "['\"]${hex}['\"]" src/renderer || true)
    if [ -n "$hits" ]; then
      echo "  ✗ 遗留色值 ${hex}（${reason}）："
      echo "$hits" | while IFS=: read -r f l rest2; do
        echo "      $f:$l"
      done
      FAIL=1
    fi
  done
fi

if [ "$FAIL" = 1 ]; then
  echo "✗ design-lint 未通过：存在非 token hex 色值"
  exit 1
fi
echo "✓ design-lint passed"
