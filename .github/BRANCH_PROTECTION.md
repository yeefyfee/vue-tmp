# PeluVida OS 分支保护配置说明（CROSS-04）

目标：**PR ≥1 人审批 + CI 全绿方可合并；支付 / 权限 / 多租户改动需 2 人审批**。

CI 必过检查（来自 `.github/workflows/ci.yml`，job 名 `verify`）：
Lint → Typecheck → Unit Test → Build → 构建产物完整性。

## 一、GitHub 网页配置（Settings → Branches → Add branch protection rule）

| 配置项                                    | 值     | 说明                                                           |
| ----------------------------------------- | ------ | -------------------------------------------------------------- |
| Branch name pattern                       | `main` | 保护主分支                                                     |
| Require a pull request before merging     | ✅     | 禁止直推 main                                                  |
| Required approving reviews                | `1`    | 单人团队基线；扩员后支付/权限/多租户由 CODEOWNERS + 2 审批约束 |
| Require review from Code Owners           | ✅     | 启用 CODEOWNERS 路径审查                                       |
| Require status checks to pass             | ✅     | 勾选 `Lint / Typecheck / Test / Build`（verify job）           |
| Require branches to be up to date         | ✅     | 合并前必须 rebase 最新 main                                    |
| Do not allow bypassing the above settings | ✅     | 管理员也受约束（可按需放开）                                   |

> 支付 / 权限 / 多租户「2 人审批」：仓库扩员后，把 `required_approving_review_count`
> 调整为 `2` 并保持 `require_code_owner_reviews: true`——CODEOWNERS 已将上述
> 高敏路径指向双人 owner（见 `.github/CODEOWNERS`）。单人阶段维持 1 审批 + CI 全绿。

## 二、gh CLI 一键配置（管理员执行）

```bash
gh api repos/:owner/:repo/branches/main/protection -X PUT \
  -H "Accept: application/vnd.github+json" \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Lint / Typecheck / Test / Build"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
EOF
```

status check 的 `contexts` 必须与 ci.yml 中 job 的 `name` 完全一致
（`Lint / Typecheck / Test / Build`）。

## 三、配套约定

1. **commitlint**：`.husky/commit-msg` 本地拦截 + 分支保护兜底（CI 可加 commit-lint job，暂由本地钩子承担）。
2. **PR 分支存活 ≤5 工作日**：属 CI 红线自动化范畴（CROSS-05 R 系列规则），用 GitHub Actions 定时任务（`schedule` cron）扫描 stale PR 并标记/关闭，在 CROSS-05 实现。
3. **合并策略**：建议 Squash merge，保持 main 历史为 Conventional Commits 单线。

## 四、验收清单

- [ ] 任一 PR 自动触发 ci.yml，四道关口全绿方可合并
- [ ] 直推 main 被 GitHub 拒绝
- [ ] CODEOWNERS 路径的 PR 显示 owner review 要求
- [ ] 扩员后：支付/权限/多租户 PR 要求 2 个 approval（含 owner）
