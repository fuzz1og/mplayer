#!/usr/bin/env node
/**
 * claim-lint.mjs — 注释里的「外部行为断言」必须有可复核出处。
 *
 * 起因（#647）：`sourceReferer.ts` 一句「源 CDN 防盗链校验 Referer 域名（酷狗/QQ 严格，
 * 网易云宽松）」**没有任何证据**，却撑起了 #592 立项、#602「未取证不得合并」与 ADR
 * `2026-10-08-per-source-request-headers.md` 的全部风险讨论。2026-10-16 五臂实测
 * （无头 / 对源 / 空串 / 跨源 / 假 API 域）在 9 个真实 URL 上 45 次请求全部 200 且字节一致
 * ——该前提从未被证实。断言一旦进了注释，就会被后续 PR、守卫测试、issue 正文反复引用，
 * **没人再回去查源头**，所以要在 CI 拦。
 *
 * 扫描：注释行里出现「对外部系统会怎样」的行为断言，且**同一注释块内没有可复核出处**即 fail。
 *
 * 「可复核出处」= **该断言所在行或其相邻行**（±2 行）出现下列任一：
 *   - 实测数字（`实测 22/22`、`实测 10006/24001`、`0 例`…）
 *   - 具体错误码 / 状态码（`retcode=-1310`、`status:2`、`HTTP 403 实测`…）
 *   - 票号 / ADR 编号（`#592`、`2026-10-08-per-source-request-headers.md`）
 *   - 日期（`2026-10-16 实测`）
 *   - 行尾豁免注释 `claim-lint: ok`（附原因）
 *
 * ⚠️ **出处必须与断言在同一句内**，不能靠「同一注释块里别处」或「相邻几行」的一个票号顶账。
 *    这是实测出来的：宽版判据（±2 行窗口）在两种变异下都漏红——
 *      ① 删掉已有出处，块里其他行的 `#647` 替这句背书；
 *      ② **新增**一句无出处断言，块里已有的出处又替新句背书。
 *    所以判据收紧为：命中句自身（含其从句）必须带出处，否则 fail。
 *
 * 合法示例（带证据，不 fail）：
 *   `* 显式传 0/空串/字符串都会被拒（实测 10006/24001）`
 *   `* 旧 trackercdn i/v2 已被上游风控闸住，实测 22/22 恒空`
 *
 * 要 fail 的示例（无出处）：
 *   `* 源 CDN 防盗链校验 Referer 域名（酷狗/QQ 严格）`
 *   `* 不带/带错会 403`
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
 * 对外部系统「会怎样」的行为断言。刻意窄——只抓「CDN / 源站 / 服务端会不会放行」这类
 * 可被 A/B 证伪的断言，不碰「严格匹配」「严格搜索」这类本仓内部术语。
 *
 * 两类判据：
 *  - `source` 单独命中即算（词形本身就带外部指向，如「防盗链」）；
 *  - `subject` + `neglect` + `consequence` **三者同现**才算（任意词序）。
 *    用「三者同现」而非一条长正则，是为了不受词序影响：
 *      「源站会拒绝不带 Referer 的请求」（后果在否定之前）
 *      「不带 Referer 会被源站拒」（否定在后果之前）
 *    都要抓到。主体词表刻意不含裸「接口 / 客户端」——本仓大量用它们指自家 TS interface、
 *    IPC 通道（实测「客户端接口方法名」里的「接口方」子串曾误伤编译器断言）。
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
