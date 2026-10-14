/**
 * config 模块 Prisma 移植 · 真库验证（PEL-10c 参考实现）
 *
 * 直接实例化 ConfigService（不启 Nest、不需要登录），走真实 PostgreSQL，
 * 逐项校验「对外契约与 TypeORM 版本一致」：
 *   分页信封 / 关键字过滤 / 逻辑删除 / 唯一键冲突 / BigInt 序列化形态。
 *
 * 运行：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/verify-config-module.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { ConfigService } from "../src/system/config/config.service";
import { enableBigIntJsonSerialization } from "../src/common/prisma/bigint-json";

enableBigIntJsonSerialization();

const CONNECTION =
  process.env.DATABASE_URL ?? "postgresql://admin:Pg%40123456@127.0.0.1:5432/peluvida_dev";

const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: CONNECTION }) });
// ConfigService 只用到 prisma.scoped.xxx 与 prisma.xxx，这里给一个等价的门面即可
const prismaFacade = Object.assign(Object.create(base), { scoped: base }) as never;

const service = new ConfigService(prismaFacade, undefined as never);

const KEY = "VERIFY_CONFIG_KEY_A";
const KEY2 = "VERIFY_CONFIG_KEY_B";
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "√" : "✗"} ${label}  → 实际 ${JSON.stringify(actual)}${ok ? "" : `（期望 ${JSON.stringify(expected)}）`}`
  );
}

async function expectThrow(label: string, fn: () => Promise<unknown>, messagePart: string) {
  try {
    await fn();
    failures += 1;
    console.log(`  ✗ ${label}  → 未抛错（期望抛出「${messagePart}」）`);
  } catch (e) {
    const msg = (e as Error).message ?? "";
    const ok = msg.includes(messagePart);
    if (!ok) failures += 1;
    console.log(`  ${ok ? "√" : "✗"} ${label}  → 抛出「${msg}」`);
  }
}

async function cleanup() {
  await base.sysConfig.deleteMany({ where: { configKey: { in: [KEY, KEY2] } } });
}

async function main() {
  await cleanup();

  console.log("\n=== 1) 新增 ===");
  check(
    "saveConfig 返回 true",
    await service.saveConfig({
      configName: "验证配置A",
      configKey: KEY,
      configValue: "10",
      remark: "单测写入",
      createBy: "1",
    } as never),
    true
  );
  await expectThrow(
    "重复配置键被拒",
    () =>
      service.saveConfig({
        configName: "验证配置A2",
        configKey: KEY,
        configValue: "20",
      } as never),
    "配置键已存在"
  );

  console.log("\n=== 2) 分页与关键字（契约形状） ===");
  const page = await service.getConfigPage({ pageNum: 1, pageSize: 10 } as never);
  check("返回 data 数组", Array.isArray(page.data), true);
  check("返回 page.pageNum / pageSize / total 三个字段", Object.keys(page.page), [
    "pageNum",
    "pageSize",
    "total",
  ]);
  const totalAll = page.page.total;
  check("total 为数字", typeof totalAll, "number");

  const filtered = await service.getConfigPage({
    pageNum: 1,
    pageSize: 10,
    keywords: "验证配置A",
  } as never);
  check("关键字命中 1 条", filtered.page.total, 1);
  check("关键字过滤后数据键名正确", filtered.data[0]?.configKey, KEY);

  const missAll = await service.getConfigPage({
    pageNum: 1,
    pageSize: 10,
    keywords: "不存在的关键字XYZ",
  } as never);
  check("无命中返回 0 条", missAll.page.total, 0);

  console.log("\n=== 3) 单条读取与 BigInt 序列化 ===");
  const row = await service.getConfigFormData(Number(page.data[0]!.id));
  check("按 ID 取到记录", row.configKey, KEY);
  check("id 为 BigInt", typeof row.id, "bigint");
  check("BigInt 经 JSON 序列化后为字符串", JSON.stringify({ id: row.id }), `{"id":"${row.id}"}`);

  await expectThrow(
    "取不存在的 ID → NotFound",
    () => service.getConfigFormData("999999999"),
    "配置不存在"
  );
  await expectThrow("非法 ID → BadRequest", () => service.getConfigFormData("abc"), "格式不正确");

  console.log("\n=== 4) 修改与唯一键冲突 ===");
  const idNum = Number(row.id);
  check(
    "updateConfig 返回 true",
    await service.updateConfig(idNum, { configValue: "99" } as never),
    true
  );
  const afterUpdate = await service.getConfigFormData(idNum);
  check("配置值已更新", afterUpdate.configValue, "99");
  check("未传的字段保持不变", afterUpdate.configName, "验证配置A");

  await service.saveConfig({
    configName: "验证配置B",
    configKey: KEY2,
    configValue: "1",
  } as never);
  await expectThrow(
    "改成已存在的配置键 → 冲突",
    () => service.updateConfig(idNum, { configKey: KEY2 } as never),
    "配置键已存在"
  );

  console.log("\n=== 5) 逻辑删除 ===");
  check("deleteConfig 返回 true", await service.deleteConfig(idNum), true);
  const dbRow = await base.sysConfig.findUnique({ where: { id: BigInt(idNum) } });
  check("物理行仍在（逻辑删除）", dbRow !== null, true);
  check("is_deleted 置为 1", dbRow?.isDeleted, 1);
  await expectThrow("已删除记录不可再取", () => service.getConfigFormData(idNum), "配置不存在");

  console.log("\n=== 6) 配置值查询（缓存缺失回落到库） ===");
  check("getConfigValue 命中", await service.getConfigValue(KEY2), "1");
  check("getConfigValue 未命中", await service.getConfigValue("NOT_EXIST_KEY"), null);

  console.log(`\n=== 结论：${failures === 0 ? "全部通过 ✅" : `${failures} 项失败 ❌`} ===`);
}

main()
  .then(async () => {
    await cleanup();
    await base.$disconnect();
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error("运行失败：", e);
    try {
      await cleanup();
    } catch {
      /* ignore */
    }
    await base.$disconnect();
    process.exit(1);
  });
