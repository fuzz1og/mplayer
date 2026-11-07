// 会话 worktree 根：这些不是仓库内容；.agents/worktrees 与 .worktrees 是允许的。
export const FORBIDDEN_WORKTREE_ROOTS = [
  '.claude/worktrees',
  '.dsh-worktrees',
  '.codex/worktrees',
]

const escapeRoot = (root) =>
  root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '[\\\\/]')

export const FORBIDDEN_WORKTREE_RE = new RegExp(
  '(?:' + FORBIDDEN_WORKTREE_ROOTS.map(escapeRoot).join('|') + ')[\\\\/]+[A-Za-z0-9._-]+',
  'gi',
)
