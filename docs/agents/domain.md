# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root —— 领域词汇：术语的权威定义，以及每个词条明确「避免」的同义词。
- **`GLOSSARY-MAP.md`** at the repo root if it exists —— 它指向每个 context 一份 `GLOSSARY.md`，读与当前主题相关的那几份。**本仓没有这个文件**，即 single-context。
- **`docs/adr/`** —— 读涉及当前改动区域的 ADR；索引在 `docs/adr/README.md`，文件名即稳定引用。

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

single-context：

```
/
|-- GLOSSARY.md                # 领域词汇（2026-10-01 由 CONTEXT.md 更名）
|-- AGENTS.md                  # 常驻指针面
|-- docs/adr/                  # 决策（README.md 是索引）
|   |-- README.md
|   `-- 2026-08-15-musicapi-ipc-single-channel.md
|-- docs/agents/               # 活文档：architecture / testing / git-workflow / domain / issue-tracker / triage-labels / tier3-manifest
`-- packages/                  # workspace：core / mobile
```

## Doc naming convention (2026-09-13)

Two classes, one rule —— 决定加不加日期前缀看**文档是否会原地长期维护**：

- **存档类**（定稿即不再改：ADR / spec / 调研 / 验证记录）→ `YYYY-MM-DD-<slug>.md`，日期 = 定稿日。并发开发无需协调取号，天然不冲突（原 `0004` 双份撞号即顺序取号所致，已让号修正，见 `docs/adr/README.md`）。
- **活文档**（原地长期维护）→ 裸 `kebab-case.md`。仅限 `docs/agents/` 的 7 份（architecture / testing / git-workflow / domain / issue-tracker / triage-labels / tier3-manifest，其中 3 份路径被 `/setup-matt-pocock-skills` 硬编码）+ 根 `GLOSSARY.md` / `AGENTS.md`。
- 目录分工：`docs/adr/` 决策 · `docs/specs/` 规格 · `docs/research/` 调研 · `docs/wayfinder/` 会话资产 · `docs/agents/` 仅活文档。
- ADR 的决策编号 `ADR-NNNN` 保留为**内容内稳定引用标识**（90 处代码/文档引用不改），查 `docs/adr/README.md` 定位文件。新 ADR 不再取号。

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal —— either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) —— but worth reopening because…_
