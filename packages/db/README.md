# @peluvida/db — Prisma schema 唯一存放地（CROSS-08）

PeluVida OS 的数据层包：**schema 基线 + 迁移历史**唯一定位于本包，禁止在任何工程内出现第二份 `schema.prisma`。

## 布局

```
packages/db/
├── package.json            # 工具链声明（prisma ^7.10.0，与 niulai-nest 钉同一版本）
├── README.md
└── prisma/
    ├── schema.prisma       # 唯一 schema：14 张移植基线表 + 业务域新表公共字段口径（文件头注释）
    └── migrations/         # 迁移历史（随 PEL-10 基线一并归位）
        ├── 20261004070549_init_peluvida_baseline/
        ├── 20261005090000_tenant_rls_baseline/   # RLS 策略模板留 CROSS-09 填充
        └── migration_lock.toml
```

## 工具链入口（重要）

Prisma 7 的连接串 / 环境变量加载在 **`niulai-nest/prisma.config.ts`**（对齐 Nest ConfigModule 的
`.env` 加载顺序），schema / migrations 路径已指向本包。因此 **CLI 一律从 `niulai-nest` 发起**：

```bash
cd niulai-nest
pnpm prisma:generate   # 生成 client（产物照旧进 niulai-nest 的 @prisma/client，业务代码 import 零改动）
pnpm prisma:migrate    # migrate dev（需本地 PG，连接串取自 niulai-nest/.env）
pnpm prisma:deploy     # migrate deploy
pnpm prisma:studio
```

本包内的 `prisma` devDep 仅为工具链归属声明（pnpm 同版本去重，不产生第二份引擎下载）；
A3 物理迁移（apps/* + server/*）时再把 CLI 入口正式迁入本包。

## 建模口径（强制）

1. **双口径并存**（详见 `prisma/schema.prisma` 头注释）：
   - 系统管理域 14 表（`sys_*` / `gen_*`）：PEL-10 移植基线，旧公共字段口径，**已冻结**；
   - 业务域新表：`id(uuid)` / `tenant_id` / `store_id` / `created_at` / `updated_at` /
     `created_by` / `updated_by` / `deleted_at` / `version`，uuid 由库层 `gen_random_uuid()` 生成。
2. **金额一律 BigInt「分」**（`@db.BigInt`），禁用 Float / Decimal（A1 / Q6）。
3. **DB 列名 snake_case**，经 `@map` / `@@map` 映射；API 层同样 snake_case。
4. **禁用数据库外键与物理级联删除**（与移植基线一致，跨表一致性由业务层保证）。
5. 逻辑删除：新表用 `deleted_at`（NULL=未删）；存量表 `is_deleted` 由业务层显式过滤。

## 红线关联

- 改动本包内任何文件 → CI 红线 **R05（擅改数据模型）WARN**，须在任务单中声明变更理由；
- RLS 策略填充属于 CROSS-09，不在业务任务中顺手修改 `tenant_rls_baseline` 迁移。
