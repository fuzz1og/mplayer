import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeText, maskPrivacyMatch, scanPrivacy } from '../lib/privacy.mjs'
import { classifyWorktreeCommand } from '../lib/worktree-policy.mjs'

const winUser = (name, rest = 'file.txt') =>
  ['C:', 'Users', name, ...rest.split('/')].join('\\')
const winRoot = (root, rest = 'mplayer') => ['D:', root, ...rest.split('/')].join('\\')
const posix = (...parts) => '/' + parts.join('/')
const agentWorktree = (agent, name) => ['.' + agent, 'worktrees', name].join('/')

test('detects real machine paths and masks them', () => {
  const fixtures = [
    winUser('alice'),
    winRoot('Playground'),
    winRoot('leidian', 'LDPlayer14'),
    winRoot('tools', 'gradle'),
    winRoot('ComfyUI-xpu-omni'),
    posix('mnt', 'c', 'Users', 'alice', 'cache'),
    posix('Users', 'alice', 'file'),
    posix('home', 'alice', 'file'),
    agentWorktree('claude', 'foo'),
    agentWorktree('codex', 'foo'),
    agentWorktree('agents', 'foo'),
    ['.dsh-worktrees', 'foo'].join('/'),
    'dsh-' + '0123abcd',
  ]
  for (const fixture of fixtures) {
    const hits = scanPrivacy(fixture, 'fixture')
    assert.ok(hits.length > 0, 'expected a hit for ' + fixture)
    for (const hit of hits) {
      const masked = maskPrivacyMatch(hit.rule, hit.match)
      assert.ok(masked.includes('***'), 'expected masked output')
      assert.ok(!masked.includes('alice'), 'username must not be echoed')
    }
  }
})

test('does not flag placeholders, system paths, or the neutral worktree root', () => {
  const fixtures = [
    winUser('example'),
    winUser('foo'),
    winUser('test'),
    winUser('runner'),
    winUser('username'),
    winUser('%USERNAME%'),
    'C:\\Users\\<name>\\file.txt',
    'C:\\Program Files\\repo\\mplayer\\packages\\mobile\\android',
    'C:\\Program Files\\my tools\\android\\gradlew.bat',
    'D:/Music',
    'D:/Downloads',
    '.worktrees/foo',
    posix('Users', 'runner', 'file'),
    posix('home', 'runner', 'file'),
  ]
  for (const fixture of fixtures) {
    assert.deepEqual(scanPrivacy(fixture, 'fixture'), [], 'unexpected hit for ' + fixture)
  }
})

test('decodes UTF-16 with a BOM instead of treating it as binary', () => {
  const text = 'see ' + winUser('alice')
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
  assert.deepEqual(decodeText(utf16), { text })
  assert.ok(scanPrivacy(decodeText(utf16).text, 'fixture').length > 0)
})

test('rejects invalid UTF-8 instead of silently passing it', () => {
  assert.deepEqual(decodeText(Buffer.from([0xff])), { binary: true })
})

test('worktree policy rejects agent-specific roots and allows .worktrees', () => {
  const rejected = [
    'git worktree add ' + agentWorktree('claude', 'foo') + ' -b x',
    'git worktree add -b x ' + agentWorktree('codex', 'foo'),
    'git -C repo worktree add ' + agentWorktree('agents', 'foo'),
    'git worktree add ' + ['.dsh-worktrees', 'foo'].join('/') + ' -b x',
    'git worktree add ' + ['C:', 'Users', 'example', '.codex', 'worktrees', 'foo'].join('\\'),
  ]
  for (const command of rejected) {
    assert.ok(classifyWorktreeCommand(command).root, 'expected a forbidden root for ' + command)
  }

  const allowed = [
    'git worktree add .worktrees/foo -b x',
    'git worktree add -b x .worktrees/foo origin/master',
    'git worktree add "C:\\Program Files\\my worktree" -b x',
    'git worktree list',
  ]
  for (const command of allowed) {
    assert.equal(classifyWorktreeCommand(command).root, null, 'unexpected rejection for ' + command)
  }
})
