# @peluvida/api-contract

PeluVida OS 的 REST API 契约包（OpenAPI 3.1，**契约先行**）。

## 定位

三端（Web / 员工端 / 宠主端）与后端共同遵守的唯一接口基线。契约存于本包，
由 CI 校验，实现代码跟随契约演进 —— 而不是反过来。

## 已锁定的口径（决策 A4 / Q5 / Q6 / Q7）

| 项       | 口径                                                            |
| -------- | --------------------------------------------------------------- |
| 端点前缀 | `/api/v1`                                                       |
| 外层响应 | `code` / `msg` / `data`（保持存量前端零回归）                   |
| 列表信封 | `list` / `total` / `page` / `page_size`                         |
| 分页参数 | `page`（默认 1）/ `page_size`（默认 20，上限 100）              |
| 金额     | 一律为**整数「分」**                                            |
| 错误码   | `域_对象_原因`（如 `BOOKING_SLOT_CONFLICT`）                    |
| 多租户   | `tenant_id` 由令牌解析，**不接受参数传递**；门店用 `X-Store-Id` |
| 幂等     | POST 与支付类接口必须带 `Idempotency-Key`                       |

## 当前状态

Phase -1 落地的**契约骨架**：统一结构与代表性端点（`/auth/*`、`/pets`、`/pets/{petId}/timeline`）已就位。
各业务域的完整端点随 Phase 0 / MVP 各模块任务逐步补齐（完整端点清单见开发清单 07 章）。

## 工具链（CROSS-15）

| 脚本                          | 作用                                                                                                                                                         | 运行                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `scripts/validate.mjs`        | 契约结构校验：口径（信封/分页/前缀/金额注释）与 `$ref` 可达性，零依赖                                                                                        | `node packages/api-contract/scripts/validate.mjs`         |
| `scripts/export-openapi.ts`   | **实现 → 快照**：经 NestFactory 全量拉起后端 AppModule 导出 Swagger 文档，统一信封后处理 + 稳定排序后写入 `openapi.export.json`（快照必须提交）              | `pnpm -C niulai-nest contract:export`（需 PG/Redis 连通） |
| `scripts/check-impl-sync.mjs` | **快照 ↔ 契约**一致性：快照存在且全带 `/api/v1` 前缀、JSON 响应均为统一信封、列表端点带 `page/page_size`、契约已实现路径方法集合一致（契约先行待实现仅计数） | `node packages/api-contract/scripts/check-impl-sync.mjs`  |
| `scripts/mock-server.mjs`     | 契约 Mock：按 `openapi.yaml` 路径零依赖起 HTTP 服务，返回形状正确的信封 Mock 数据                                                                            | `pnpm -C packages/api-contract mock`（`:4100`）           |

Mock 服务要点：

- `GET /__contract`：查看契约路径清单（路径 + 方法）；
- 任意路径 + `?__status=500`：模拟错误响应（信封形态，`code: MOCK_FORCED_ERROR`）；
- 路径参数形如 `/pets/{petId}/timeline`，用真实值占位即可（如 `/pets/1/timeline`）。

## CI 接线（.github/workflows/ci.yml）

Contract 关口在 Build 之后执行四步：

1. `validate.mjs` —— 契约结构合法；
2. `pnpm --filter niulai-nest contract:export` —— 从实现重新导出快照（job 级 postgres:16 + redis:7 service 支撑 AppModule 拉起）；
3. `git diff --exit-code packages/api-contract/openapi.export.json` —— 提交的快照与实现不同步即红灯（提示重新导出并提交）；
4. `check-impl-sync.mjs` —— 口径与契约比对。

## 日常流程

1. **契约先行**：改 `openapi.yaml` → `validate.mjs` 通过；
2. **实现跟随**：写后端接口 → `contract:export` 更新快照并**随代码一起提交**；
3. **一致性**：`check-impl-sync.mjs` 通过（契约先行待实现的路径会列在 note 里，属正常状态）；
4. CI 全绿 = 契约、快照、实现三者同步。

### 已知契约偏差（待对齐）

- 契约 `/auth/refresh` vs 实现 `/auth/refresh-token`（命名不一致，需在契约侧或实现侧二选一对齐）；
- ~~契约 `/auth/me` 当前实现未提供~~ → **已对齐（P0-02-06）**：`GET /auth/me` 已实现，
  等价复用 `/users/me` 的 `UserService.findMe`；同批新增 `GET /auth/organizations`
  （当前租户可切换门店列表）与 `POST /auth/switch-context`（切换门店上下文，返回内嵌
  `activeStoreId` 的新 access token）。
