# 发版前文档同步清单

入口：先加载 `writing-for-agents` skill。只改活文档；ADR 与 `YYYY-MM-DD-*.md` 存档（research / wayfinder / specs）不回改，决策变了另写 ADR。

逐类对照代码核对：

1. **目录地图**：`docs/agents/architecture.md` 的 components/hooks/stores/services、`AGENTS.md` 与 `README.md` 的架构/目录描述——对 `ls`、`package.json`、`git grep`。
2. **能力/数量**：README 的「N 种模式」、Tab/详情页清单、技术栈版本；`docs/agents/domain.md` 的活文档份数——对实现/依赖/目录。
3. **测试与验证**：`docs/agents/testing.md` 的 mock 清单与四套件矩阵、`AGENTS.md` 的验证入口——对 `vite.config.ts` / `vitest.main.config.ts` / `packages/*/vitest.config.ts` / `scripts/verify.mjs`（根目录没有 `vitest.config.ts`）。
4. **截图与资产**：验收图传 PR、不入库；`docs/**/assets` 只留正文引用的图，孤儿图 `git rm`。README 产品图必须与当前 UI 一致，UI 改了重拍（`e2e/shots-*.mjs`，真 Electron 1440×902，画面无本机路径）。
5. **本轮行为变化**：命令/行为/架构变了，同批更新 `AGENTS.md` / `GLOSSARY.md` / 相关 ADR。
6. **常驻预算**：`AGENTS.md` 只放所有分支都要的内容 + 指针；细节推给 `docs/agents/*` / `GLOSSARY.md` / ADR。
7. **模板描述**：改 `.github/` 模板时，同批改 `AGENTS.md`、`git-workflow.md`、`issue-tracker.md` 里的段/勾选项/标题前缀描述。
