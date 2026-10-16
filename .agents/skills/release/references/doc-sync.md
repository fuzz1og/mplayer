# 发版前文档同步清单

入口是 `writing-for-agents` skill：先加载它、按它写（context pointer / 信息层级 / 剪除）。本节只规定 MPlayer 要核对**哪些**文档与事实。

把活文档对齐到当前代码，避免 `README.md` / `AGENTS.md` / `GLOSSARY.md` / `docs/agents/*` 的描述与实现脱节。

**只改活文档**：`docs/adr/` 的 ADR 与所有 `YYYY-MM-DD-<slug>.md` 存档（research / wayfinder / specs）是历史记录，不回改；决策变了另写一份 ADR。

逐类核对，每条都以代码为准：

1. **目录地图与清单**（最易腐烂）：`docs/agents/architecture.md` 的 components / hooks / stores / services 列表、`AGENTS.md` 与 `README.md` 的架构与目录描述 —— 对着 `ls`、`package.json`、`git grep` 逐条改。
2. **能力 / 数量陈述**：README 的「N 种播放模式」、Tab 数、详情页清单、技术栈版本；`docs/agents/domain.md` 的活文档份数与清单 —— 与实现、依赖版本、目录实际内容比对。
3. **测试与验证描述**：`docs/agents/testing.md` 的 setup mock 清单与四套件矩阵、`AGENTS.md` 的验证入口描述 —— 与 `vite.config.ts` 的 `test` 段 / `vitest.main.config.ts` / `packages/*/vitest.config.ts` / `scripts/verify.mjs` 对齐（**根目录没有 `vitest.config.ts`**）。
4. **截图与资产**：真机 / UI 截图传 PR comment、**不入库**；`docs/**/assets` 只留正文引用的资产，无任何文档引用的孤儿截图直接 `git rm`。
5. **本轮行为变化**：命令 / 行为 / 架构有变时，同一批改动里更新 `AGENTS.md` / `GLOSSARY.md` / 相关 ADR。
6. **常驻预算**：`AGENTS.md` 每轮都载入，只放「所有分支都要」的内容 + 指针；细节推给 `docs/agents/*` / `GLOSSARY.md` / ADR。要新增长内容时先问它是否只服务某一条分支——是，就加指针、不要就地展开。
7. **`.github/` 模板与文档里对它的描述**：模板的段 / 勾选项 / 标题前缀的表述散在 `AGENTS.md`、`git-workflow.md`、`issue-tracker.md`，改模板时同批改描述——这类描述最容易被上一次改动落空（实测：删掉验证清单后 `AGENTS.md` 仍写着「验证清单含双端核对」）。
