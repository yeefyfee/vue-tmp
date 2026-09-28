# Docker 环境说明

## 快速启动

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

