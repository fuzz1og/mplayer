#!/usr/bin/env node
// 发布前脱敏：本机路径 / 用户名 / 会话 worktree 名不得进仓库或 PR / issue / release 正文。
// 仓库内由 pre-commit 的 check-privacy 扫暂存区；外部正文用 --text <file> 手检。
// 用法：node scripts/check-privacy.mjs --staged | --text <file> [--text <file>...]

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const PRIVACY_RULES = [
  {
    name: 'windows-user-path',
    re: /\b[A-Za-z]:[\\/]+Users[\\/]+(?!(?:<|%|your[-_ ]?name\b|username\b))[A-Za-z0-9._-]+/gi,
  },
  {
    name: 'appdata-path',
    re: /(?<!~[\\/])AppData[\\/]+(?:Local|Roaming)\b/gi,
  },
  {
    name: 'session-worktree',
    re: /\.agents[\\/]worktrees[\\/][A-Za-z0-9._-]+/gi,
  },
  {
    name: 'session-id',
    re: /\bdsh-[0-9a-f]{8}(?:-[0-9a-f]{4}){0,3}\b/gi,
  },
]

/** 已知的夹具 / 说明性写法：命中的是示例值，不是真实环境标识。 */
export const PRIVACY_ALLOW = [
  {
    path: /^src\/__tests__\/main\/updateService\.test\.ts$/,
    rules: ['windows-user-path', 'appdata-path'],
    reason: '更新器测试夹具故意使用示例安装包路径',
  },
  {
    path: /^src\/main\/services\/downloadService\.ts$/,
    rules: ['windows-user-path'],
    reason: '注释用示例用户名说明路径校验边界',
  },
]

export function scanPrivacy(text, label) {
  const hits = []
  const lines = String(text).split(/\r?\n/)
  for (const rule of PRIVACY_RULES) {
    for (let index = 0; index < lines.length; index++) {
      rule.re.lastIndex = 0
      let match
      while ((match = rule.re.exec(lines[index])) !== null) {
        hits.push({ label, line: index + 1, rule: rule.name, match: match[0] })
      }
    }
  }
  return hits
}

function isAllowed(rel, rule) {
  return PRIVACY_ALLOW.some((entry) => entry.path.test(rel) && entry.rules.includes(rule))
}

function readInput(path) {
  return path === '-' ? readFileSync(0, 'utf8') : readFileSync(resolve(path), 'utf8')
}

function stagedInputs() {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const names = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
  const inputs = []
  for (const name of names) {
    let text
    try {
      text = execFileSync('git', ['show', ':' + name], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    } catch {
      continue
    }
    if (text.includes('\0')) continue
    inputs.push({ label: name, text })
  }
  return inputs
}

function main() {
  const argv = process.argv.slice(2)
  let staged = false
  const inputs = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--staged') {
      staged = true
    } else if (argv[i] === '--text') {
      i++
      if (!argv[i]) {
        console.error('check-privacy: --text needs a file path or -')
        process.exit(2)
      }
      inputs.push({ label: argv[i], text: null, path: argv[i] })
    } else if (argv[i].startsWith('-')) {
      console.error('check-privacy: unknown option ' + argv[i])
      process.exit(2)
    } else {
      console.error('check-privacy: unknown argument ' + argv[i])
      process.exit(2)
    }
  }
  if (!staged && !inputs.length) {
    console.error('usage: node scripts/check-privacy.mjs --staged | --text <file> [--text <file>...]')
    process.exit(2)
  }

  const hits = []
  const stagedFiles = staged ? stagedInputs() : []
  for (const input of stagedFiles) {
    hits.push(...scanPrivacy(input.text, input.label).filter((hit) => !isAllowed(hit.label, hit.rule)))
  }
  for (const input of inputs) {
    let text
    try {
      text = readInput(input.path)
    } catch (e) {
      console.error('check-privacy: cannot read ' + input.path + ': ' + e.message)
      process.exit(2)
    }
    hits.push(...scanPrivacy(text, input.label))
  }

  if (!hits.length) {
    console.log('privacy ok: ' + stagedFiles.length + ' staged file(s), ' + inputs.length + ' text input(s), no machine-specific identifiers')
    return
  }
  console.error('privacy: ' + hits.length + ' finding(s) - 不要提交本机路径、用户名或会话名')
  for (const hit of hits.slice(0, 40)) {
    console.error('  ' + hit.label + ':' + hit.line + '  ' + hit.rule + '  ' + hit.match)
  }
  process.exit(1)
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) main()
