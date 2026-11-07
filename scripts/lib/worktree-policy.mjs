// 工作区路径策略：隐私扫描与 Codex PreToolUse 共用这一份，避免两处规则漂移。
export const FORBIDDEN_WORKTREE_ROOTS = [
  '.claude/worktrees',
  '.agents/worktrees',
  '.dsh-worktrees',
  '.codex/worktrees',
]

const escapeRoot = (root) =>
  root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '[\\\\/]')

export const FORBIDDEN_WORKTREE_RE = new RegExp(
  '(?:' + FORBIDDEN_WORKTREE_ROOTS.map(escapeRoot).join('|') + ')[\\\\/]+[A-Za-z0-9._-]+',
  'gi',
)

export function normalizeWorktreePath(value) {
  return String(value).replace(/\\/g, '/').toLowerCase()
}

export function forbiddenWorktreeRoot(value) {
  const normalized = normalizeWorktreePath(value)
  return (
    FORBIDDEN_WORKTREE_ROOTS.find((root) => {
      const lowered = root.toLowerCase()
      return normalized === lowered || normalized.includes(lowered + '/')
    }) ?? null
  )
}

const VALUE_OPTIONS = new Set(['-b', '-B', '--branch', '--reason', '--track'])

function tokenize(command) {
  const tokens = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = re.exec(command)) !== null) tokens.push(match[1] ?? match[2] ?? match[3])
  return tokens
}

export function classifyWorktreeCommand(command) {
  const text = String(command)
  const add = /\bgit\b[^;&|]*?\bworktree\s+add\b([^;&|]*)/i.exec(text)
  if (!add) return { isWorktreeAdd: false, path: null, root: null }

  const tokens = tokenize(add[1])
  let path = null
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (VALUE_OPTIONS.has(token)) {
      index++
      continue
    }
    if (token.startsWith('-')) continue
    path = token
    break
  }
  return { isWorktreeAdd: true, path, root: path ? forbiddenWorktreeRoot(path) : null }
}
