#!/usr/bin/env node
// Codex PreToolUse guard: manual worktrees must not land in agent-specific roots.
import { classifyWorktreeCommand } from './lib/worktree-policy.mjs'

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '')
}

async function main() {
  let input
  try {
    input = JSON.parse(await readStdin())
  } catch {
    return
  }
  const toolInput = input?.tool_input
  const command =
    typeof toolInput === 'string' ? toolInput : toolInput?.command ?? toolInput?.cmd
  if (typeof command !== 'string') return

  const verdict = classifyWorktreeCommand(command)
  if (!verdict.isWorktreeAdd || !verdict.root) return

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `Worktree path is under ${verdict.root}/. Use Codex's worktree mode or ` +
          '`git worktree add .worktrees/<slug> -b <type>/<slug> origin/master`.',
      },
    }),
  )
}

await main()
