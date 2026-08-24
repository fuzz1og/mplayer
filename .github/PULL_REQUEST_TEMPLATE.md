## 变更内容

<!-- 描述本次改动做了什么、为什么。跨端改动（core/desktop/mobile）请说明影响范围 -->

## 关联 issue

<!-- 如有关联，写 Fixes #123 / Closes #456 -->

## 验证

- [ ] `npm run lint` 通过
- [ ] `npm run typecheck` 通过（桌面端）
- [ ] `npx tsc --noEmit --project packages/mobile/tsconfig.json` 通过（移动端）
- [ ] 相关测试通过（`npx vitest run` 等）
- [ ] 改了 `packages/core` → 已 `npm run core:build` 并重跑验证
- [ ] 改了 `packages/mobile` 或 `packages/core` → 已附真机验收结论（机型 / 系统 / 网络环境，流程见 mobile-device-debugging skill）
- [ ] UI 改动 → 已附截图
- [ ] 行为 / 命令 / 架构有变化 → 已同步更新 AGENTS.md / CONTEXT.md / 相关 ADR

## 备注

<!-- 回归风险（涉及哪些来源 netease/qq/kugou/…、哪些端）、本次不做（out-of-scope）、其他需要 reviewer 注意的点 -->
