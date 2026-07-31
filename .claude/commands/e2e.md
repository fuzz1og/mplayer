---
description: "Run Playwright E2E tests. Usage: /e2e [spec-name|all] [--timeout 120000]"
---

Run MPlayer Playwright E2E tests against the Chromium project.

**Args**: `$ARGUMENTS` — optional spec name (without `e2e/` prefix and `.spec.ts` suffix) or `all`. Defaults to `all`.

**Step 1: Resolve spec file**
```bash
SPEC="$ARGUMENTS_SPEC"
if [ -z "$SPEC" ] || [ "$SPEC" = "all" ]; then
  echo "Running ALL E2E tests"
  CMD="npx playwright test --project=chromium"
else
  FILE="e2e/${SPEC}.spec.ts"
  if [ ! -f "$FILE" ]; then
    echo "❌ Spec file not found: $FILE"
    echo "Available specs:"
    ls -1 e2e/*.spec.ts | sed 's|e2e/||;s|.spec.ts||'
    exit 1
  fi
  echo "Running: $FILE"
  CMD="npx playwright test $FILE --project=chromium"
fi
```

**Step 2: Run with timeout**
```bash
TIMEOUT="${TIMEOUT:-180000}"
$CMD --timeout $TIMEOUT 2>&1 | tail -20
```

**Step 3: Report**
- If exit code 0: report ✅ with pass count
- If non-zero: report ❌ with failure summary and suggest re-running the specific failed spec

**Available specs**: `electron-e2e`, `bug-add-to-playlist`, `cross-page`, `favorites`, `playback`, `playlist`, `ui-redesign`, `update-proxy`, `advanced`

**Examples**:
- `/e2e` or `/e2e all` — run all E2E tests
- `/e2e electron-e2e` — run just the Electron E2E spec
- `/e2e playback` — run playback tests
