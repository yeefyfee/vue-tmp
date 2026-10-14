import { registerAs } from "@nestjs/config";

/**
 * 数据库配置（PostgreSQL 16 + Prisma，A1 决策）
 *
 * 与 Prisma CLI 的配置源保持一致：优先用 DATABASE_URL，
 * 缺失时再由 PG_* 拼装，避免「CLI 连 A 库、应用连 B 库」。
 */
export default registerAs("database", () => {
  const required = (envKey: string, label: string) => {
    const value = process.env[envKey];
    if (!value) {
      throw new Error(`[Database Config] 环境变量 ${envKey}(${label}) 未配置，请检查 .env 文件`);
    }
    return value;
  };

  const host = required("PG_HOST", "数据库主机");
  const port = required("PG_PORT", "数据库端口");
  const user = required("PG_USER", "数据库账号");
  const password = required("PG_PASSWORD", "数据库密码");
  const database = required("PG_DB", "数据库名称");

  return {
    host,
    port: Number(port),
    user,
    password,
    database,
    logging: process.env.DATABASE_LOGGING === "false" ? false : true,
    // Prisma 7 起，客户端经 driver adapter 连接，统一使用连接串
    url:
      process.env.DATABASE_URL ??
      `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${database}`,
  };
});
