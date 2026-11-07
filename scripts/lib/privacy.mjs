import { TextDecoder } from 'node:util'
import { FORBIDDEN_WORKTREE_RE } from './worktree-policy.mjs'

const PLACEHOLDER =
  '<|%|your[-_ ]?name\\b|username\\b|user\\b|name\\b|example\\b|foo\\b|test\\b|runner(?:admin)?\\b|public\\b|default\\b|all users\\b'

export const PRIVACY_RULES = [
  {
    name: 'windows-user-path',
    re: new RegExp(
      '(?<![\\w/])\\b[A-Za-z]:[\\\\/]+Users[\\\\/]+(?!' + PLACEHOLDER + ')[A-Za-z0-9._-]+',
      'gi',
    ),
  },
  {
    name: 'wsl-user-path',
    re: new RegExp(
      '(?<![\\w./-])\\/mnt\\/[a-z]\\/Users\\/(?!' + PLACEHOLDER + ')[A-Za-z0-9._-]+',
      'gi',
    ),
  },
  {
    name: 'macos-user-path',
    re: new RegExp(
      '(?<![\\w./-])\\/(?:Users|home)\\/(?!' +
        PLACEHOLDER +
        '|shared\\b|guest\\b)[A-Za-z0-9._-]+',
      'gi',
    ),
  },
  { name: 'agent-worktree-root', re: FORBIDDEN_WORKTREE_RE },
  {
    name: 'session-id',
    re: /\bdsh-[0-9a-f]{8}(?:-[0-9a-f]{4}){0,3}\b/gi,
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

export function maskPrivacyMatch(rule, match) {
  if (rule === 'session-id') return match.replace(/[0-9a-f]/gi, '*')
  const lastSeparator = Math.max(match.lastIndexOf('/'), match.lastIndexOf('\\'))
  return lastSeparator >= 0 ? match.slice(0, lastSeparator + 1) + '***' : '***'
}

export function maskValue(value) {
  if (value.length <= 6) return value[0] + '*'.repeat(value.length - 1)
  return value.slice(0, 2) + '*'.repeat(Math.min(8, value.length - 4)) + value.slice(-2)
}

export function decodeText(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer))
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return decodeUtf8(bytes.subarray(3))
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: bytes.subarray(2).toString('utf16le') }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: swapBytes(bytes.subarray(2)).toString('utf16le') }
  }

  const sample = bytes.subarray(0, Math.min(bytes.length, 4096))
  let evenNul = 0
  let oddNul = 0
  for (let index = 0; index < sample.length; index++) {
    if (sample[index] !== 0) continue
    if (index % 2 === 0) evenNul++
    else oddNul++
  }
  if (sample.length >= 4 && (evenNul > sample.length / 4 || oddNul > sample.length / 4)) {
    return oddNul > evenNul
      ? { text: bytes.toString('utf16le') }
      : { text: swapBytes(bytes).toString('utf16le') }
  }
  return decodeUtf8(bytes)
}

function decodeUtf8(bytes) {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { binary: true }
  }
}

function swapBytes(bytes) {
  const swapped = Buffer.from(bytes)
  for (let index = 0; index + 1 < swapped.length; index += 2) {
    const first = swapped[index]
    swapped[index] = swapped[index + 1]
    swapped[index + 1] = first
  }
  return swapped
}
