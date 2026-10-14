/**
 * Prisma schema 保真度审计（PEL-10 基线）
 *
 * 目的：确保 `prisma/schema.prisma` 与原 MySQL 建表脚本**语义等价**，
 * 而不是「能跑就行」。迁移到新引擎后，静态类型检查（tsc）与内容体检都无法
 * 发现「列缺失 / 可空性反了 / 长度缩水 / 默认值变了 / 索引丢了」这类差异，
 * 它们只会在生产数据上表现为静默错误。
 *
 * 比对项：
 *   1. 表集合（原 DDL vs schema.prisma）
 *   2. 列集合（逐表）
 *   3. 类型族（varchar 长度 / text / int 变体 / bigint / 时间）
 *   4. 可空性
 *   5. 默认值
 *   6. 索引与唯一约束
 *
 * 数据源：`_peluvida_archive/20261004/moved/backend-sql-*.sql`（归档的原始脚本）。
 * 归档被清理后脚本会跳过并提示，不影响正常构建。
 *
 * 运行：node scripts/audit-schema-fidelity.mjs
 * 退出码：发现 P0 级差异（表/列缺失）时为 1
 */
import fs from "node:fs";
import path from "node:path";

/**
 * 已登记的范围外表：原 DDL 中存在，但**有意不进入** Prisma 基线。
 * 登记后走独立区块输出，不再作为待确认项反复告警。
 */
const EXPECTED_ABSENT = {
  sys_notice: "原 admin 脚本中的废弃表，src 中零引用，未随项目移植",
  sys_user_notice: "同上",
  storage_category: "storage 模块已整体归档（PEL-06），不在 admin 基线范围内",
  storage_tag: "storage 模块已整体归档（PEL-06）",
  storage_item: "storage 模块已整体归档（PEL-06）",
  storage_item_tag: "storage 模块已整体归档（PEL-06）",
  suno_config: "suno 模块已整体归档（PEL-06）",
  suno_task: "suno 模块已整体归档（PEL-06）",
  suno_asset: "suno 模块已整体归档（PEL-06）",
  suno_points_log: "suno 模块已整体归档（PEL-06）",
};

const ARCHIVE_DIR = "D:/Warehouse/_peluvida_archive/20261004/moved";
const SCHEMA = path.join(process.cwd(), "..", "packages", "db", "prisma", "schema.prisma");

/**
 * 已复核的有意差异登记表。
 *
 * 背景：原项目的运行时真相是 MySQL 建表脚本（`synchronize: false`），
 * 而 Prisma 基线是「逐字段翻译实体」得到的。实体与 DDL 在本项目历史上本就不一致，
 * 因此差异分三类，处理原则不同：
 *   - 实体比 DDL 窄  → Prisma 会真的收窄可接受数据，属**风险**，须逐条复核（本项目里长度已统一取宽者）
 *   - 实体比 DDL 宽  → 安全放松，登记即可
 *   - 可空性更严     → Prisma 类型更严格，服务层代码受编译期保护，登记即可
 * 登记后的条目走独立区块输出，不再计入告警计数。
 */
const DELIBERATE = [
  {
    category: "可空性不符",
    cols: [
      "sys_dept.sort", "sys_dept.status", "sys_dept.is_deleted",
      "sys_dict.status", "sys_dict.is_deleted",
      "sys_dict_item.dict_code", "sys_dict_item.value", "sys_dict_item.label",
      "sys_dict_item.status", "sys_dict_item.sort",
      "sys_menu.visible", "sys_menu.sort",
      "sys_role.status", "sys_role.is_deleted",
      "sys_user.username", "sys_user.nickname", "sys_user.gender",
      "sys_user.password", "sys_user.status", "sys_user.is_deleted",
      "gen_table.is_deleted", "sys_user_social.verified",
    ],
    reason:
      "原 DDL 未写 NOT NULL 但实体声明为非空。Prisma 收紧为必填，服务层写入受编译期约束；新基线从零建库，不存在历史 NULL 数据。",
  },
  {
    category: "长度不符",
    cols: ["sys_dict_item.dict_code", "sys_config.config_value", "sys_config.remark"],
    reason: "实体声明长度大于 DDL，取宽者（安全放松），不会拒掉历史可接受的数据。",
  },
  {
    category: "类型族不符",
    cols: ["sys_user.dept_id"],
    reason: "实体为 bigint、DDL 为 int；sys_dept.id 实为 bigint，取 bigint 更正确且更宽。",
  },
  {
    category: "默认值不同",
    cols: ["sys_dict_item.status"],
    reason:
      "DDL DEFAULT 0 与其自带注释「1-正常，0-禁用」自相矛盾；实体声明 default 1。且 CreateDictItemDto.status 为必填，该默认永不生效（惰性差异）。",
  },
  {
    category: "多列",
    cols: ["sys_user_social.create_by", "sys_user_social.update_by", "sys_user_social.is_deleted"],
    reason:
      "实体继承 BaseEntity 因而包含审计列，但原 DDL 漏建。属修复原项目潜在缺陷（原代码对该表写入审计列会在 MySQL 报 Unknown column）。",
  },
];

function deliberateReason(category, col) {
  for (const d of DELIBERATE) {
    if (d.category === category && d.cols.includes(col)) return d.reason;
  }
  return null;
}

// ---------------- 读取原始 DDL ----------------
function findSqlFiles() {
  if (!fs.existsSync(ARCHIVE_DIR)) return [];
  return fs
    .readdirSync(ARCHIVE_DIR)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => path.join(ARCHIVE_DIR, f));
}

function parseMysqlDdl(text) {
  const tables = new Map();
  const re = /CREATE TABLE\s+`(\w+)`\s*\(([\s\S]*?)\n\)\s*ENGINE/gi;
  let m;
  while ((m = re.exec(text))) {
    const table = m[1];
    const body = m[2];
    const columns = new Map();
    const indexes = [];
    const uniques = [];

    for (const rawLine of body.split(/\n/)) {
      const line = rawLine.trim().replace(/,$/, "");
      if (!line) continue;

      // 索引 / 唯一约束
      const idx = /^(UNIQUE\s+)?KEY\s+`(\w+)`\s*\(([^)]*)\)/i.exec(line);
      const uniq = /^UNIQUE\s+KEY\s+`(\w+)`\s*\(([^)]*)\)/i.exec(line);
      if (uniq) {
        uniques.push({ name: uniq[1], cols: uniq[2].split(",").map((c) => c.trim().replace(/`/g, "").replace(/\s+(ASC|DESC)$/i, "")) });
        continue;
      }
      if (idx) {
        if (!/^UNIQUE/i.test(line)) {
          indexes.push({ name: idx[2], cols: idx[3].split(",").map((c) => c.trim().replace(/`/g, "").replace(/\s+(ASC|DESC)$/i, "")) });
        }
        continue;
      }
      if (/^(PRIMARY KEY|CONSTRAINT|FULLTEXT|SPATIAL)/i.test(line)) continue;

      const col = /^`(\w+)`\s+([A-Za-z]+(?:\([^)]*\))?)(.*)$/.exec(line);
      if (!col) continue;
      const rest = col[3] || "";
      const notNull = /\bNOT NULL\b/i.test(rest);
      const autoInc = /\bAUTO_INCREMENT\b/i.test(rest);
      const dm = /\bDEFAULT\s+('([^']*)'|[^\s,]+)/i.exec(rest);
      let def = null;
      if (dm) def = dm[2] !== undefined ? dm[2] : dm[1];
      columns.set(col[1], { type: col[2], notNull, autoInc, def });
    }
    tables.set(table, { columns, indexes, uniques });
  }
  return tables;
}

/**
 * 提取 `@default(...)` 内容。
 * 不能用 /@default\(([^)]*)\)/ —— 它对 `autoincrement()` / `now()` / `dbgenerated("...")`
 * 这类含括号的默认值会在第一个 `)` 处截断（实测得到 "autoincrement("，导致后续比较全错）。
 * 用括号配对扫描取完整内容。
 */
function extractDefault(attrs) {
  const start = attrs.indexOf("@default(");
  if (start < 0) return null;
  let i = start + "@default(".length;
  let depth = 1;
  let out = "";
  while (i < attrs.length && depth > 0) {
    const ch = attrs[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) break;
    }
    out += ch;
    i++;
  }
  return out;
}

// ---------------- 读取 Prisma schema ----------------
function parsePrismaSchema(text) {
  const models = new Map();
  const re = /model\s+(\w+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(text))) {
    const model = m[1];
    const body = m[2];
    const fields = new Map();
    const indexes = [];
    const uniques = [];
    let tableName = null;

    for (const rawLine of body.split(/\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("//")) continue;

      const mapM = /@@map\("(\w+)"\)/.exec(line);
      if (mapM) tableName = mapM[1];

      const idxM = /@@index\(\[([^\]]*)\](?:,[^)]*)?\)/.exec(line);
      if (idxM) {
        indexes.push({
          cols: idxM[1].split(",").map((c) => c.trim().split(/\s+/)[0]),
          raw: line,
        });
        continue;
      }
      const uniqM = /@@unique\(\[([^\]]*)\](?:,[^)]*)?\)/.exec(line);
      if (uniqM) {
        uniques.push({
          cols: uniqM[1].split(",").map((c) => c.trim().split(/\s+/)[0]),
          raw: line,
        });
        continue;
      }
      const idM = /@@id\(\[([^\]]*)\]\)/.exec(line);
      if (idM) continue;

      const fm = /^(\w+)\s+([A-Za-z][A-Za-z0-9_]*)(\[\])?(\?)?(.*)$/.exec(line);
      if (!fm) continue;
      const [, name, type, isList, isOpt, attrs] = fm;
      const colMap = /@map\("(\w+)"\)/.exec(attrs);
      const dbType = /@db\.(\w+)(?:\(([^)]*)\))?/.exec(attrs);
      const dmValue = extractDefault(attrs);
      fields.set(colMap ? colMap[1] : name, {
        fieldName: name,
        prismaType: type,
        list: !!isList,
        optional: !!isOpt,
        dbType: dbType ? dbType[1] : null,
        dbTypeArgs: dbType && dbType[2] ? dbType[2] : null,
        def: dmValue,
        attrs,
        isId: /@id\b/.test(attrs),
        unique: /@unique\b/.test(attrs),
      });
    }
    models.set(tableName ?? model, { model, fields, indexes, uniques });
  }
  return models;
}

// ---------------- 类型族归一化 ----------------
/** 把原 MySQL 类型归一化到「类型族 + 长度」 */
function normalizeMysqlType(t) {
  const m = /^(\w+)(?:\(([^)]*)\))?$/.exec(t);
  if (!m) return { family: t.toLowerCase(), size: null };
  const fam = m[1].toLowerCase();
  const size = m[2] ?? null;
  const map = {
    bigint: "bigint",
    int: "int",
    integer: "int",
    mediumint: "int",
    smallint: "smallint",
    tinyint: "smallint",
    varchar: "varchar",
    char: "char",
    text: "text",
    longtext: "text",
    mediumtext: "text",
    datetime: "datetime",
    timestamp: "datetime",
    date: "date",
    decimal: "decimal",
  };
  return { family: map[fam] ?? fam, size };
}

function normalizePrismaType(f) {
  const t = f.prismaType;
  const db = (f.dbType || "").toLowerCase();
  let family;
  if (t === "BigInt") family = "bigint";
  else if (t === "Int") {
    if (db === "smallint") family = "smallint";
    else if (db === "bigint") family = "bigint";
    else family = "int";
  } else if (t === "String") {
    if (db === "text") family = "text";
    else if (db === "char") family = "char";
    else family = "varchar";
  } else if (t === "DateTime") family = "datetime";
  else if (t === "Boolean") family = "boolean";
  else if (t === "Decimal") family = "decimal";
  else if (t === "Float") family = "float";
  else family = t.toLowerCase();

  let size = f.dbTypeArgs;
  if (size !== null) size = size.split(",")[0].trim();
  return { family, size: size || null };
}

// ---------------- 审计 ----------------
const findings = { p0: [], p1: [], p2: [], info: [], deliberate: [] };
const P0 = (msg) => findings.p0.push(msg);
const P1 = (msg) => findings.p1.push(msg);
const P2 = (msg) => findings.p2.push(msg);
const INFO = (msg) => findings.info.push(msg);

const CATEGORY_RE = /^(可空性不符|类型族不符|长度不符|默认值不同|默认值|多列)\s+(\w+\.\w+)/;

function main() {
  const sqlFiles = findSqlFiles();
  if (!sqlFiles.length) {
    console.log(`⚠️  未找到归档的原始 SQL（${ARCHIVE_DIR}），跳过审计。`);
    return;
  }
  if (!fs.existsSync(SCHEMA)) {
    console.error(`❌ 未找到 ${SCHEMA}`);
    process.exitCode = 1;
    return;
  }

  let ddlText = "";
  for (const f of sqlFiles) ddlText += "\n" + fs.readFileSync(f, "utf8");
  const mysql = parseMysqlDdl(ddlText);
  const prisma = parsePrismaSchema(fs.readFileSync(SCHEMA, "utf8"));

  console.log(`原始 DDL 表数: ${mysql.size}`);
  console.log(`Prisma 模型数: ${prisma.size}`);

  // 1. 表集合
  console.log("\n===== 1. 表集合 =====");
  const unregistered = [];
  for (const t of mysql.keys()) {
    if (prisma.has(t)) continue;
    if (EXPECTED_ABSENT[t]) continue;
    unregistered.push(t);
  }
  for (const t of prisma.keys()) {
    if (!mysql.has(t)) P0(`schema 有、原 DDL 无：${t}`);
  }
  console.log(`  原 DDL ${mysql.size} 张表 = 已入 schema ${prisma.size} 张 + 已登记范围外 ${Object.keys(EXPECTED_ABSENT).length} 张 + 未登记 ${unregistered.length} 张`);
  if (unregistered.length) {
    for (const t of unregistered) INFO(`原 DDL 有、schema 无且未登记：${t}`);
  }

  // 2~5. 逐表逐列
  for (const [tbl, ms] of mysql) {
    if (!prisma.has(tbl)) continue;
    const ps = prisma.get(tbl);
    const tblIssues = [];

    for (const [col, mc] of ms.columns) {
      const pf = ps.fields.get(col);
      if (!pf) {
        tblIssues.push(`P0 缺列 ${tbl}.${col} (${mc.type}${mc.notNull ? " NOT NULL" : ""})`);
        continue;
      }

      // 类型族
      const mn = normalizeMysqlType(mc.type);
      const pn = normalizePrismaType(pf);
      if (mn.family !== pn.family) {
        tblIssues.push(`P1 类型族不符 ${tbl}.${col}: MySQL ${mc.type} (${mn.family}) vs Prisma ${pf.prismaType}${pf.dbType ? "@db." + pf.dbType : ""} (${pn.family})`);
      } else if (mn.size && pn.size && mn.size !== pn.size) {
        tblIssues.push(`P1 长度不符 ${tbl}.${col}: MySQL ${mc.type} vs Prisma ${pf.prismaType}(${pf.dbTypeArgs})`);
      }

      // 可空性：DB NOT NULL ⟺ Prisma 非 optional
      if (mc.notNull && pf.optional) {
        tblIssues.push(`P1 可空性不符 ${tbl}.${col}: MySQL NOT NULL，Prisma 为可选(?)`);
      }
      if (!mc.notNull && !pf.optional) {
        tblIssues.push(`P1 可空性不符 ${tbl}.${col}: MySQL 可空，Prisma 为非可选`);
      }

      // 默认值
      const mDef = mc.def;
      const pDef = pf.def;
      const normDef = (v) => {
        if (v === null || v === undefined) return null;
        let s = String(v).replace(/^'(.*)'$/, "$1");
        if (/^null$/i.test(s)) return null;
        if (/^current_timestamp(\(\d*\))?$/i.test(s)) return "now";
        return s;
      };
      const a = normDef(mDef);
      const b = normDef(pDef !== null ? pDef.replace(/^"|"$/g, "") : null);
      // AUTO_INCREMENT 与 @default(autoincrement()) 语义等价，不做差异
      if (mc.autoInc && pDef && /autoincrement\(\)/.test(pDef)) {
        /* ok */
      } else if (a !== b) {
        if (a === null && b === null) {
          /* ok */
        } else if (a === null && b !== null) {
          tblIssues.push(`P2 默认值：schema 有 @default(${pDef})，原 DDL 无默认`);
        } else if (a !== null && b === null) {
          // 显式 0 默认在 Prisma 里可能未写
          tblIssues.push(`P2 默认值：原 DDL DEFAULT ${mDef}，schema 未声明`);
        } else if (a !== b) {
          tblIssues.push(`P2 默认值不同 ${tbl}.${col}: DDL ${mDef} vs schema ${pDef}`);
        }
      }
    }

    // 反向：schema 有、DDL 无
    for (const [col, pf] of ps.fields) {
      if (!ms.columns.has(col)) {
        tblIssues.push(`P1 多列 ${tbl}.${col}（schema 有，原 DDL 无）`);
      }
    }

    // 索引比对（按列组合，忽略名称差异）
    const key = (cols) => [...cols].sort().join(",");
    const mIdx = new Set(ms.indexes.map((i) => key(i.cols)));
    const pIdx = new Set(ps.indexes.map((i) => key(i.cols.map((c) => ps.fields.get(c)?.fieldName === c ? c : (ps.fields.get(c) ? c : c)))));
    // Prisma 的 @@index 用「字段名」而非列名，需要映射
    const pIdxByCol = new Set(
      ps.indexes.map((i) => {
        const cols = i.cols.map((fname) => {
          for (const [col, pf] of ps.fields) if (pf.fieldName === fname) return col;
          return fname;
        });
        return key(cols);
      })
    );
    for (const i of ms.indexes) {
      if (!pIdxByCol.has(key(i.cols))) {
        tblIssues.push(`P2 索引缺失 ${tbl}(${i.cols.join(",")}) 名称=${i.name}`);
      }
    }
    const mUniq = new Set(ms.uniques.map((i) => key(i.cols)));
    const pUniqByCol = new Set(
      ps.uniques.map((i) => {
        const cols = i.cols.map((fname) => {
          for (const [col, pf] of ps.fields) if (pf.fieldName === fname) return col;
          return fname;
        });
        return key(cols);
      })
    );
    // 字段级 @unique 也是单列唯一约束（默认索引名 <table>_<col>_key）
    for (const [col, pf] of ps.fields) {
      if (pf.unique) pUniqByCol.add(key([col]));
    }
    void mIdx;
    void pIdx;
    for (const u of ms.uniques) {
      if (!pUniqByCol.has(key(u.cols))) {
        tblIssues.push(`P1 唯一约束缺失 ${tbl}(${u.cols.join(",")}) 名称=${u.name}`);
      }
    }

    if (tblIssues.length) {
      for (const s of tblIssues) {
        const level = s.startsWith("P0") ? "P0" : s.startsWith("P1") ? "P1" : "P2";
        const body = s.slice(3).trim();
        const cm = CATEGORY_RE.exec(body);
        const reason = cm ? deliberateReason(cm[1], cm[2]) : null;
        const text = `${tbl}: ${body}`;
        if (reason) {
          findings.deliberate.push(`${text}\n        理由：${reason}`);
          continue;
        }
        if (level === "P0") P0(text);
        else if (level === "P1") P1(text);
        else P2(text);
      }
    }
  }

  // 输出
  const show = (title, arr, icon) => {
    console.log(`\n===== ${title}（${arr.length}）=====`);
    if (!arr.length) console.log("  （无）");
    else arr.forEach((x) => console.log(`  ${icon} ${x}`));
  };
  show("P0 表/列缺失（阻断）", findings.p0, "❌");
  show("P1 类型/可空/唯一约束差异", findings.p1, "⚠️");
  show("P2 默认值/索引差异", findings.p2, "·");
  show("INFO 需人工确认", findings.info, "ℹ️");

  console.log(`\n===== 已复核的有意差异（${findings.deliberate.length}）=====`);
  if (!findings.deliberate.length) console.log("  （无）");
  else findings.deliberate.forEach((x) => console.log(`  ✓ ${x}`));

  console.log(`\n===== 已登记的范围外表（${Object.keys(EXPECTED_ABSENT).length}）=====`);
  for (const [t, reason] of Object.entries(EXPECTED_ABSENT)) console.log(`  – ${t}：${reason}`);

  console.log(
    `\n================ 保真度审计：P0=${findings.p0.length} P1=${findings.p1.length} P2=${findings.p2.length} 已复核差异=${findings.deliberate.length} ================`
  );
  if (findings.p0.length || findings.p1.length) process.exitCode = 1;
}

main();
