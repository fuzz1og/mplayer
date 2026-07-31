---
description: "List worktrees, check for uncommitted changes, and remove stale ones."
---

Clean up stale git worktrees for the MPlayer project.

**Step 1: List all worktrees**
```bash
git worktree list
```

**Step 2: For each non-main worktree, check status**
```bash
git -C <worktree-path> status --short
git -C <worktree-path> log --oneline main..HEAD 2>/dev/null || git -C <worktree-path> log --oneline master..HEAD 2>/dev/null
```

**Step 3: Report findings**
For each worktree, report:
- Path
- Branch name
- Has uncommitted changes? (yes/no)
- Unmerged commits? (count)
- Recommendation: keep / merge first / safe to remove

**Step 4: Remove stale worktrees**
Only remove worktrees that:
- Have NO uncommitted changes
- Have NO unmerged commits (or user confirms they're not needed)
- Are not the current worktree

Use `git worktree remove <path>` for clean removal.
If worktree is dirty and user wants to force remove, use `git worktree remove --force <path>` but warn about data loss.

If $ARGUMENTS is provided (e.g. "force"), skip the safety checks and remove all non-main worktrees.
