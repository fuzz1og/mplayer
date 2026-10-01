<!-- 预算：≤ 40 行 / ≤ 1500 字。CI 已证明的（lint / typecheck / 四个测试 / core:build / build）不要抄。
     发帖前删掉本文件里的所有 HTML 注释。
     正文由发起 PR 的 agent / 人填写；作者对所有提交内容负责，reviewer 问起要能解释。
     段名与 `pr` skill 同形：Summary / Evidence / Merge Danger。 -->

## Summary

<!-- 最小的能说清重点的视图 + 1–3 行结论（改了什么 + 谁看到什么变化），先给结论。
     视图任选其一，别堆：diff / 调用树 / 组件树 / 文件树 / mermaid / 伪代码。
     争议点 / 高风险点 / 需要人判断的地方写在本段（1–3 条），没有就不写。
     要关 issue：单独起一段写一行 Closes #123（前后留空行；别粘在中文标点后面，别用 Refs 代替 Closes）。
     深挖链接（ADR / issue / 设计文档）放本段末尾，只链接、不复述。 -->

## Evidence

<!-- 只写「跑什么命令 / 点了哪里，看到什么现象」，给 Before / After；CI 已证明的不要抄。
     UI 与真机改动必须附图：`gh pr edit <PR> --attach '<png>#<图注>'`（图不入库）；没上真机写「未做 + 原因」。
     取舍与排查过程写进 ADR / issue 评论，这里只链接。 -->

- **Before:**
  **After:**
- [ ] 真机 / UI 有可视证据 → 已附图（或「未做 + 一句原因」）
- [ ] 行为 / 命令 / 架构有变化 → 已同步 `AGENTS.md` / `GLOSSARY.md` / 相关 ADR

## Merge Danger

<!-- Door: one-way（走不回去：破坏性操作 / 难撤销的决策）还是 two-way（能走回去）。
     Blast Radius: 一个词概括影响面（layout shift / 消费端破坏 / 移动端适配 …）。
     没有风险也要写：two-way + 一个词，不要空着。 -->
