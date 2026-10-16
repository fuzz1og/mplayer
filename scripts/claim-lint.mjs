#!/usr/bin/env node
/**
 * claim-lint.mjs — 注释里的「外部行为断言」必须有可复核出处。起因（#647）：`sourceReferer.ts` 一句无证据的「源 CDN 防盗链校验 Referer 域名」
 * 却撑起了 #592 立项、#602 与 ADR `2026-10-08` 的全部风险讨论；断言一旦进了注释就会被反复引用，**没人再回去查源头**，所以要在 CI 拦。
 * 判据：注释行出现「对外部系统会怎样」的断言（如「不带 Referer 会 403」）且**同一句内**无出处即 fail；出处 = 实测数字 / 错误码 / 票号 / ADR / 日期 / 行尾 `claim-lint: ok`（附原因）。
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(ROOT);

const SCAN_DIRS = ['packages/core/src', 'packages/mobile', 'src'];
const SCAN_EXT = new Set(['.ts', '.tsx', '.kt']);
const ALLOW_MARKER = 'claim-lint: ok';

/**
 * 对外部系统「会怎样」的行为断言。刻意窄——只抓「CDN / 源站 / 服务端会不会放行」这类可被 A/B 证伪的断言，不碰本仓内部术语。
 * 两类判据：`source` 单独命中即算（词形本身带外部指向，如「防盗链」）；`subject` + `neglect` + `consequence`
 * **三者同现**才算（任意词序，如「源站会拒绝不带 Referer 的请求」）。主体词表刻意不含裸「接口 / 客户端」（曾误伤自家 interface 断言）。
 */
const CLAIM_PATTERNS = [
  {
    label: 'CDN/源站放行断言',
    source: String.raw`(防盗链|风控闸|风控的|严格防盗链)`,
  },
  {
    label: 'HTTP 状态断言',
    source: String.raw`会\s*(返回|得到|是)?\s*(403|401|429)`,
  },
  {
    label: '外部主体 + 缺头条件 + 拒绝后果（同现）',
    subject: String.raw`(源站|上游|CDN|cdn|服务端|对端|网易云|酷狗|酷我|QQ|汽水|咪咕|千千)`,
    neglect: String.raw`(不带|带错|缺少?|没有|漏|裸)`,
    consequence: String.raw`(被?拒(?:绝)?|拦截|挡下?|403|401|429|拿不到|取不到|解不出|放行)`,
  },
];

/** 同块内的可复核出处。 */
const EVIDENCE_PATTERNS = [
  String.raw`实测`,
  String.raw`复现`,
  String.raw`#\d{2,4}\b`,
  String.raw`20\d{2}-\d{2}-\d{2}`,
  String.raw`retcode\s*[=:]\s*-?\d+`,
  String.raw`status\s*[=:]\s*\d+`,
  String.raw`\b\d{3}\b\s*(实测|恒|必)`, // 「403 实测」
  String.raw`\d+\s*/\s*\d+`, // 「22/22」
  String.raw`ADR`,
  String.raw`docs/(adr|research|specs)/`,
];

/** 把一条判据编译成正则组：单 `source` 型给一组；三条件同现型给三组（须全中）。 */
const CLAIM_RE = CLAIM_PATTERNS.map((p) => ({
  label: p.label,
  groups: p.source ? [new RegExp(p.source)] : [new RegExp(p.subject), new RegExp(p.neglect), new RegExp(p.consequence)],
}));

/** 该句是否命中某条判据（三条件型要求同句内三者都出现）。 */
function claimHit(text) {
  for (const c of CLAIM_RE) if (c.groups.every((re) => re.test(text))) return c;
  return null;
}
const EVIDENCE_RE = new RegExp(EVIDENCE_PATTERNS.join('|'));

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== '__tests__') yield* walk(full);
      continue;
    }
    if (entry.isFile() && SCAN_EXT.has(path.extname(entry.name))) yield full;
  }
}

/**
 * 把源码切成「注释块」：连续的注释行算一个块（`//` 连续行、或 `/** … *\/` 整体）。
 * 判据是**块级**而非行级——出处常写在断言的上一行或下一行。
 */
function commentBlocks(rows) {
  const blocks = [];
  let cur = null;
  let inBlockComment = false;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const trimmed = row.trim();
    const isCommentStart = trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
    const isCommentBody = trimmed.startsWith('*') || trimmed.startsWith('//');
    if (inBlockComment) {
      if (cur) cur.lines.push(i);
      if (trimmed.endsWith('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*') && !trimmed.endsWith('*/')) {
      inBlockComment = true;
      cur = { lines: [i] };
      blocks.push(cur);
      continue;
    }
    if (trimmed.startsWith('/*') && trimmed.endsWith('*/')) {
      blocks.push({ lines: [i] });
      cur = null;
      continue;
    }
    if (isCommentStart || (cur && isCommentBody)) {
      if (!cur) {
        cur = { lines: [i] };
        blocks.push(cur);
      } else {
        cur.lines.push(i);
      }
      continue;
    }
    cur = null;
  }
  return blocks;
}

let failed = false;
let scannedBlocks = 0;
let flagged = 0;

console.log('→ claim-lint: 注释里的外部行为断言需带可复核出处');

for (const dir of SCAN_DIRS) {
  for (const file of walk(dir)) {
    const rel = file.split(path.sep).join('/');
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const rows = text.split(/\r?\n/);
    for (const block of commentBlocks(rows)) {
      const body = block.lines.map((i) => rows[i]).join('\n');
      if (body.includes(ALLOW_MARKER)) continue;
      // 逐行判：命中行自身（含紧邻一行续写）必须带出处，否则 fail 并指出具体行。
      const hitLine = block.lines.find((i) => claimHit(rows[i]) !== null);
      const hit = hitLine === undefined ? null : claimHit(rows[hitLine]);
      if (!hit) continue;
      scannedBlocks++;
      // 出处必须与断言同句：取该行、以及紧邻的续行（JSDoc 折行续写）。
      const own = rows.slice(hitLine, hitLine + 2).join('\n');
      if (EVIDENCE_RE.test(own)) continue;
      flagged++;
      failed = true;
      const where = block.lines.map((i) => i + 1).join(',');
      console.log(
        '  ✗ ' + rel + ':' + (hitLine + 1) + '（块 ' + where + '）  ' + hit.label + '，该句无出处。' +
          '在同一句补实测数字/错误码/票号，或标注推测；确认无误可加 `' + ALLOW_MARKER + '`（附原因）。',
      );
      console.log('      ' + rows[hitLine].trim().slice(0, 110));
    }
  }
}

if (failed) {
  console.error(`✗ claim-lint 失败：${flagged} 处无出处的外部行为断言（规则见 docs/agents/issue-tracker.md）`);
  process.exit(1);
}
console.log(`✓ claim-lint 通过：注释块 ${scannedBlocks} 处含行为断言，均带可复核出处`);
