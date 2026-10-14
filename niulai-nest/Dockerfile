# ==============================================================================
# PeluVida OS 后端（NestJS）生产镜像 —— 仓库根上下文版（CROSS-20 monorepo 适配）
# ------------------------------------------------------------------------------
# 构建（⚠️ 上下文是仓库根，不再是 niulai-nest/）：
#   docker build -f niulai-nest/Dockerfile -t peluvida-nest:latest .
# 启动：
#   docker compose -f docker/docker-compose.yml up -d（依赖服务）
#   docker run --env-file niulai-nest/.env.prod -p 8000:8000 peluvida-nest:latest
#
# 设计要点：
#   1. monorepo 化（CROSS-01/08）后 pnpm 依赖安装必须以仓库根为上下文：
#      根锁文件（pnpm-lock.yaml）+ pnpm-workspace.yaml + 全部 workspace 成员的
#      package.json 缺一不可；schema 也唯一存放于 packages/db/prisma（CROSS-08）。
#   2. 生产依赖用 `pnpm deploy --prod --legacy` 输出为自包含实树（无 symlink），
#      避免 pnpm 的 .pnpm 相对链接在镜像 COPY 后断裂。
#   3. prisma generate 通过 niulai-nest/prisma.config.ts 定位 packages/db 的
#      schema（generate 不连库，DATABASE_URL 缺失时兜底构造不抛错）。
#   4. bcrypt 6.x 使用 prebuildify，运行时镜像不需要编译工具链。
#   5. .env.prod 不打进镜像，由 compose 的 env_file / docker run --env-file 注入。
# ==============================================================================

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------- 1) 依赖安装（根 workspace + shared 构建，postinstall 自动跑） ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /repo
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com
RUN npm i -g pnpm@11.17.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY scripts/ ./scripts/
COPY packages/ ./packages/
COPY niulai-nest/package.json ./niulai-nest/package.json
COPY vue3-element-admin/package.json ./vue3-element-admin/package.json
RUN pnpm install --frozen-lockfile

# ---------- 2) 构建（prisma generate → nest build → dist/） ----------
FROM deps AS build
COPY niulai-nest/ ./niulai-nest/
RUN pnpm --filter niulai-nest exec prisma generate \
 && pnpm --filter niulai-nest run build

# ---------- 3) 生产运行层：完整还原 /repo 布局 ----------
# 说明：曾尝试 pnpm deploy --prod 裁剪，但 deploy 只按 lockfile 拷实体包、
# 不含 prisma generate 生成物（.prisma/client），且在 .pnpm 嵌套布局下产物
# 落点与运行时解析链对齐困难——镜像会偏大，正确性优先；瘦身是后续优化项。
# pnpm workspace 的 require 解析依赖「子包 node_modules 链接层 + 根 .pnpm」，
# runner 保持 /repo 原始路径结构（cwd = /repo/niulai-nest，与宿主机一致）。
FROM ${NODE_IMAGE} AS runner
WORKDIR /repo/niulai-nest
ENV NODE_ENV=prod \
    TZ=Asia/Shanghai \
    APP_PORT=8000
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata ca-certificates \
 && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
 && echo "$TZ" > /etc/timezone \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /repo/node_modules /repo/node_modules
COPY --from=build /repo/packages /repo/packages
COPY --from=build /repo/niulai-nest/node_modules /repo/niulai-nest/node_modules
COPY --from=build /repo/niulai-nest/package.json /repo/niulai-nest/package.json
COPY --from=build /repo/niulai-nest/dist /repo/niulai-nest/dist
COPY --from=build /repo/niulai-nest/src/codegen/templates /repo/niulai-nest/src/codegen/templates
COPY niulai-nest/.env /repo/niulai-nest/.env

# ⚠️ 代码生成器的 Velocity 模板必须单独复制（nest build 不编译 .vm，漏掉会
#    生产报 Codegen template not found，本地 dev 能跑）
RUN mkdir -p /repo/niulai-nest/logs
EXPOSE 8000

# 健康检查：验证码接口无需鉴权，适合做存活探针（Node 22 自带 fetch）
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.APP_PORT||8000)+'/api/v1/auth/captcha').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 等价于 package.json 的 start:prod（node dist/main）
CMD ["node", "dist/main.js"]
