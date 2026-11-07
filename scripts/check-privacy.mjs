#!/usr/bin/env node
// 发布前脱敏：本机路径 / 用户名 / 会话 worktree 名不得进仓库或 PR / issue / release 正文。
// pre-commit 扫暂存区，CI 扫 tracked 文件；外部正文用 --text <file> 手检。
// 用法：node scripts/check-privacy.mjs --staged | --tracked | --text <file> [--text <file>...]

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PRIVACY_RULES, decodeText, maskPrivacyMatch, scanPrivacy } from './lib/privacy.mjs'

function repoRoot() {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
}

function git(root, args, options = {}) {
  return execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024, ...options })
}

function decodeOrSkip(buffer) {
  const decoded = decodeText(buffer)
  return decoded.binary ? null : decoded.text
}

function stagedInputs(root) {
  const names = git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], {
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
  const inputs = []
  const skipped = []
  for (const name of names) {
    let buffer
    try {
      buffer = git(root, ['show', ':' + name])
    } catch (error) {
      throw new Error('cannot read staged file ' + name + ' (' + (error.code ?? 'git show failed') + ')')
    }
    const text = decodeOrSkip(buffer)
    if (text === null) skipped.push(name)
    else inputs.push({ label: name, text })
  }
  return { inputs, skipped }
}

function trackedInputs(root) {
  const names = git(root, ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  const inputs = []
  const skipped = []
  for (const name of names) {
    let buffer
    try {
      buffer = readFileSync(join(root, name))
    } catch (error) {
      throw new Error('cannot read tracked file ' + name + ' (' + (error.code ?? 'read failed') + ')')
    }
    const text = decodeOrSkip(buffer)
    if (text === null) skipped.push(name)
    else inputs.push({ label: name, text })
  }
  return { inputs, skipped }
}

function readTextInput(path) {
  const buffer = path === '-' ? readFileSync(0) : readFileSync(resolve(path))
  const text = decodeOrSkip(buffer)
  if (text === null) throw new Error('not UTF-8/UTF-16 text')
  return text
}

function displayLabel(label, isText) {
  const safe = isText ? (label === '-' ? 'stdin' : basename(label)) : label
  for (const rule of PRIVACY_RULES) {
    rule.re.lastIndex = 0
    if (rule.re.test(safe)) return '<input>'
  }
  return safe
}

function main() {
  const argv = process.argv.slice(2)
  let staged = false
  let tracked = false
  const textInputs = []
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--staged') {
      staged = true
    } else if (argv[index] === '--tracked') {
      tracked = true
    } else if (argv[index] === '--text') {
      index++
      if (!argv[index]) {
        console.error('check-privacy: --text needs a file path or -')
        process.exit(2)
      }
      textInputs.push(argv[index])
    } else if (argv[index].startsWith('-')) {
      console.error('check-privacy: unknown option ' + argv[index])
      process.exit(2)
    } else {
      console.error('check-privacy: unknown argument ' + argv[index])
      process.exit(2)
    }
  }
  if (!staged && !tracked && !textInputs.length) {
    console.error(
      'usage: node scripts/check-privacy.mjs --staged | --tracked | --text <file> [--text <file>...]',
    )
    process.exit(2)
  }

  const hits = []
  const skipped = []
  let scanned = 0
  if (staged || tracked) {
    const root = repoRoot()
    if (staged) {
      const result = stagedInputs(root)
      scanned += result.inputs.length
      skipped.push(...result.skipped)
      for (const input of result.inputs)
        hits.push(...scanPrivacy(input.text, displayLabel(input.label, false)))
    }
    if (tracked) {
      const result = trackedInputs(root)
      scanned += result.inputs.length
      skipped.push(...result.skipped)
      for (const input of result.inputs)
        hits.push(...scanPrivacy(input.text, displayLabel(input.label, false)))
    }
  }
  for (const path of textInputs) {
    let text
    try {
      text = readTextInput(path)
    } catch (error) {
      console.error(
        'check-privacy: cannot read ' +
          displayLabel(path, true) +
          ' (' +
          (error.code ?? error.message) +
          ')',
      )
      process.exit(2)
    }
    scanned++
    hits.push(...scanPrivacy(text, displayLabel(path, true)))
  }

  if (!hits.length) {
    console.log(
      'privacy ok: ' +
        scanned +
        ' file(s) scanned, ' +
        skipped.length +
        ' skipped (binary), no machine-specific identifiers',
    )
    return
  }
  console.error('privacy: ' + hits.length + ' finding(s) - 不要提交本机路径、用户名或会话名')
  for (const hit of hits.slice(0, 40)) {
    console.error(
      '  ' +
        hit.label +
        ':' +
        hit.line +
        '  ' +
        hit.rule +
        '  ' +
        maskPrivacyMatch(hit.rule, hit.match),
    )
  }
  process.exit(1)
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) main()
