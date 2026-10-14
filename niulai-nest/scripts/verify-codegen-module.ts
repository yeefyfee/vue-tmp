/**
 * codegen 模块 Prisma/PG 迁移 · 真库验证（PEL-10 第③段收尾）
 *
 * 直接实例化 CodegenService（不启 Nest），走真实 PostgreSQL，覆盖三件事：
 *   ① **内省**：`getTablePage` / `getGenConfig`（未配置路径）是否真的按 **PG 系统目录**取到表与列；
 *   ② **配置读写**：`saveGenConfig` / `deleteGenConfig` 的 Prisma 化是否保持原语义
 *      （含「保存即复活」「整批替换字段配置」这类刻意保留的行为）；
 *   ③ **产出物**：`getPreview` 渲染出的后端文件是否已是 Prisma 形态（无 typeorm 残留），
 *      并把生成物**真实落盘**，交给 `tsc` 做一次编译校验（脚本末尾会打印命令）。
 *
 * 运行：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/verify-codegen-module.ts
 *
 * 紧接着再跑一次生成物的类型检查：
 *   node ./node_modules/typescript/bin/tsc -p verify.tmp/tsconfig.codegen.json
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

import { CodegenService } from "../src/codegen/codegen.service";
import { enableBigIntJsonSerialization } from "../src/common/prisma/bigint-json";

enableBigIntJsonSerialization();

const CONNECTION =
  process.env.DATABASE_URL ?? "postgresql://admin:Pg%40123456@127.0.0.1:5432/peluvida_dev";

const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: CONNECTION }) });
const service = new CodegenService(base as never);

/** 目标表：`sys_config` 在 schema 里有真实模型 `SysConfig`，这样才能对生成物做编译校验 */
const TABLE = "sys_config";
const ENTITY = "SysConfig";
const MODULE = "system";
const BACKEND_APP = "niulai-nest";
const GEN_ROOT = path.resolve(process.cwd(), "verify.tmp", "codegen-gen");

let failures = 0;
let checks = 0;

function norm(p: string) {
  return String(p).replace(/\\/g, "/");
}

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "√" : "✗"} ${label}  → 实际 ${JSON.stringify(actual)}${ok ? "" : `（期望 ${JSON.stringify(expected)}）`}`
  );
}

function checkTrue(label: string, cond: boolean, detail = "") {
  checks += 1;
  if (!cond) failures += 1;
  console.log(`  ${cond ? "√" : "✗"} ${label}${detail ? `  → ${detail}` : ""}`);
}

function section(title: string) {
  console.log(`\n=== ${title} ===`);
}

/** 清掉本脚本可能写下的 gen_table / gen_table_column 行 */
async function cleanup() {
  const rows = await base.genTable.findMany({ where: { tableName: TABLE }, select: { id: true } });
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await base.genTableColumn.deleteMany({ where: { tableId: { in: ids } } });
    await base.genTable.deleteMany({ where: { id: { in: ids } } });
  }
}

async function main() {
  await cleanup();

  // ─────────────────────────────────────────────────────────────
  section("1) 环境与基线清点");
  const baseGenTable = await base.genTable.count();
  const baseGenCol = await base.genTableColumn.count();
  checkTrue("基线：gen_table 计数已捕获", baseGenTable >= 0, `${baseGenTable} 行`);
  checkTrue("基线：gen_table_column 计数已捕获", baseGenCol >= 0, `${baseGenCol} 行`);

  const sysConfigExists = await base.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(1)::int AS n FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = 'sys_config'
  `;
  check("目标表 sys_config 存在", sysConfigExists[0].n, 1);
  checkTrue(
    "Prisma 模型 SysConfig 可用（生成物编译校验的前提）",
    typeof (base as never as { sysConfig?: unknown }).sysConfig === "object",
    "client.sysConfig 已挂载"
  );

  // ─────────────────────────────────────────────────────────────
  section("2) getTablePage（PG 系统目录内省 + 契约形状）");
  const page = await service.getTablePage({ pageNum: 1, pageSize: 100 } as never);
  check("返回 data 数组", Array.isArray(page.data), true);
  check("page 键形状", Object.keys(page.page), ["pageNum", "pageSize", "total"]);
  check("pageNum 原样回显", page.page.pageNum, 1);
  check("pageSize 原样回显", page.page.pageSize, 100);

  const names = page.data.map((r) => r.tableName);
  checkTrue("包含 sys_config", names.includes("sys_config"), `${names.length} 张表`);
  checkTrue("包含 sys_dept", names.includes("sys_dept"));
  checkTrue(
    "排除 gen_table / gen_table_column（代码生成元数据表）",
    !names.includes("gen_table") && !names.includes("gen_table_column")
  );
  checkTrue(
    "排除 _prisma_migrations（Prisma 自身基础设施表）",
    !names.includes("_prisma_migrations")
  );
  checkTrue(
    "排序确定：table_name ASC",
    JSON.stringify(names) === JSON.stringify([...names].sort()),
    names.slice(0, 4).join(", ") + " …"
  );

  const cfgRow = page.data.find((r) => r.tableName === "sys_config")!;
  check("未配置表 isConfigured = 0", cfgRow.isConfigured, 0);
  checkTrue("isConfigured 为数字（原契约）", typeof cfgRow.isConfigured === "number");
  // PG 能力差异：显式记录为 null，而不是伪造等价物
  check("engine 恒为 null（PG 无存储引擎概念）", cfgRow.engine, null);
  check("tableCollation 恒为 null（PG 排序规则是列级）", cfgRow.tableCollation, null);
  check("createTime 恒为 null（PG 系统目录不记录建表时间）", cfgRow.createTime, null);
  checkTrue(
    "tableComment 走 obj_description（PG 有等价物）",
    typeof cfgRow.tableComment === "string",
    JSON.stringify(cfgRow.tableComment)
  );

  // 关键字：原 MySQL LIKE 不区分大小写 ⇒ PG 必须用 ILIKE（约定 15）
  const kwUpper = await service.getTablePage({
    pageNum: 1,
    pageSize: 100,
    keywords: "SYS_CONFIG",
  } as never);
  check(
    "关键字大写仍命中（ILIKE 大小写不敏感）",
    kwUpper.data.map((r) => r.tableName),
    ["sys_config"]
  );
  const kwLower = await service.getTablePage({
    pageNum: 1,
    pageSize: 100,
    keywords: "config",
  } as never);
  checkTrue(
    "关键字小写模糊命中",
    kwLower.data.some((r) => r.tableName === "sys_config"),
    kwLower.data.map((r) => r.tableName).join(",")
  );

  // 分页：单页取 3 条，与整体前 3 条一致（证明 LIMIT/OFFSET 参数化生效）
  const p1 = await service.getTablePage({ pageNum: 1, pageSize: 3 } as never);
  check("分页 pageSize 生效", p1.data.length, 3);
  check("分页 total 为总数（不受 pageSize 影响）", p1.page.total, page.page.total);
  const p2 = await service.getTablePage({ pageNum: 2, pageSize: 3 } as never);
  checkTrue(
    "第 2 页与第 1 页不重叠",
    !p2.data.some((r) => p1.data.map((x) => x.tableName).includes(r.tableName)),
    `${p1.data.map((r) => r.tableName).join(",")} | ${p2.data.map((r) => r.tableName).join(",")}`
  );

  // ─────────────────────────────────────────────────────────────
  section("3) getGenConfig —— 未配置路径（按表结构现场推导，PG 类型映射）");
  const draft = await service.getGenConfig(TABLE);
  check("无 id（尚未入库）", draft.id, undefined);
  // 未配置时实体名由表名去掉默认前缀 sys_ 推导 ⇒ Config
  check("实体名由表名推导（去 sys_ 前缀 → Pascal）", draft.entityName, "Config");
  check("模块名取默认值", draft.moduleName, "system");
  check("包名取默认值", draft.packageName, "src");
  check("作者取默认值", draft.author, "niulaitech");
  check("移除前缀取默认值", draft.removeTablePrefix, "sys_");
  check("pageType 默认 classic", draft.pageType, "classic");
  check("字段数与 sys_config 列数一致（10）", draft.fieldConfigs!.length, 10);

  const byName = (n: string) => draft.fieldConfigs!.find((f) => f.columnName === n)!;
  // PG data_type → 中间类型（词表刻意沿用，见服务内注释）
  check("character varying → String", byName("config_name").fieldType, "String");
  check("bigint → Long", byName("id").fieldType, "Long");
  check("smallint → Integer", byName("is_deleted").fieldType, "Integer");
  check(
    "timestamp with time zone → LocalDateTime",
    byName("create_time").fieldType,
    "LocalDateTime"
  );
  check("varchar 长度被采集", byName("config_value").maxLength, 500);
  check("fieldName 由列名转驼峰", byName("config_key").fieldName, "configKey");
  // isRequired 口径：nullable=NO ⇒ 1
  check("NOT NULL 列 isRequired = 1", byName("config_key").isRequired, 1);
  check("可空列 isRequired = 0", byName("remark").isRequired, 0);
  check("date 族 formType = 9（DATE_TIME）", byName("create_time").formType, 9);
  check("普通列 formType = 1（INPUT）", byName("config_name").formType, 1);
  check("默认 queryType = 1（EQ）", byName("config_name").queryType, 1);
  check("fieldSort 从 1 递增", byName("id").fieldSort, 1);
  checkTrue("未配置表不产生 id", draft.id === undefined);

  // ─────────────────────────────────────────────────────────────
  section("4) saveGenConfig —— 新增");
  const saved = await service.saveGenConfig(TABLE, {
    tableName: TABLE,
    moduleName: MODULE,
    businessName: "参数配置",
    entityName: ENTITY,
    author: "verify",
    parentMenuId: "1",
    fieldConfigs: [
      {
        columnName: "config_name",
        columnType: "character varying",
        fieldName: "configName",
        fieldComment: "参数名称",
        isRequired: 1,
        isShowInList: 1,
        isShowInForm: 1,
        isShowInQuery: 1,
        queryType: 2,
        formType: 1,
        maxLength: 50,
        fieldSort: 1,
      },
      {
        columnName: "config_key",
        columnType: "character varying",
        fieldName: "configKey",
        fieldComment: "参数键",
        isRequired: 1,
        isShowInList: 1,
        isShowInForm: 1,
        isShowInQuery: 1,
        queryType: 1,
        formType: 1,
        maxLength: 50,
        fieldSort: 2,
      },
      {
        columnName: "config_value",
        columnType: "character varying",
        fieldName: "configValue",
        fieldComment: "参数值",
        isRequired: 1,
        isShowInList: 1,
        isShowInForm: 1,
        isShowInQuery: 0,
        queryType: 1,
        formType: 1,
        maxLength: 500,
        fieldSort: 3,
      },
    ],
  } as never);
  check("saveGenConfig 返回 true", saved, true);

  const cfgRowAfter = await base.genTable.findFirst({ where: { tableName: TABLE } });
  checkTrue("gen_table 已写入", !!cfgRowAfter);
  check("写入 is_deleted = 0", cfgRowAfter!.isDeleted, 0);
  check("写入 module_name", cfgRowAfter!.moduleName, MODULE);
  check("写入 entity_name", cfgRowAfter!.entityName, ENTITY);
  check("写入 business_name", cfgRowAfter!.businessName, "参数配置");
  check("写入 author", cfgRowAfter!.author, "verify");
  check("parentMenuId 落库为 1", Number(cfgRowAfter!.parentMenuId), 1);
  checkTrue("create_time 非空", !!cfgRowAfter!.createTime);
  checkTrue("update_time 非空", !!cfgRowAfter!.updateTime);
  check(
    "字段配置行数 = 3",
    await base.genTableColumn.count({ where: { tableId: cfgRowAfter!.id } }),
    3
  );

  // ─────────────────────────────────────────────────────────────
  section("5) getGenConfig —— 已配置路径（回显 + 刻意保留的行为）");
  const cfg = await service.getGenConfig(TABLE);
  check("id 字符串化", cfg.id, cfgRowAfter!.id.toString());
  check("tableName 回显", cfg.tableName, TABLE);
  check("businessName 回显", cfg.businessName, "参数配置");
  check("entityName 回显", cfg.entityName, ENTITY);
  check("moduleName 回显", cfg.moduleName, MODULE);
  check("author 回显", cfg.author, "verify");
  check("parentMenuId 字符串化", cfg.parentMenuId, "1");
  // ⚠️ 保持原行为①：packageName 恒取默认值（忽略库中值）
  check("packageName 恒为默认值（保持原行为①）", cfg.packageName, "src");
  check(
    "字段配置回显顺序按 fieldSort",
    cfg.fieldConfigs!.map((f) => f.columnName),
    ["config_name", "config_key", "config_value"]
  );
  check("字段 id 字符串化", typeof cfg.fieldConfigs![0].id, "string");
  check("queryType 回显（LIKE=2）", cfg.fieldConfigs![0].queryType, 2);
  check("fieldType 缺失时按 columnType 兜底", cfg.fieldConfigs![0].fieldType, "String");
  check("dictType 缺省为 undefined", cfg.fieldConfigs![0].dictType, undefined);

  // ─────────────────────────────────────────────────────────────
  section("6) saveGenConfig —— 更新（整批替换 + 保存即复活）");
  await service.saveGenConfig(TABLE, {
    tableName: TABLE,
    moduleName: MODULE,
    businessName: "参数配置v2",
    entityName: ENTITY,
    author: "verify2",
    fieldConfigs: [
      {
        columnName: "config_key",
        columnType: "character varying",
        fieldName: "configKey",
        isRequired: 1,
        isShowInQuery: 1,
        queryType: 1,
        formType: 1,
        maxLength: 50,
        fieldSort: 1,
      },
    ],
  } as never);
  const afterUpdate = await base.genTable.findFirst({ where: { tableName: TABLE } });
  check(
    "同一表不新增行（仍为 1 行）",
    await base.genTable.count({ where: { tableName: TABLE } }),
    1
  );
  check("businessName 被更新", afterUpdate!.businessName, "参数配置v2");
  check("author 被更新", afterUpdate!.author, "verify2");
  // 整批替换：旧的 3 行被删，只剩新的 1 行
  check(
    "字段配置整批替换（3 → 1）",
    await base.genTableColumn.count({ where: { tableId: afterUpdate!.id } }),
    1
  );

  // 保存即复活：先逻辑删除，再保存一次
  await base.genTable.update({ where: { id: afterUpdate!.id }, data: { isDeleted: 1 } });
  const afterSoftDel = await base.genTable.findFirst({ where: { tableName: TABLE } });
  check("前置：已置 is_deleted = 1", afterSoftDel!.isDeleted, 1);
  await service.saveGenConfig(TABLE, {
    tableName: TABLE,
    moduleName: MODULE,
    businessName: "参数配置v3",
    entityName: ENTITY,
    fieldConfigs: [
      {
        columnName: "config_key",
        columnType: "character varying",
        fieldName: "configKey",
        isRequired: 1,
        isShowInQuery: 1,
        queryType: 1,
        formType: 1,
        fieldSort: 1,
      },
    ],
  } as never);
  const revived = await base.genTable.findFirst({ where: { tableName: TABLE } });
  check("保存即复活（is_deleted 回到 0）", revived!.isDeleted, 0);
  checkTrue(
    "复活后仍只有 1 行",
    (await base.genTable.count({ where: { tableName: TABLE } })) === 1
  );

  check("entityName 仍为 SysConfig", revived!.entityName, ENTITY);

  // ─────────────────────────────────────────────────────────────
  section("7) getPreview —— 生成物必须是 Prisma 形态（无 TypeORM 残留）");

  // 🔴 前置：第 6 步为了验「整批替换」把配置换成了「单字段 / 无注释 / 无 maxLength / 全 EQ」。
  //    那份退化配置**不能用来验证产物质量** —— 注释粘连、@db.* 注解、LIKE 分支全都测不出来
  //    （实测：只跑退化配置时模型产物看着「正常」，换个富配置立刻暴露字段注释被粘到上一行）。
  //    所以在取预览前重新存一份富配置：混合可空性、三种原生类型、EQ + LIKE 两种 queryType，
  //    并**刻意留一个无注释字段**以覆盖「不产出 /// 行」的分支。
  await service.saveGenConfig(TABLE, {
    tableName: TABLE,
    moduleName: MODULE,
    businessName: "参数配置",
    entityName: ENTITY,
    author: "verify",
    fieldConfigs: [
      {
        columnName: "config_name",
        columnType: "character varying",
        fieldName: "configName",
        fieldComment: "参数名称",
        isRequired: 1,
        isShowInList: 1,
        isShowInForm: 1,
        isShowInQuery: 1,
        queryType: 2,
        formType: 1,
        maxLength: 50,
        fieldSort: 1,
      },
      {
        columnName: "config_key",
        columnType: "character varying",
        fieldName: "configKey",
        fieldComment: "参数键",
        isRequired: 1,
        isShowInList: 1,
        isShowInForm: 1,
        isShowInQuery: 1,
        queryType: 2,
        formType: 1,
        maxLength: 100,
        fieldSort: 2,
      },
      {
        columnName: "remark",
        columnType: "character varying",
        fieldName: "remark",
        fieldComment: "备注",
        isRequired: 0,
        isShowInList: 1,
        isShowInForm: 1,
        isShowInQuery: 0,
        queryType: 1,
        formType: 1,
        maxLength: 500,
        fieldSort: 3,
      },
      {
        columnName: "create_time",
        columnType: "timestamp with time zone",
        fieldName: "createTime",
        fieldComment: "创建时间",
        isRequired: 0,
        isShowInList: 1,
        isShowInForm: 0,
        isShowInQuery: 0,
        queryType: 1,
        formType: 9,
        fieldSort: 4,
      },
      {
        columnName: "is_deleted",
        columnType: "smallint",
        fieldName: "isDeleted",
        fieldComment: "逻辑删除",
        isRequired: 1,
        isShowInList: 0,
        isShowInForm: 0,
        isShowInQuery: 0,
        queryType: 1,
        formType: 1,
        fieldSort: 5,
      },
      {
        columnName: "no_comment_col",
        columnType: "character varying",
        fieldName: "noCommentCol",
        isRequired: 0,
        isShowInList: 0,
        isShowInForm: 0,
        isShowInQuery: 0,
        queryType: 1,
        formType: 1,
        maxLength: 20,
        fieldSort: 6,
      },
    ],
  } as never);

  const previews = await service.getPreview(TABLE, "classic", "ts");
  check("ts 模式生成 11 个文件", previews.length, 11);
  const jsPreviews = await service.getPreview(TABLE, "classic", "js");
  check("js 模式生成 10 个文件（跳过 API_TYPES）", jsPreviews.length, 10);
  checkTrue(
    "js 模式确实不含 API_TYPES",
    !jsPreviews.some((p) => p.fileName === "types.ts" || p.fileName === "types.js")
  );

  const backend = previews.filter((p) => p.scope === "backend");
  check("后端产物 8 个", backend.length, 8);
  const frontend = previews.filter((p) => p.scope === "frontend");
  check("前端产物 3 个", frontend.length, 3);

  // 🔴 全量扫 typeorm 残留（这是本次迁移的核心判据）
  const typeormHits = previews.filter(
    (p) => /typeorm/i.test(p.content) || /TypeOrmModule/.test(p.content)
  );
  checkTrue(
    "所有生成内容均无 typeorm / TypeOrmModule",
    typeormHits.length === 0,
    typeormHits.map((p) => p.fileName).join(",") || "无命中"
  );

  const model = previews.find((p) => p.fileName.endsWith(".prisma"))!;
  checkTrue("产出 Prisma 模型文件", !!model, model?.fileName);
  check("模型文件语言标记", model.language, "prisma");
  check("模型文件路径在 prisma/models", norm(model.path), "packages/db/prisma/models");
  checkTrue("模型含 model SysConfig", model.content.includes(`model ${ENTITY} {`));
  checkTrue('模型含 @@map("sys_config")', model.content.includes(`@@map("${TABLE}")`));
  checkTrue(
    "模型含 id 主键自增",
    /id BigInt @id @default\(autoincrement\(\)\)/.test(model.content)
  );
  checkTrue("列名下划线经 @map 映射", model.content.includes(`@map("config_name")`));
  checkTrue("varchar 带原生类型注解", model.content.includes("@db.VarChar(50)"));
  checkTrue("timestamptz 带原生类型注解", model.content.includes("@db.Timestamptz(3)"));
  checkTrue("smallint 带原生类型注解", model.content.includes("@db.SmallInt"));
  checkTrue("可空列标 ?", /createTime\s+DateTime\?/.test(model.content));
  checkTrue("NOT NULL 列不标 ?", /configName\s+String\s/.test(model.content));
  checkTrue(
    "列名与字段名相同时不写 @map",
    /^\s{2}remark\s+String\?\s+@db\.VarChar\(500\)\s*$/m.test(model.content)
  );
  checkTrue(
    "无注释字段不产出 /// 行",
    /^\s{2}noCommentCol\s+String\?\s+@db\.VarChar\(20\)/m.test(model.content)
  );

  // 🔴🔴 换行完整性 —— velocityjs「指令吃换行」缺陷的回归网（本次真实踩到，代价很大）
  //   velocityjs 会吃掉紧跟指令标记之后的换行（独立占行 / 行内 / 带不带 ## 都一样）。
  //   症状：字段行的字段与下一字段的 `/// 注释` 被粘成一行 ⇒ Prisma 模型语法直接坏掉。
  //   坑中之坑：单字段或全无注释的配置**看不出异常**，所以必须用富配置 + 结构断言来守。
  const modelLines = model.content.split(/\r?\n/);
  const glued = modelLines.filter((l) => /^\s{2}\w+\s/.test(l) && l.includes("///"));
  checkTrue("模型无「注释粘在字段行尾」", glued.length === 0, glued.join(" | ") || "无粘连");
  const fieldLines = modelLines.filter((l) =>
    /^\s{2}\w+\s+(BigInt|String|Int|DateTime)\??/.test(l)
  );
  check("模型字段行数（id + 6 个业务列）", fieldLines.length, 7);
  const cmtLines = modelLines.filter((l) => l.trim().startsWith("///"));
  check("/// 注释行数（5 行文件头 + 5 个有注释字段）", cmtLines.length, 10);
  checkTrue("@@map 前保留空行", /\n\n\s{2}@@map\(/.test(model.content));

  const svc = previews.find((p) => p.fileName.endsWith(".service.ts"))!;
  checkTrue(
    "服务注入 PrismaService",
    svc.content.includes("private readonly prisma: PrismaService")
  );
  checkTrue(
    "服务使用 findMany/count 分页",
    svc.content.includes("findMany(") && svc.content.includes(".count(")
  );
  checkTrue(
    "服务用 findFirst（非 findUnique）",
    svc.content.includes("findFirst(") && !svc.content.includes("findUnique(")
  );
  checkTrue("服务显式过滤 isDeleted", svc.content.includes("isDeleted: 0"));
  checkTrue("服务主键过 toBigInt", svc.content.includes("toBigInt("));
  checkTrue(
    "服务写审计字段",
    svc.content.includes("auditOnCreate()") && svc.content.includes("auditOnUpdate()")
  );
  // 产物是 `return {\n  data: list,\n  page: { ... },\n};` —— 注意是 `data: list,`，
  // 早期断言写的是 `return \{\s*data,`（要求 `data` 后紧跟逗号），恒不命中。
  checkTrue(
    "服务分页返回 { data, page } 契约",
    /return \{\s*data:\s*\w+,/.test(svc.content) &&
      svc.content.includes("page: {") &&
      svc.content.includes("total,")
  );
  checkTrue(
    "服务无 Repository / InjectRepository",
    !/Repository|InjectRepository|createQueryBuilder/.test(svc.content)
  );
  // 富配置里 config_name / config_key 的 queryType = 2（LIKE）⇒ 应恰好产出 2 处 insensitive 补偿
  const insensitiveCount = (svc.content.match(/mode: "insensitive"/g) || []).length;
  check("LIKE 查询用 insensitive（PG 补偿）", insensitiveCount, 2);

  const mod = previews.find((p) => p.fileName.endsWith(".module.ts"))!;
  checkTrue("模块无 TypeOrmModule.forFeature", !mod.content.includes("forFeature"));
  checkTrue(
    "模块注册 controller 与 provider",
    mod.content.includes("SysConfigController") &&
      mod.content.includes("providers: [SysConfigService]")
  );

  const ctrl = previews.find((p) => p.fileName.endsWith(".controller.ts"))!;
  checkTrue("控制器路由为 entityKebab", ctrl.content.includes('@Controller("sys-config")'));
  checkTrue(
    "控制器方法齐全",
    ["getSysConfigPage", "getSysConfigForm", "create", "update", "delete"].every((m) =>
      ctrl.content.includes(m)
    )
  );

  // ─────────────────────────────────────────────────────────────
  section("8) 生成物落盘（供 tsc 编译校验）");
  if (fs.existsSync(GEN_ROOT)) fs.rmSync(GEN_ROOT, { recursive: true, force: true });
  let written = 0;
  for (const item of backend) {
    if (item.fileName.endsWith(".prisma")) continue; // 非 TS，不参与 tsc
    const rel = norm(path.join(item.path, item.fileName)).replace(
      new RegExp(`^${BACKEND_APP}/`),
      ""
    );
    const dest = path.join(GEN_ROOT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, item.content, "utf8");
    written += 1;
  }
  check("落盘后端 TS 生成物数量（8 个产物中排除 .prisma）", written, 7);

  const tsconfigPath = path.resolve(process.cwd(), "verify.tmp", "tsconfig.codegen.json");
  fs.writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        extends: "../tsconfig.json",
        compilerOptions: {
          noEmit: true,
          incremental: false,
          composite: false,
          baseUrl: "..",
          paths: { "@/*": ["src/*"] },
        },
        include: ["codegen-gen/**/*.ts"],
      },
      null,
      2
    ),
    "utf8"
  );
  checkTrue("已写出 codegen 生成物的 tsconfig", fs.existsSync(tsconfigPath), norm(tsconfigPath));

  // ─────────────────────────────────────────────────────────────
  section("9) deleteGenConfig —— 物理删字段行 + 逻辑删配置");
  const delOk = await service.deleteGenConfig(TABLE);
  check("deleteGenConfig 返回 true", delOk, true);
  check(
    "字段配置行被物理删除",
    await base.genTableColumn.count({ where: { tableId: revived!.id } }),
    0
  );
  const afterDelete = await base.genTable.findFirst({ where: { tableName: TABLE } });
  checkTrue("gen_table 仍在（逻辑删除）", !!afterDelete);
  check("is_deleted 置为 1", afterDelete!.isDeleted, 1);
  checkTrue(
    "updateTime 被刷新（删除写入的晚于复活时那次）",
    !!afterDelete!.updateTime &&
      !!revived!.updateTime &&
      afterDelete!.updateTime.getTime() >= revived!.updateTime.getTime(),
    `${revived!.updateTime?.toISOString()} → ${afterDelete!.updateTime?.toISOString()}`
  );
  // 保持原行为②：查配置不带 is_deleted 过滤 ⇒ 重复删除仍返回 true（幂等）
  check("对已逻辑删除的配置再删一次仍返回 true", await service.deleteGenConfig(TABLE), true);
  check("对不存在的表返回 true", await service.deleteGenConfig("no_such_table_xyz"), true);
  check("重复删除未产生新行", await base.genTable.count({ where: { tableName: TABLE } }), 1);

  // ─────────────────────────────────────────────────────────────
  section("10) 清理与残留");
  await cleanup();
  check("gen_table 恢复基线", await base.genTable.count(), baseGenTable);
  check("gen_table_column 恢复基线", await base.genTableColumn.count(), baseGenCol);

  console.log(`\n================ 结论：${checks - failures}/${checks} 通过 ================`);
  if (failures) {
    console.log(`❌ 失败 ${failures} 项`);
  } else {
    console.log("✅ 全部通过");
  }
  console.log(
    `\n下一步（生成物编译校验）：\n  node ./node_modules/typescript/bin/tsc -p verify.tmp/tsconfig.codegen.json`
  );
}

main()
  .catch((e) => {
    console.error("脚本异常：", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await base.$disconnect();
    if (failures) process.exitCode = 1;
  });
