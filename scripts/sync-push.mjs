#!/usr/bin/env node
// push-via-api.mjs —— git TLS 栈坏掉时的推送兜底：走 GitHub Git Data API。
// 同步点记在 .git/ui-sync-sha（本地最后一个已推送的提交，因为 API 重建的 sha 与本地不同）。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const branch = process.argv[2] ?? 'feat/ui-redesign-1.9.0';
// worktree 的 .git 是指向主仓库 gitdir 的**文件**，必须用 git rev-parse --git-dir 解析
const syncFile = path.join(execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: ROOT, encoding: 'utf8' }).trim(), 'ui-sync-sha');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const gitBuf = (...a) => execFileSync('git', a, { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
function gh(args, payload) {
  // 大 payload（40KB+ 的 blob base64）走 stdin 会被截断成 422，改为写临时文件再 --input
  if (payload === undefined) {
    const out = execFileSync('gh', ['api', ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out.trim() ? JSON.parse(out) : null;
  }
  const tmp = path.join(os.tmpdir(), 'gh-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json');
  writeFileSync(tmp, JSON.stringify(payload), 'utf8');
  try {
    const out = execFileSync('gh', ['api', ...args, '--input', tmp], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return out.trim() ? JSON.parse(out) : null;
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

const head = git('rev-parse', branch);
const synced = existsSync(syncFile) ? readFileSync(syncFile, 'utf8').trim() : null;
const remoteTip = gh(['repos/{owner}/{repo}/git/refs/heads/' + branch]).object.sha;

function findLocalBaseForRemote(remoteSha) {
  const remoteTree = gh(['repos/{owner}/{repo}/git/commits/' + remoteSha]).tree.sha;
  for (const line of git('log', '--format=%H %T', branch).split('\n').filter(Boolean)) {
    const [sha, tree] = line.split(' ');
    if (tree === remoteTree) return sha;
  }
  return null;
}

const resolvedBase = synced ?? findLocalBaseForRemote(remoteTip);
if (!resolvedBase) { console.error('找不到同步点：远端与本地历史不一致'); process.exit(1); }
if (git('rev-parse', resolvedBase + '^{tree}') === git('rev-parse', head + '^{tree}')) {
  writeFileSync(syncFile, head + '\n', 'utf8');
  console.log('内容已同步（sha 不同），无需推送：' + head.slice(0, 8));
  process.exit(0);
}

const pending = git('log', '--reverse', '--format=%H%x00%T%x00%s', resolvedBase + '..' + head)
  .split('\n').filter(Boolean).map((l) => l.split('\0'));
console.log('待推 ' + pending.length + ' 个提交（本地 ' + head.slice(0, 8) + '，远端 ' + remoteTip.slice(0, 8) + '）');

const treeCache = new Map();
const blobCache = new Map();
function lsTree(sha) {
  const m = new Map();
  for (const line of git('ls-tree', sha).split('\n').filter(Boolean)) {
    const [meta, name] = line.split('\t');
    const [mode, type, s] = meta.split(' ');
    m.set(name, { mode, type, sha: s });
  }
  return m;
}
function uploadBlob(localSha) {
  if (blobCache.has(localSha)) return blobCache.get(localSha);
  const content = gitBuf('cat-file', 'blob', localSha).toString('base64');
  const res = gh(['repos/{owner}/{repo}/git/blobs', '-X', 'POST'], { content, encoding: 'base64' });
  blobCache.set(localSha, res.sha);
  return res.sha;
}
function rebuild(treeSha, prefix, changed, deleted, localTreeSha) {
  const entries = lsTree(treeSha);
  const payload = [];
  let dirty = false;
  for (const [name, entry] of entries) {
    const full = prefix + name;
    if (entry.type === 'tree') {
      const touches = [...changed, ...deleted].some((p) => p === full || p.startsWith(full + '/'));
      if (touches) {
        payload.push({ path: name, mode: entry.mode, type: 'tree', sha: rebuild(entry.sha, full + '/', changed, deleted) });
        dirty = true;
      } else {
        payload.push({ path: name, mode: entry.mode, type: 'tree', sha: entry.sha });
      }
    } else if (deleted.includes(full)) {
      // 删除：不能进 payload（GitHub 用缺席表达删除）
      dirty = true;
    } else if (changed.includes(full)) {
      payload.push({ path: name, mode: entry.mode, type: 'blob', sha: uploadBlob(entry.sha) });
      dirty = true;
    } else {
      payload.push({ path: name, mode: entry.mode, type: 'blob', sha: entry.sha });
    }
  }
  if (!dirty) return treeSha;
  if (treeCache.has(treeSha)) return treeCache.get(treeSha);
  const res = gh(['repos/{owner}/{repo}/git/trees', '-X', 'POST'], { tree: payload });
  treeCache.set(treeSha, res.sha);
  return res.sha;
}

let parent = remoteTip;
for (let i = 0; i < pending.length; i += 1) {
  const [sha, , subject] = pending[i];
  const parentLocal = i === 0 ? resolvedBase : pending[i - 1][0];
  const changed = git('diff', '--name-only', parentLocal, sha).split('\n').filter(Boolean);
  const changedSet = new Set(changed);
  const deleted = git('diff', '--diff-filter=D', '--name-only', parentLocal, sha).split('\n').filter(Boolean);
  // 基线用**远端 tip** 的根 tree：本地 tree 里引用的子树远端可能没有（上次是 API 重建的）
  const baseRoot = gh(['repos/{owner}/{repo}/git/commits/' + parent]).tree.sha;
  const newTree = rebuild(baseRoot, '', [...new Set([...changed, ...deleted])], deleted, git('rev-parse', sha + '^{tree}'));
  const [an, ae, ai] = git('show', '-s', '--format=%an%x00%ae%x00%aI', sha).split('\0');
  const created = gh(['repos/{owner}/{repo}/git/commits', '-X', 'POST'], {
    message: subject, tree: newTree, parents: [parent],
    author: { name: an, email: ae, date: ai },
    committer: { name: an, email: ae, date: ai },
  });
  parent = created.sha;
  console.log('  ' + parent.slice(0, 8) + ' ' + subject.slice(0, 46) + ' (changed ' + changed.length + ')');
}

gh(['repos/{owner}/{repo}/git/refs/heads/' + branch, '-X', 'PATCH'], { sha: parent, force: true });
writeFileSync(syncFile, head + '\n', 'utf8');
console.log('✓ 已推送：远端 ' + parent.slice(0, 8) + '，同步点 ' + head.slice(0, 8));