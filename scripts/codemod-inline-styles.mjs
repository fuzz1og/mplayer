#!/usr/bin/env node
/**
 * 一次性 codemod：把「全静态」的 JSX 内联样式对象搬成生成式 CSS 类（1.9.0 #689）。
 * 只处理值全是字面量 / var() 的对象；含条件、变量、展开的对象保持原样并计入报告，
 * 由人工或后续批次处理。生成结果写进 src/renderer/styles/generated.css。
 *
 * 用法：node scripts/codemod-inline-styles.mjs [--apply]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';

const ROOT = process.cwd();
const APPLY = process.argv.includes('--apply');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice('--only='.length);
const SCAN = 'src/renderer';
const OUT_CSS = path.join(ROOT, 'src/renderer/styles/generated.css');

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      yield* walk(full);
    } else if (entry.isFile() && full.endsWith('.tsx')) {
      yield full;
    }
  }
}

const kebab = (name) =>
  name.startsWith('--')
    ? name
    : name.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()).replace(/^ms-/, '-ms-');

/** 值必须是能直接写进 CSS 的字面量；否则这个对象整体跳过。 */
function literalToCss(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return node.text;
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) {
    return '-' + node.operand.text;
  }
  return null;
}

function objectToRule(obj) {
  const decls = [];
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) return null;
    const keyNode = prop.name;
    const key = ts.isIdentifier(keyNode) ? keyNode.text : ts.isStringLiteral(keyNode) ? keyNode.text : null;
    if (!key) return null;
    const value = literalToCss(prop.initializer);
    if (value === null) return null;
    let cssValue = value;
    if (/^[0-9.-]+$/.test(cssValue) && !key.startsWith('--') && !['opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'order', 'lineHeight', 'fontWeight', 'gridColumn', 'gridRow'].includes(key)) {
      cssValue += 'px';
    }
    decls.push('  ' + kebab(key) + ': ' + cssValue + ';');
  }
  return decls.length === 0 ? null : decls.join('\n');
}

const rules = new Map();
let converted = 0;
let skipped = 0;
const skippedFiles = new Map();

for (const file of walk(path.join(ROOT, SCAN))) {
  if (ONLY && !file.split(path.sep).join('/').includes(ONLY)) continue;
  const source = readFileSync(file, 'utf8');
  if (!source.includes('style={{')) continue;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];

  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(sf) === 'style') {
      const init = node.initializer;
      if (init && ts.isJsxExpression(init) && init.expression && ts.isObjectLiteralExpression(init.expression)) {
        const rule = objectToRule(init.expression);
        if (rule) {
          const hash = crypto.createHash('sha1').update(rule).digest('hex').slice(0, 8);
          const cls = 's-' + hash;
          rules.set(cls, rule);
          // JsxAttribute.parent 是 JsxAttributes，再上一层才是元素本身
          const attrs = ts.isJsxAttributes(node.parent) ? node.parent : null;
          const tag = attrs?.parent;
          if (!attrs || !tag) return;
          const classAttr = attrs.properties.find(
            (a) => ts.isJsxAttribute(a) && a.name.getText(sf) === 'className',
          );
          if (!classAttr) {
            edits.push({ start: node.getStart(sf), end: node.getEnd(), text: 'className="' + cls + '"' });
          } else if (
            classAttr.initializer &&
            ts.isStringLiteral(classAttr.initializer)
          ) {
            const merged = classAttr.initializer.text + ' ' + cls;
            edits.push({ start: node.getStart(sf), end: node.getEnd(), text: '' });
            edits.push({
              start: classAttr.initializer.getStart(sf),
              end: classAttr.initializer.getEnd(),
              text: JSON.stringify(merged),
            });
          } else {
            return;
          }
          converted += 1;
          return;
        }
      }
      skipped += 1;
      skippedFiles.set(file, (skippedFiles.get(file) ?? 0) + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (edits.length > 0 && APPLY) {
    edits.sort((a, b) => b.start - a.start);
    let next = source;
    for (const edit of edits) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
    writeFileSync(file, next, 'utf8');
  }
}

console.log('静态样式对象 → 类：' + converted + '，跳过（含动态值）：' + skipped);
if (skippedFiles.size > 0) {
  const top = [...skippedFiles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log('跳过的文件（前 15）：');
  for (const [f, n] of top) console.log('  ' + path.relative(ROOT, f).split(path.sep).join('/') + '  ' + n);
}
if (APPLY) {
  const body = [...rules.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([cls, rule]) => '.' + cls + ' {\n' + rule + '\n}')
    .join('\n\n');
  const header = '/* 由 scripts/codemod-inline-styles.mjs 生成：内联样式的等价类（1.9.0 #689）。不要手改。 */\n\n';
  writeFileSync(OUT_CSS, header + body + '\n', 'utf8');
  console.log('写入 ' + path.relative(ROOT, OUT_CSS) + '（' + rules.size + ' 条规则）');
  const mainEntry = path.join(ROOT, 'src/renderer/main.tsx');
  if (existsSync(mainEntry)) {
    const src = readFileSync(mainEntry, 'utf8');
    if (!src.includes("styles/generated.css")) {
      writeFileSync(
        mainEntry,
        src.replace("import './styles/global.css';", "import './styles/global.css';\nimport './styles/generated.css';"),
        'utf8',
      );
      console.log('main.tsx 已引入 generated.css');
    }
  }
}
