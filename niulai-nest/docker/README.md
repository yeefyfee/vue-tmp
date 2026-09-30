# Docker 环境说明

本目录下有**一个** compose 文件（本地开发用），项目的生产部署文件在**上一级目录**。
**已经有数据库**的场景有专门的文件，别用错：

| 文件 | 用途 | 包含内容 |
|------|------|----------|
| `docker/docker-compose.yml`（本文件） | **本地开发**时起依赖服务 | 仅 MySQL / Redis / MinIO，**不含应用** |
| `../docker-compose.prod.yml` | **服务器生产部署**（从零开始，无任何数据库） | app（Nest 应用）+ MySQL + Redis + MinIO |
| `../docker-compose.app-only.yml` | **服务器已有 MySQL / Redis / 云数据库**时 | 仅 app，复用外部数据库，**不建库、不导入 SQL** |

怎么选：

- **从零部署一台新服务器** → `docker-compose.prod.yml`
- **数据库已经存在（有数据 / 别的项目在用 / 云 RDS）** → `docker-compose.app-only.yml`
  （那三个初始化 SQL 含 24 条 `DROP TABLE`，对已有数据的库执行会清空 24 张表，务必先看注释）
- **库里只缺几张表** → 仍用 `app-only` 起应用，再手工导入缺的那一个脚本，导入前先备份

生产部署请看 [`../docker-compose.prod.yml`](../docker-compose.prod.yml) 与
[`../docker-compose.app-only.yml`](../docker-compose.app-only.yml)，
或根目录 [README.md](../../README.md) 的「七、生产部署 → 后端 → Docker 部署」。

---

## 快速启动（本地开发）

在 docker 目录下执行：

```bash
docker compose up -d
```

后端使用 MySQL + TypeORM + Redis + MinIO，不使用 MongoDB。

## 服务说明

| 服务 | 端口 | 说明 |
|------|------|------|
| MySQL | 3306 | 主数据库，首次启动自动导入 `../sql/mysql/niulai_admin.sql` |
| Redis | 6379 | 缓存服务（验证码、会话等） |
| MinIO | 9000/9001 | 对象存储（9000: API, 9001: 控制台） |

## 默认账号

### MySQL
- 用户：`root`
- 密码：`root123`
- 数据库：`niulai_admin`

### Redis
- 密码：`123456`

### MinIO
- 用户名：`minioadmin`
- 密码：`minioadmin`

以上账号需与 `../.env.dev` 中的 `MYSQL_*` / `REDIS_PASSWORD` / `OSS_MINIO_*` 保持一致。

## 目录结构

```
docker/
├── docker-compose.yml
├── README.md
├── mysql/
│   └── data/          # MySQL 数据（自动生成）
├── redis/
│   └── data/          # Redis 数据（自动生成）
└── minio/
    ├── data/          # MinIO 数据（自动生成）
    └── config/        # MinIO 配置（自动生成）
```

## 注意事项

- 数据目录已添加到 .gitignore，不会提交到 Git
- 生产环境请修改默认密码
- 若需重新导入初始化 SQL，需先清空 `mysql/data` 目录（初始化脚本仅在数据目录为空时执行）
- **MySQL 映射 3306、Redis 映射 6379，若本机已存在占用同名端口的容器（例如手工创建的 `mysql` / `redis`），
  两者不可同时启动**。应先确认端口占用情况，二选一使用：
  ```bash
  docker ps --format '{{.Names}} | {{.Ports}}'
  ```

