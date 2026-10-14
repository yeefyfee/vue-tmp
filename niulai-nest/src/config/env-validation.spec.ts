import { validateEnv } from "./env.validation";

/**
 * CROSS-06 启动期环境变量校验单测
 * 重点覆盖：缺失汇总（一次性列出全部问题）、枚举、数字格式、
 * JWT 密钥强度、OSS 条件必填、有默认值变量放行。
 */

/** 合法基线：满足全部校验规则的最小配置 */
function validEnv(): Record<string, string> {
  return {
    NODE_ENV: "dev",
    APP_PORT: "8000",
    PG_HOST: "127.0.0.1",
    PG_PORT: "5432",
    PG_USER: "admin",
    PG_PASSWORD: "secret",
    PG_DB: "peluvida_dev",
    REDIS_HOST: "localhost",
    REDIS_PORT: "6379",
    JWT_SECRET_KEY: "SecretKey0123456789012345678901234567890123456789",
    JWT_EXPIRES_IN: "7200",
    JWT_ISSUER: "niulai-nest",
    OSS_TYPE: "minio",
    OSS_MINIO_ENDPOINT: "http://localhost:9000",
    OSS_MINIO_ACCESS_KEY: "minioadmin",
    OSS_MINIO_SECRET_KEY: "minioadmin",
    OSS_MINIO_BUCKET: "default",
  };
}

describe("validateEnv（CROSS-06 环境变量启动期校验）", () => {
  it("合法配置应通过并原样返回", () => {
    const env = validEnv();
    const result = validateEnv(env);
    expect(result).toBe(env);
  });

  it("抽掉单个必需变量应抛错并指出变量名", () => {
    const env = validEnv();
    delete env.JWT_SECRET_KEY;
    expect(() => validateEnv(env)).toThrow(/JWT_SECRET_KEY/);
  });

  it("多个必需变量缺失应一次性全部列出", () => {
    const env = validEnv();
    delete env.JWT_SECRET_KEY;
    delete env.JWT_ISSUER;
    delete env.PG_DB;
    delete env.REDIS_HOST;

    let caught: Error | undefined;
    try {
      validateEnv(env);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    const message = caught!.message;
    // 全部缺失项都要出现在同一条报错里（fail-fast + 汇总）
    expect(message).toContain("JWT_SECRET_KEY");
    expect(message).toContain("JWT_ISSUER");
    expect(message).toContain("PG_DB");
    expect(message).toContain("REDIS_HOST");
    // 报错头部给出缺失计数
    expect(message).toContain("4 项");
  });

  it("NODE_ENV 非法取值应报错", () => {
    const env = validEnv();
    env.NODE_ENV = "staging";
    expect(() => validateEnv(env)).toThrow(/NODE_ENV/);
    expect(() => validateEnv(env)).toThrow(/dev \| prod \| test/);
  });

  it("SESSION_TYPE 未提供应放行（业务默认 jwt）", () => {
    const env = validEnv();
    expect(validateEnv(env)).toBe(env);
  });

  it("SESSION_TYPE 非法取值应报错", () => {
    const env = validEnv();
    env.SESSION_TYPE = "cookie";
    expect(() => validateEnv(env)).toThrow(/SESSION_TYPE/);
  });

  it("OSS_TYPE=minio 缺少连接参数应报错", () => {
    const env = validEnv();
    delete env.OSS_MINIO_ACCESS_KEY;
    delete env.OSS_MINIO_SECRET_KEY;
    const fn = () => validateEnv(env);
    expect(fn).toThrow(/OSS_MINIO_ACCESS_KEY/);
    expect(fn).toThrow(/OSS_MINIO_SECRET_KEY/);
  });

  it("OSS_TYPE=local 只要求本地存储路径，不要求 MinIO/阿里云参数", () => {
    const env = validEnv();
    env.OSS_TYPE = "local";
    env.OSS_LOCAL_STORAGE_PATH = "D:/data/oss/";
    delete env.OSS_MINIO_ENDPOINT;
    delete env.OSS_MINIO_ACCESS_KEY;
    delete env.OSS_ALIYUN_ENDPOINT;
    expect(validateEnv(env)).toBe(env);
  });

  it("JWT_SECRET_KEY 长度不足 32 字符应报错", () => {
    const env = validEnv();
    env.JWT_SECRET_KEY = "short-secret";
    expect(() => validateEnv(env)).toThrow(/JWT_SECRET_KEY/);
    expect(() => validateEnv(env)).toThrow(/至少 32 字符/);
  });

  it("数字变量非整数应报错", () => {
    const env = validEnv();
    env.APP_PORT = "8080.5";
    expect(() => validateEnv(env)).toThrow(/APP_PORT/);
    expect(() => validateEnv(env)).toThrow(/整数/);
  });

  it("数字变量非数字字符串应报错", () => {
    const env = validEnv();
    env.JWT_EXPIRES_IN = "2h";
    expect(() => validateEnv(env)).toThrow(/JWT_EXPIRES_IN/);
  });

  it("预留的 AI / WX 变量缺失不应报错（零引用预留键）", () => {
    const env = validEnv();
    // 基线中根本没有 WX_MINIAPP_* / AI_*，通过即证明预留键不强制
    expect(validateEnv(env)).toBe(env);
  });

  it("提供了 AI_TIMEOUT_MS 但值非法时应报错", () => {
    const env = validEnv();
    env.AI_TIMEOUT_MS = "-1";
    expect(() => validateEnv(env)).toThrow(/AI_TIMEOUT_MS/);
  });
});
