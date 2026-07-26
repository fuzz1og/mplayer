---
description: "Run full verification cycle: lint → typecheck → test. Stop on first failure."
---

Run the MPlayer verification pipeline in order. Stop immediately if any step fails.

**Step 1: Lint**
```bash
npm run lint 2>&1 | tail -20
```
Zero warnings tolerated. If non-zero exit, report the warnings and STOP.

**Step 2: Typecheck**
```bash
npx tsc --noEmit 2>&1 | tail -20
```
If errors found, report them and STOP.

**Step 3: Unit tests**
```bash
npm run test:run 2>&1 | tail -20
```
If any test fails, report the failure and STOP.

**Step 4: Report**
If all three pass, report:
```
✅ lint passed
✅ typecheck passed
✅ tests passed (N tests)
```

If $ARGUMENTS is provided, run the verification in the specified worktree directory instead of the current directory.
