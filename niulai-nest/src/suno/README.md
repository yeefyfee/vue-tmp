# Suno 音乐模块

对接 [Suno 开放平台](https://open.suno.cn/api-guide)，把 AI 音乐生成能力集成到本后台，
并以**独立权限 + 独立账号**的方式隔离展示。

## 一、整体架构

```
┌──────────────┐      /api/v1/suno/*       ┌──────────────┐   Bearer access_key   ┌──────────────────┐
│  Vue 前端     │ ────────────────────────► │  Nest 后端    │ ────────────────────► │ open.suno.cn     │
│  views/suno  │ ◄──────────────────────── │  src/suno    │ ◄──────────────────── │ /api/v1          │
└──────────────┘      统一响应壳解析          └──────────────┘     代理转发 + 落库     └──────────────────┘
```

**密钥不入前端**：`access_key` 存于 `suno_config` 表，仅后端读取并注入 `Authorization` 头，
前端只能看到掩码（`abcd********wxyz`）。这样可以做权限校验、积分核算与调用审计。

## 二、账号与权限隔离（核心需求）

方案：**独立角色 + 专属菜单**，不新建独立布局，复用现有权限体系。

| 项 | 值 |
| --- | --- |
| 角色编码 | `SUNO` |
| 账号 | `suno` / `123456`（登录后请立即改密） |
| 数据权限 | `4`（仅本人数据） |

隔离原理：SUNO 角色在 `sys_role_menu` 中**只绑定 Suno 目录及其子节点**，
因此该账号登录后，`getRoutes()` 只会返回 Suno 菜单 —— 侧边栏只有创作台/任务中心/我的作品/接入配置，
完全看不到系统管理。超级管理员（ROOT / userId=1）按既有逻辑仍可见全部菜单。

> 路由同时以常量路由兜底（`src/router/index.ts`），保证后端菜单尚未初始化时功能也能直接访问。

## 三、功能清单

| 页面 | 路径 | 能力 |
| --- | --- | --- |
| 创作台 | `/suno/studio` | 灵感模式 / 自定义歌词 / 延长 / 翻唱 / 音效 / 上传参考；积分与任务概览 |
| 任务中心 | `/suno/task` | 任务分页、单查 + 批量查、**自动轮询（10s）**、失败原因、已退积分 |
| 我的作品 | `/suno/asset` | 卡片/列表双视图、在线播放、下载、收藏、**9 项后期处理** |
| 接入配置 | `/suno/config` | 密钥维护（脱敏）、接口地址、连接测试、积分与本地流水 |

### 后期处理（9 个接口）

合成整首歌、Remaster 升采样、转 WAV/MP3/M4A、裁剪、变速、歌词时间戳对齐、生成 MV。

## 四、数据库设计

脚本：`sql/mysql/suno_module.sql`

| 表 | 作用 | 关键索引 |
| --- | --- | --- |
| `suno_config` | 接入配置（密钥密文） | `uk_config_key` |
| `suno_task` | 任务明细（1 次提交 → 2 条，共享 `batch_no`） | `uk_task_id`、`idx_owner_status`、`idx_batch` |
| `suno_asset` | 作品资产（任务完成落库） | `uk_owner_custom`、`idx_owner` |
| `suno_points_log` | 积分流水（成本核算） | `idx_owner` |

设计要点：

1. **task_id 与 custom_id 分离**：`task_id`（数字）用于轮询，`custom_id`（UUID）用于延长/翻唱/后期。两者都在任务表留存。
2. **一次提交两条记录**：Suno 每次产出 2 个版本，用 `batch_no` 归组，前端可一次轮询两个版本。
3. **幂等落库**：作品以 `(owner_id, custom_id)` 唯一，重复轮询不会产生脏数据。
4. **数据隔离边界**：任务与作品全部带 `owner_id`，所有查询强制按当前登录用户过滤。

## 五、部署步骤

### 1. 后端

```bash
cd niulai-nest
# 执行建表脚本（会创建 4 张表 + 角色/账号/菜单/字典）
mysql -u<user> -p <db> < sql/mysql/suno_module.sql
pnpm start:dev
```

模块已在 `src/app.module.ts` 注册，无需额外配置。TypeORM 建议开启 `synchronize: false`，
表结构以 SQL 脚本为准。

### 2. 前端

```bash
cd vue3-element-admin
pnpm dev
```

### 3. 配置密钥

用管理员登录 → 进入「Suno 音乐 / 接入配置」→ 填入商户后台创建的 access_key → 保存 → 点「测试连接」。

### 4. 验证隔离

用 `suno / 123456` 登录，侧边栏应只出现 Suno 四个菜单。

## 六、接口对照

| 前端调用 | 后端路径 | 说明 |
| --- | --- | --- |
| `generateMusic` | `POST /api/v1/suno/music/generate` | 灵感/自定义/延长/翻唱 |
| `generateSound` | `POST /api/v1/suno/music/sound` | 音效 |
| `uploadMusic` | `POST /api/v1/suno/music/upload` | 上传参考 |
| `queryTask` / `queryTasks` | `GET /api/v1/suno/task`、`/tasks` | 单查 / 批量查 |
| `getTaskPage` | `GET /api/v1/suno/task/page` | 任务分页 |
| `getAssetPage` | `GET /api/v1/suno/asset/page` | 作品分页 |
| `postProcess` | `POST /api/v1/suno/post/:action` | 后期处理统一入口 |
| `getBalance` | `GET /api/v1/suno/points/balance` | 平台积分 |

权限标识：`suno:studio:use`、`suno:music:generate`、`suno:sound:generate`、`suno:music:upload`、
`suno:task:list`、`suno:task:query`、`suno:task:delete`、`suno:asset:list`、`suno:asset:post`、
`suno:asset:like`、`suno:asset:delete`、`suno:config:update`。

## 七、注意事项

- Suno 生成是**异步**的：提交只拿到 `task_id`，需轮询。任务中心的「自动轮询」开关每 10 秒刷新一次进行中的任务。
- 任务失败时平台**自动退还积分**，`points_refunded=true` 会在任务列表标记「已退积分」。
- 平台限流返回 429，后端已统一提示「请求过于频繁」，前端应避免高频手动查询。
- `extend` 字段是 JSON 字符串，后端已 `JSON.parse` 后提取歌词落库。
- 模型版本：`chirp-hawk`(V6) / `chirp-hawk-wild`(V6-wild) / `chirp-goose`(V6-mini)；音效用 `chirp-crow` / `chirp-fenix`。
