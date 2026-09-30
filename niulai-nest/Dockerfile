# ==============================================================================
# 牛来后台管理系统（NestJS）生产镜像
# ------------------------------------------------------------------------------
# 构建：  docker build -t niulai-nest:latest .
# 启动：  docker compose -f docker-compose.prod.yml up -d --build
#
# 设计要点：
#   1. 加载哪个 env 文件由 NODE_ENV 决定（见 src/app.module.ts:48）
#          envPath = `.env.${process.env.NODE_ENV || "dev"}`
#      → 生产必须传 NODE_ENV=prod，否则应用会去找 .env.dev
#   2. .env.prod 含数据库密码 / JWT 密钥，**不打进镜像**，由 compose 的 env_file 注入；
#      镜像内只保留非敏感的 .env（仅含 APP_PORT）
#   3. bcrypt 6.x 使用 prebuildify，各平台（含 linux-x64 的 glibc / musl）预编译二进制
#      已内置在 npm 包内，因此运行时镜像**不需要**编译工具链
#   4. 分四个阶段：装依赖 → 构建 → 裁剪为生产依赖 → 运行镜像
#      锁文件为 pnpm 9.0 格式，实测 pnpm 11.17.0 可冻结安装且不改写锁文件
# ==============================================================================

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------- 1) 安装依赖（含 devDependencies，构建阶段需要） ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
RUN npm i -g pnpm@11.17.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- 2) 构建（nest build → dist/） ----------
FROM deps AS build
COPY . .
RUN pnpm run build

# ---------- 3) 裁剪为仅生产依赖 ----------
FROM deps AS prod-deps
RUN rm -rf /app/node_modules && pnpm install --prod --frozen-lockfile

# ---------- 4) 运行镜像 ----------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=prod \
    TZ=Asia/Shanghai \
    APP_PORT=8000
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata ca-certificates \
 && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
 && echo "$TZ" > /etc/timezone \
 && rm -rf /var/lib/apt/lists/*

COPY --from=deps      /app/package.json ./package.json
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build     /app/dist         ./dist
COPY .env ./.env

# ⚠️ 代码生成器的 Velocity 模板必须单独复制
#    resolveBootTemplatePath 按 <cwd>/src/codegen/templates 解析
#    （src/codegen/codegen.service.ts:704），而 nest build 只编译 .ts，
#    .vm 不会进 dist —— 漏掉这行的后果是「代码生成」功能报
#    Codegen template not found（本地 dev 能跑、生产报错）
COPY --from=build /app/src/codegen/templates ./src/codegen/templates

RUN mkdir -p logs
EXPOSE 8000

# 健康检查：验证码接口无需鉴权，适合做存活探针（Node 22 自带 fetch）
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.APP_PORT||8000)+'/api/v1/auth/captcha').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 等价于 package.json 的 start:prod（node dist/main）
CMD ["node", "dist/main.js"]
