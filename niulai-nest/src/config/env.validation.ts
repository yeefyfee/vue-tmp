/**
 * 启动期环境变量校验（CROSS-06 环境配置规范）
 *
 * 挂载方式：ConfigModule.forRoot({ validate: validateEnv })
 *
 * 设计要点：
 * 1. fail-fast 且一次性列出全部问题——启动即报错，逐条给出「变量名 + 含义 + 原因」；
 * 2. 零依赖纯函数，仅做结构级检查（非空 / 数字 / 枚举 / 长度），不做连通性探测；
 * 3. config 各 registerAs 工厂内的 required 兜底（如 database.config.ts）保留为第二道防线；
 * 4. 未提供且有业务默认值的变量（SESSION_TYPE=jwt / OSS_TYPE=aliyun）放行，不改变现有行为；
 * 5. 返回原 config（不做默认值注入），避免改变 ConfigService 的既有读取结果。
 */

type Env = Record<string, unknown>;

interface RequiredRule {
  key: string;
  label: string;
}

interface EnumRule extends RequiredRule {
  values: string[];
  /** 未提供时的业务默认值；有默认值的变量缺失时放行 */
  fallback?: string;
}

interface NumberRule extends RequiredRule {
  integer?: boolean;
  min?: number;
}

/** 无条件必需的变量 */
const REQUIRED_KEYS: RequiredRule[] = [
  { key: "NODE_ENV", label: "运行环境" },
  { key: "APP_PORT", label: "应用监听端口" },
  { key: "PG_HOST", label: "数据库主机" },
  { key: "PG_PORT", label: "数据库端口" },
  { key: "PG_USER", label: "数据库账号" },
  { key: "PG_PASSWORD", label: "数据库密码" },
  { key: "PG_DB", label: "数据库名称" },
  { key: "REDIS_HOST", label: "Redis 主机" },
  { key: "REDIS_PORT", label: "Redis 端口" },
  { key: "JWT_SECRET_KEY", label: "JWT 签名密钥" },
  { key: "JWT_EXPIRES_IN", label: "JWT 过期时间(秒)" },
  { key: "JWT_ISSUER", label: "JWT 签发方标识" },
];

/** 枚举约束变量 */
const ENUM_RULES: EnumRule[] = [
  { key: "NODE_ENV", label: "运行环境", values: ["dev", "prod", "test"] },
  { key: "SESSION_TYPE", label: "会话类型", values: ["jwt", "redis-token"], fallback: "jwt" },
  {
    key: "OSS_TYPE",
    label: "对象存储类型",
    values: ["aliyun", "minio", "local"],
    fallback: "aliyun",
  },
];

/** 数字约束变量（仅在提供了值时校验格式） */
const NUMBER_RULES: NumberRule[] = [
  { key: "APP_PORT", label: "应用监听端口", integer: true, min: 1 },
  { key: "PG_PORT", label: "数据库端口", integer: true, min: 1 },
  { key: "REDIS_PORT", label: "Redis 端口", integer: true, min: 1 },
  { key: "JWT_EXPIRES_IN", label: "JWT 过期时间(秒)", integer: true, min: 1 },
  { key: "AI_TIMEOUT_MS", label: "AI 请求超时(毫秒)", integer: true, min: 1 },
];

/** OSS_TYPE 条件必填映射（选了哪种存储，哪组的连接参数就必填） */
const OSS_TYPE_REQUIREMENTS: Record<string, RequiredRule[]> = {
  minio: [
    { key: "OSS_MINIO_ENDPOINT", label: "MinIO Endpoint" },
    { key: "OSS_MINIO_ACCESS_KEY", label: "MinIO AccessKey" },
    { key: "OSS_MINIO_SECRET_KEY", label: "MinIO SecretKey" },
    { key: "OSS_MINIO_BUCKET", label: "MinIO Bucket" },
  ],
  aliyun: [
    { key: "OSS_ALIYUN_ENDPOINT", label: "阿里云 Endpoint" },
    { key: "OSS_ALIYUN_ACCESS_KEY_ID", label: "阿里云 AccessKeyId" },
    { key: "OSS_ALIYUN_ACCESS_KEY_SECRET", label: "阿里云 AccessKeySecret" },
    { key: "OSS_ALIYUN_BUCKET", label: "阿里云 Bucket" },
  ],
  local: [{ key: "OSS_LOCAL_STORAGE_PATH", label: "本地存储路径" }],
};

/** HS256 安全基线：密钥至少 32 字符 */
const JWT_SECRET_MIN_LENGTH = 32;

function asTrimmedString(config: Env, key: string): string {
  const value = config[key];
  if (typeof value === "string") return value.trim();
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

export function validateEnv(config: Env): Env {
  const errors: string[] = [];

  // 1) 无条件必需
  for (const { key, label } of REQUIRED_KEYS) {
    if (!asTrimmedString(config, key)) {
      errors.push(`缺少必需变量 ${key}（${label}）`);
    }
  }

  // 2) 枚举约束
  for (const rule of ENUM_RULES) {
    const value = asTrimmedString(config, rule.key);
    if (!value && rule.fallback !== undefined) continue; // 未提供且有默认值 → 放行
    if (value && !rule.values.includes(value)) {
      errors.push(
        `${rule.key}（${rule.label}）取值非法「${value}」，允许：${rule.values.join(" | ")}`
      );
    }
  }

  // 3) 数字约束（仅对已提供的值做格式检查）
  for (const rule of NUMBER_RULES) {
    const value = asTrimmedString(config, rule.key);
    if (!value) continue;
    const num = Number(value);
    if (!Number.isFinite(num) || (rule.integer && !Number.isInteger(num))) {
      errors.push(
        `${rule.key}（${rule.label}）必须是${rule.integer ? "整数" : "数字"}，当前值「${value}」`
      );
    } else if (rule.min !== undefined && num < rule.min) {
      errors.push(`${rule.key}（${rule.label}）不能小于 ${rule.min}，当前值「${value}」`);
    }
  }

  // 4) JWT 密钥强度
  const secret = asTrimmedString(config, "JWT_SECRET_KEY");
  if (secret && secret.length < JWT_SECRET_MIN_LENGTH) {
    errors.push(
      `JWT_SECRET_KEY（JWT 签名密钥）长度不足：HS256 要求至少 ${JWT_SECRET_MIN_LENGTH} 字符，当前 ${secret.length} 字符`
    );
  }

  // 5) OSS 条件必填
  const ossType = asTrimmedString(config, "OSS_TYPE") || "aliyun";
  const ossRequirements = OSS_TYPE_REQUIREMENTS[ossType];
  if (ossRequirements) {
    for (const { key, label } of ossRequirements) {
      if (!asTrimmedString(config, key)) {
        errors.push(`OSS_TYPE=${ossType} 时缺少必需变量 ${key}（${label}）`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      [
        `[Env Validation] 环境变量校验失败，共 ${errors.length} 项：`,
        ...errors.map((e) => `  - ${e}`),
        `请检查 .env / .env.<NODE_ENV> 文件或启动注入的环境变量（参见 .env.example）`,
      ].join("\n")
    );
  }

  return config;
}
