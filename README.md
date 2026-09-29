# vue3-template

前后端分离的后台管理系统模板（niulai 全家桶本地组合仓库）。

- **前端** `vue3-element-admin` — Vue 3 + Vite + TypeScript + Element Plus
- **后端** `niulai-nest` — NestJS 11 + TypeORM + MySQL + Redis + JWT

---

## 一、项目组成

| 目录 | 角色 | 技术栈 | 默认端口 |
| --- | --- | --- | --- |
| `vue3-element-admin/` | 前端 | Vue 3 / Vite 5 / TypeScript / Element Plus / Pinia / UnoCSS | `3000` |
| `niulai-nest/` | 后端 | NestJS 11 / TypeORM / MySQL 8 / Redis 7 / JWT | `8000` |

### 目录结构

```text
vue3-template/
├─ vue3-element-admin/          # 前端项目
│  ├─ src/api/                  # 接口定义
│  ├─ src/router/               # 路由与守卫
│  ├─ src/stores/               # Pinia 状态
│  ├─ .env.development          # 开发环境变量
│  ├─ .env.production           # 生产环境变量
│  └─ vite.config.ts            # 含 /dev-api 代理配置（仅开发环境生效）
├─ niulai-nest/                 # 后端项目
│  ├─ src/                      # 业务源码
│  ├─ sql/mysql/                # 数据库初始化脚本
│  ├─ docker/docker-compose.yml # 本地依赖服务（MySQL/Redis/MinIO）
│  ├─ Dockerfile                # 后端镜像构建
│  ├─ .env                      # 基础环境变量（被优先加载）
│  └─ .env.dev                  # 开发环境变量
├─ deploy/
│  ├─ nginx.conf                # 裸装 Nginx 生产配置（静态托管 + /prod-api 反代）
│  └─ 1panel.md                 # 1Panel 面板部署指南
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
cd niulai-nest/docker
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
cd niulai-nest

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
浏览器 → http://localhost:3000/prod-api/api/v1/xxx
       → Vite 代理（去掉 /prod-api 前缀）
       → VITE_APP_API_URL 指向的后端 /api/v1/xxx
```

对应配置在 `vue3-element-admin/vite.config.ts` 的 `server.proxy`：

| 项 | 值 |
| --- | --- |
| 代理前缀 | `VITE_APP_BASE_API` = `/prod-api` |
| 代理目标 | `VITE_APP_API_URL` = `https://api.theobuild.top/` |
| rewrite | 去掉开头的 `/prod-api` |

> ⚠️ 该代理**只在 `pnpm dev` 时生效**，`pnpm build` 后产物里不含代理逻辑。
> 生产环境需由 Nginx 承担同样的转发职责，详见 [七、生产部署](#七生产部署)。
> 若要让本地开发连本机后端，把 `.env.development` 改为 `VITE_APP_API_URL=http://localhost:8000` 即可。

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

### 后端 `niulai-nest/.env.dev`

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

### 前端 `vue3-element-admin/.env.development` 与 `.env.production`

两份文件当前配置相同：

| 变量 | 说明 | 当前值 |
| --- | --- | --- |
| `VITE_APP_PORT` | 开发服务器端口（仅 dev 生效） | `3000` |
| `VITE_APP_BASE_API` | 请求前缀，axios 的 `baseURL` 取自它 | `/prod-api` |
| `VITE_APP_API_URL` | 代理目标，**仅 dev 代理使用** | `https://api.theobuild.top/` |
| `VITE_MOCK_DEV_SERVER` | 是否启用 Mock | `false` |
| `VITE_APP_TENANT_ENABLED` | 多租户开关 | `false` |

> ⚠️ **`VITE_APP_API_URL` 对构建产物完全无效**。它在 `src/` 目录中零引用，只被 `vite.config.ts` 的 `server.proxy.target` 使用。
> 构建后 axios 用的是 `VITE_APP_BASE_API`（相对路径 `/prod-api`），生产环境必须由 Nginx 转发，改 `VITE_APP_API_URL` 不会让接口指向后端。

> 本地开发若想连本机后端，把 `.env.development` 改成 `VITE_APP_API_URL=http://localhost:8000` 即可。

---

## 七、生产部署

### 后端

**方式一：原生部署**

```bash
cd niulai-nest
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
cd niulai-nest
docker build -t niulai-nest:latest .
docker run -d --name niulai-nest -p 8000:8000 --env-file .env.prod niulai-nest:latest
```

> Dockerfile 在构建阶段会 `COPY .env .`，运行时以 `.env` + `NODE_ENV` 决定的环境文件为准，请确保容器内的配置指向**容器可达**的 MySQL / Redis 地址（不能是 `localhost`）。

### 前端

前端为纯静态资源，仓库已提供生产环境 Nginx 配置 [`deploy/nginx.conf`](./deploy/nginx.conf)，部署流程为构建 + 静态托管：

```bash
cd vue3-element-admin
pnpm install
pnpm build            # 含 vue-tsc 类型检查，产物输出到 dist/
```

#### ⚠️ 必须先理解：构建后代理会失效

`vite.config.ts` 里的 `server.proxy` **只在 `pnpm dev` 时生效**，`vite build` 不会把它写进产物。
构建后 axios 的实际配置是 `baseURL: "/prod-api"`（相对路径），浏览器会请求**前端站点自己的域名**：

```
https://前端域名/prod-api/api/v1/auth/login   →   服务器无该路由 → 404
```

**因此生产环境必须由 Nginx 承担原来 Vite 代理的角色**，否则前端能打开页面但所有接口都访问不到。

> 另一个常见误区：`.env.production` 里的 `VITE_APP_API_URL` **对构建产物完全无效**。
> 它在 `src/` 目录中零引用，只被 `vite.config.ts` 的 `server.proxy.target` 使用，改它只影响本地开发代理。

#### Nginx 配置

完整配置见仓库根目录 [`deploy/nginx.conf`](./deploy/nginx.conf)，替换其中的域名、证书路径与 dist 目录后放到 `/etc/nginx/conf.d/` 即可：

```bash
nginx -t && nginx -s reload
```

配置里几个不能省的要点：

| 要点 | 说明 |
| --- | --- |
| **剥掉 `/prod-api` 前缀** | 二选一：① `proxy_pass https://api.theobuild.top/;`（靠尾斜杠）② `rewrite ^/prod-api/(.*)$ /$1 break;` + `proxy_pass https://api.theobuild.top;`（显式改写，**不受面板回写影响，推荐**）。漏掉剥前缀会导致后端收到 `/prod-api/api/v1/...` 并返回 `404 C0113 接口不存在` |
| `proxy_ssl_server_name on;` + `proxy_ssl_name` | 后端位于 Cloudflare 之后，反代 HTTPS 上游时**必须发 SNI**，否则 TLS 握手拿不到正确证书 |
| `proxy_set_header Host api.theobuild.top;` | 必须指定，否则 Cloudflare 无法按域名路由到正确源站 |
| `proxy_read_timeout 3600s;` + `proxy_buffering off;` | 兼容 SSE 长连接（`/api/v1/sse/connect`），否则会被 Nginx 60 秒默认超时掐断 |
| `try_files $uri $uri/ /index.html;` | SPA 回退。本项目路由是 **hash 模式**（`createWebHashHistory`），真实地址形如 `/#/system/user`，服务器只会看到 `/`，所以**当前并非必需**；若将来改用 history 模式则必须加 |

> **接口报 `C0113 接口不存在` 说明什么？** 那是**后端**发出的报文（响应带 `x-powered-by: Express`），
> 意味着反代已经生效、请求到达了后端，只是路径里还带着 `/prod-api` —— 即**前缀没被剥掉**，
> 或你的改动没生效到运行中的配置。若反代规则压根没命中，看到的会是一段 HTML（openresty 404 或 SPA 兜底），
> 而不是这段 JSON。判别命令：`curl -i https://你的域名/prod-api/__notexist__`
>
> 判断运行中的配置到底长什么样（**不用登录服务器**）：请求一个只可能被「前缀匹配」吃掉的路径
> `https://你的域名/prod-apixyz` —— 若它**也返回后端 JSON**，说明生效的是
> `location ^~ /prod-api`（**无尾斜杠**）+ 不带 URI 的 `proxy_pass`，即前缀不会被剥掉。

> 若前端与后端部署在**同一台服务器**，把 `proxy_pass` 改成 `http://127.0.0.1:8000/` 即可：
> 直连源站更快，且不受 Cloudflare 100 秒连接超时限制。

> 前端站点必须部署在**域名根路径**：`dist/index.html` 引用的是绝对路径 `/js/...`、`/css/...`，
> 放到子目录（如 `/admin/`）会资源 404 导致白屏。

#### 使用 1Panel 面板部署

若服务器使用 **1Panel** 面板（其 Web 服务基于 OpenResty，且**运行在 Docker 容器中**），操作方式与裸装 Nginx 有明显差异。
完整图文步骤见 [`deploy/1panel.md`](./deploy/1panel.md)。

最容易踩的几个坑，以及确认配置是否真的生效：

- **建站类型要选「静态网站」**，不要选「反向代理」——后者生成的 `location ^~ /` 会把前端页面请求也转发给后端，静态站点直接失效；
- **1Panel 生成的反代配置默认是 `proxy_ssl_server_name off`**，而本项目后端位于 Cloudflare 之后，**必须手工改成 `on` 并指定 `proxy_ssl_name api.theobuild.top`**，否则反代 HTTPS 上游会握手失败，表现为 502；
- **别靠手补 `proxy_pass` 的尾斜杠**——在面板「反向代理」表单里点保存会按字段重新生成配置，手补的斜杠会被覆盖掉。改用 `rewrite ^/prod-api/(.*)$ /$1 break;` + 不带尾斜杠的 `proxy_pass`，从根上免疫。
- 排查运行中配置是否真的生效（OpenResty 在容器里，改完必须重载）：
  ```bash
  NAME=$(docker ps --format '{{.Names}}' | grep -i openresty | head -n1)
  docker exec "$NAME" nginx -T | grep -B4 -A16 'prod-api'   # 看最终合并后的真实配置
  docker exec "$NAME" nginx -t                              # 看有无语法错误/重复 location
  ```

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
5. **生产环境接口全部 404（最常见问题）**：根因是 `vite build` 不会把 `server.proxy` 写进产物。
   排查顺序：① 浏览器 F12 看请求实际打到了哪个域名（应该是前端站点域名 + `/prod-api`）；
   ② 确认 Nginx 有 `location /prod-api/` 且**前缀被剥掉**（`proxy_pass .../;` 或 `rewrite ^/prod-api/(.*)$ /$1 break;`）；
   ③ 直接访问 `https://api.theobuild.top/api/v1/auth/captcha` 确认后端本身可用（正常返回 `code=00000`）。
6. **接口返回 502 / 504**：此时故障在**后端**，不在前端或 Nginx。
   区分：**502** = Nginx 连不上上游（进程没起/端口错/未发 SNI）；**504** = 连上了但等不到响应（后端进程卡死，常见于数据库/Redis 连不上）。
   最快的定位方法是**绕过 Nginx 直连后端**：`curl -i -m 5 http://127.0.0.1:8000/api/v1/auth/captcha` ——
   卡住即后端卡死，200 则是 Nginx 的 upstream 指向写错了。详见 [`deploy/1panel.md`](./deploy/1panel.md) 第十节。
7. **接口返回 521 / 522（错误页由 Cloudflare 给出）**：**请求根本没到你的服务器**。
   521 = 源站拒绝连接（整机宕机 / Web 服务停了 / 443 未放行）；522 = 源站 TCP 握手超时。
   与 Nginx 配置、前端代码完全无关，**不要再去改反代配置**，直接查源站整机状态。
   外部快速判定：TCP 与 TLS 握手都成功、但 HTTP 请求**零响应字节** → 源站已不可达。
   注意 **504 → 521 是同一次事故的两个阶段**（后端应用卡死 → 恶化到整机/服务不可达），
   回头看 `free -m`、`df -h`、`dmesg -T | grep -i oom`。
8. 已知遗留问题（不阻断本地运行）：
   - `src/auth/wxma-auth.controller.ts` 前缀重复，实际路径为 `/api/v1/api/v1/wxma/auth`；
   - 后端缺少 `tenants` / `apps` 控制器，前端对应页面需保持 `VITE_APP_TENANT_ENABLED=false`；
   - Swagger 实际路径为 `/api/v1/api-docs`（受全局前缀影响），与部分文档描述不一致。
