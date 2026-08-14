# Security Policy

## Reporting a Vulnerability

发现安全漏洞时，**请不要创建公开 issue**。

请使用 GitHub 的私有漏洞报告功能（仓库页面 → **Security** → **Report a vulnerability**），或在 issue 中仅提及「有安全相关问题」并等待维护者私聊。

报告时请包含：

- 受影响的版本与平台（桌面端 / 移动端）
- 复现步骤
- 影响描述（如涉及敏感数据，请说明）

## Supported Versions

| 版本 | 支持 |
|------|------|
| 最新 release（master 分支） | ✅ |
| 更早版本 | ❌ 仅接受安全建议，不再修复 |

## 安全惯例

- API URL 等敏感配置只放在 `.env.local`（已 gitignore），不要提交到仓库。
- 依赖安全由 Dependabot（npm / GitHub Actions）+ 每周 `npm audit` 工作流覆盖。
