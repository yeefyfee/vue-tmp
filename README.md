# vue3-template

前后端分离的后台管理系统模板（niulai 全家桶本地组合仓库）。

- **前端** `vue3-element-admin` — Vue 3 + Vite + TypeScript + Element Plus
- **后端** `youlai-nest` — NestJS 11 + TypeORM + MySQL + Redis + JWT

---

## 一、项目组成

| 目录 | 角色 | 技术栈 | 默认端口 |
| --- | --- | --- | --- |
| `vue3-element-admin/` | 前端 | Vue 3 / Vite 5 / TypeScript / Element Plus / Pinia / UnoCSS | `3000` |
| `youlai-nest/` | 后端 | NestJS 11 / TypeORM / MySQL 8 / Redis 7 / JWT | `8000` |

### 目录结构

```text
vue3-template/
├─ vue3-element-admin/          # 前端项目
│  ├─ src/api/                  # 接口定义
│  ├─ src/router/               # 路由与守卫
│  ├─ src/stores/               # Pinia 状态
│  ├─ .env.development          # 开发环境变量
│  ├─ .env.production           # 生产环境变量
│  └─ vite.config.ts            # 含 /dev-api 代理配置
├─ youlai-nest/                 # 后端项目
│  ├─ src/                      # 业务源码
│  ├─ sql/mysql/                # 数据库初始化脚本
│  ├─ docker/docker-compose.yml # 本地依赖服务（MySQL/Redis/MinIO）
│  ├─ Dockerfile                # 后端镜像构建
│  ├─ .env                      # 基础环境变量（被优先加载）
│  └─ .env.dev                  # 开发环境变量
└─ README.md
```

---

## 二、环境要求

| 依赖 | 版本要求 | 说明 |
| --- | --- | --- |
| Node.js | 前端 `^20.19.0 \|\| >=22.12.0`；后端 `>=20.17.0` | 建议统一使用 20 LTS 或 22+ |
| pnpm | `>=8.0.0` | **两个项目都强制使用 pnpm**，前端 `preinstall` 有 `only-allow pnpm` 校验 |
| MySQL | 5.7+ / 8.x | 必需 |
| Redis | 7.x | 必需，用于验证码、会话、缓存 |
| MinIO | 可选 | 仅在使用 `OSS_TYPE=minio` 时需要 |

---

## 三、依赖服务准备

后端启动前必须有可用的 **MySQL** 与 **Redis**（否则 TypeORM 连接失败、登录验证码校验失败）。

### 方式 A：使用项目自带的 Docker Compose（推荐首次搭建）

```bash
cd youlai-nest/docker
docker compose up -d
```

会拉起三个容器：

| 服务 | 容器名 | 端口 | 账号 |
| --- | --- | --- | --- |
| MySQL 8.0 | `niulai-nest-mysql` | `3306` | `root` / `root123` |
| Redis 7.2 | `niulai-nest-redis` | `6379` | 密码 `123456` |
| MinIO | `niulai-nest-minio` | `9000`（API）/ `9001`（控制台） | `minioadmin` / `minioadmin` |

> MySQL 首次启动时会自动执行 `sql/mysql/niulai_admin.sql` 完成建库建表（仅当数据目录为空时执行）。
> 若需重新导入，先清空 `docker/mysql/data` 目录。

### 方式 B：复用已有 MySQL / Redis

如果本机已有运行的 MySQL / Redis 实例，可直接使用，无需启动 Compose。此时需保证：

1. `.env.dev` 中的 `MYSQL_*` / `REDIS_*` 与实例实际配置一致；
2. 目标数据库已存在且已导入 `sql/mysql/niulai_admin.sql`。

### ⚠️ 数据库名必须与配置对齐

`sql/mysql/niulai_admin.sql` 脚本内建库名为 **`niulai_admin`**，而 `.env.dev` 中的 `MYSQL_DB` 必须填**实际要使用的库名**，两者不一致会出现「连得上 MySQL 但找不到表」。

`src/config/typeorm.config.ts` 中 `synchronize: false`，**不会自动建表**，务必手工导入 SQL。

> 当前仓库 `.env.dev` 里 `MYSQL_DB=nest_db`。若你改用 Compose 全新搭建（Compose 会建 `niulai_admin` 库），请把它改为 `MYSQL_DB=niulai_admin`；若沿用已存在的 `nest_db` 库则保持不动。

---

## 四、快速启动

### 1. 启动后端（端口 8000）

```bash
cd youlai-nest

# 安装依赖
pnpm install

# 按需修改 .env.dev（MySQL / Redis / JWT / OSS 等）
# 环境变量加载顺序：.env → .env.${NODE_ENV}，NODE_ENV 取自 .env.dev

# 开发模式启动（nest start，带热重载）
pnpm start:dev
```

启动成功后日志会输出：

```
应用已启动: http://localhost:8000
接口文档: http://localhost:8000/api-docs
```

> ⚠️ 日志里的 `/api-docs` 未包含全局前缀，**实际可访问地址是 <http://localhost:8000/api/v1/api-docs>**，
> 因为 `SwaggerModule.setup("api-docs")` 同样受 `setGlobalPrefix("/api/v1")` 影响。

### 2. 启动前端（端口 3000）

```bash
cd vue3-element-admin

# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev
```

访问 <http://localhost:3000> 即可。

### 3. 默认登录账号

| 用户名 | 密码 |
| --- | --- |
| `admin` | `123456` |

---

## 五、前后端联调说明

开发环境下前端通过 Vite 代理访问后端，**不需要配置 CORS**：

```
浏览器 → http://localhost:3000/dev-api/api/v1/xxx
       → Vite 代理（去掉 /dev-api 前缀）
       → http://localhost:8000/api/v1/xxx
```

对应配置在 `vue3-element-admin/vite.config.ts` 的 `server.proxy`：

| 项 | 值 |
| --- | --- |
| 代理前缀 | `VITE_APP_BASE_API` = `/dev-api` |
| 代理目标 | `VITE_APP_API_URL` = `http://localhost:8000` |
| rewrite | 去掉开头的 `/dev-api` |

后端全局路由前缀为 `/api/v1`（`src/main.ts` 中 `setGlobalPrefix`），因此前端所有接口常量均以 `/api/v1` 开头，叠加后路径一致。

### 接口契约

| 项 | 约定 |
| --- | --- |
| 成功码 | `code === "00000"` |
| 响应结构 | `{ code, msg, data }` |
| 分页结构 | `{ list, total }` |
| 鉴权头 | `Authorization: Bearer <accessToken>` |
| Token 失效码 | `A0230` / `A0231` |
| 权限不足码 | `A0301` |
| 接口文档 | <http://localhost:8000/api/v1/api-docs> |

---

## 六、环境变量说明

### 后端 `youlai-nest/.env.dev`

| 变量 | 说明 | 当前值 |
| --- | --- | --- |
| `NODE_ENV` | 运行环境，决定加载 `.env.${NODE_ENV}` | `dev` |
| `APP_PORT` | 服务监听端口 | `8000` |
| `SESSION_TYPE` | 会话模式：`jwt` / `redis-token` | `jwt` |
| `MYSQL_HOST` / `MYSQL_PORT` | MySQL 地址 | `localhost` / `3306` |
| `MYSQL_USER` / `MYSQL_PASSWORD` | MySQL 账号 | `root` / `root123` |
| `MYSQL_DB` | 数据库名（须与实际库一致） | `nest_db` |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_DB` | Redis 地址与库号 | `localhost` / `6379` / `7` |
| `REDIS_PASSWORD` | Redis 密码，无密码留空 | 空 |
| `JWT_SECRET_KEY` | JWT 密钥（HS256 至少 32 字符） | 见文件 |
| `JWT_EXPIRES_IN` | Access Token 有效期（秒） | `7200` |
| `OSS_TYPE` | 存储方式：`aliyun` / `minio` / `local` | `minio` |

> **Redis 密码注意**：本机已有 redis 容器未设密码，故 `REDIS_PASSWORD` 留空；
> 若改用 `docker/docker-compose.yml` 启动，其 Redis 使用 `--requirepass 123456`，需同步改为 `REDIS_PASSWORD=123456`。

### 前端 `vue3-element-admin/.env.development`

| 变量 | 说明 | 值 |
| --- | --- | --- |
| `VITE_APP_PORT` | 开发服务器端口 | `3000` |
| `VITE_APP_BASE_API` | 代理前缀 | `/dev-api` |
| `VITE_APP_API_URL` | 代理目标（后端地址） | `http://localhost:8000` |
| `VITE_MOCK_DEV_SERVER` | 是否启用 Mock | `false` |
| `VITE_APP_TENANT_ENABLED` | 多租户开关 | `false` |

---

## 七、生产部署

### 后端

**方式一：原生部署**

```bash
cd youlai-nest
pnpm install
pnpm build            # 等价 nest build，产物输出到 dist/
pnpm start:prod       # 等价 node dist/main
```

配合 pm2 守护进程：

```bash
pm2 start dist/main.js --name niulai-nest
pm2 save
```

建议生产环境：
- 修改 `.env.prod` 中的数据库地址、密码与 `JWT_SECRET_KEY`；
- 设置 `TYPEORM_LOGGING=false`，避免 SQL 日志过大；
- 用 Nginx 反向代理 8000 端口并配置 HTTPS。

**方式二：Docker 部署**

项目根目录已提供 `Dockerfile`（两阶段构建，最终镜像 `node /app/main.js`，暴露 8000）：

```bash
cd youlai-nest
docker build -t niulai-nest:latest .
docker run -d --name niulai-nest -p 8000:8000 --env-file .env.prod niulai-nest:latest
```

> Dockerfile 在构建阶段会 `COPY .env .`，运行时以 `.env` + `NODE_ENV` 决定的环境文件为准，请确保容器内的配置指向**容器可达**的 MySQL / Redis 地址（不能是 `localhost`）。

### 前端

前端为纯静态资源，无自带 Dockerfile / Nginx 配置，部署流程为构建 + 静态托管：

```bash
cd vue3-element-admin
pnpm install
pnpm build            # 含 vue-tsc 类型检查，产物输出到 dist/
```

将 `dist/` 部署到 Nginx / 对象存储 / CDN 静态目录，并配置反向代理：

```nginx
server {
    listen       80;
    server_name  your-domain.com;

    root  /var/www/vue3-element-admin/dist;
    index index.html;

    # 前端 history 路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 生产环境前缀为 /prod-api（见 .env.production）
    # 需去掉前缀后转发到后端 /api/v1
    location /prod-api/ {
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_pass http://127.0.0.1:8000/;
    }
}
```

> 生产环境的代理前缀由 `.env.production` 的 `VITE_APP_BASE_API=/prod-api` 决定，
> Nginx 中 `proxy_pass` 末尾的 `/` 负责去掉前缀，与开发环境的 Vite `rewrite` 作用相同。

---

## 八、常用命令速查

| 项目 | 命令 | 说明 |
| --- | --- | --- |
| 前端 | `pnpm dev` | 启动开发服务器 |
| 前端 | `pnpm build` | 类型检查 + 生产构建 |
| 前端 | `pnpm preview` | 预览构建产物 |
| 后端 | `pnpm start:dev` | 开发模式（热重载） |
| 后端 | `pnpm build` | 构建到 `dist/` |
| 后端 | `pnpm start:prod` | 运行构建产物 |
| 后端 | `pnpm test` / `pnpm test:e2e` | 单元测试 / 端到端测试 |

---

## 九、注意事项与已知问题

1. **端口冲突**：`docker/docker-compose.yml` 映射了 `3306` / `6379`，若本机已有 MySQL / Redis 占用这些端口，不要重复启动 Compose。
2. **共用数据库实例**：若本机 MySQL / Redis 容器被多个项目共用，请勿随意重建或删除，改用方式 B 复用即可。
3. **前后端必须同时运行**：前端登录依赖后端接口，后端依赖 MySQL 与 Redis，链路上任何一环缺失都会登录失败。
4. **前后端不同步启动时**：前端页面能打开但接口报错，先确认后端 8000 端口是否在监听。
5. 已知遗留问题（不阻断本地运行）：
   - `src/auth/wxma-auth.controller.ts` 前缀重复，实际路径为 `/api/v1/api/v1/wxma/auth`；
   - 后端缺少 `tenants` / `apps` 控制器，前端对应页面需保持 `VITE_APP_TENANT_ENABLED=false`；
   - Swagger 实际路径为 `/api/v1/api-docs`（受全局前缀影响），与部分文档描述不一致。
