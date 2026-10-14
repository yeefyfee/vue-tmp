import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
const JSZip = require("jszip");
import * as fs from "fs";
import * as path from "path";
// velocityjs 没有稳定的 TS 类型定义，使用 any
import * as Velocity from "velocityjs";

import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { formatDateTimeInZone } from "../common/utils/date.util";

import type { CodegenPreviewDto } from "./dto/codegen-preview.dto";
import type { GenConfigFormDto, FieldConfigDto } from "./dto/gen-config-form.dto";
import type { TableQueryDto } from "./dto/table-query.dto";

type TemplateName =
  | "API"
  | "API_TYPES"
  | "VIEW"
  | "Controller"
  | "Service"
  | "Module"
  | "PrismaModel"
  | "DtoQuery"
  | "DtoForm"
  | "DtoCreate"
  | "DtoUpdate";

interface TemplateConfig {
  templatePath: string;
  subpackageName: string;
  extension: string;
}

/**
 * 代码生成服务（PEL-10：TypeORM/MySQL → Prisma/PostgreSQL）
 *
 * ─────────────────────────────────────────────────────────────
 * 🔴 本次迁移改了什么
 *  ① **内省数据源**：`DataSource.query()`（MySQL 方言）→ `PrismaService.$queryRaw()` +
 *     PostgreSQL 系统目录。原 SQL 里以下写法在 PG 上**直接报错或不成立**：
 *     · `DATABASE()` → `current_schema()`
 *     · `b'0'` / `b'1'` → `0` / `1`（PG 的 `bit` 与 `smallint` 不可直接比较，会抛类型错误）
 *     · `LIMIT ? OFFSET ?` → `LIMIT $n OFFSET $m`（走 `Prisma.sql` 参数化，不是字符串拼接）
 *     · `DATE_FORMAT(...)` → 不适用（见 ②）
 *  ② **面向 PG 的字段能力差异（已按「保留键、置空值」处理，不再假装等价）**：
 *     · `tableComment` → `obj_description(oid,'pg_class')`，**PG 有等价物** ✅
 *     · `engine`（存储引擎）→ PG 无此概念 ⇒ `null`
 *     · `tableCollation`（表级排序规则）→ PG 的排序规则是**列级**而非表级 ⇒ `null`
 *     · `createTime`（建表时间）→ **PG 的系统目录不记录建表时间** ⇒ `null`。
 *       连带：原 `ORDER BY CREATE_TIME DESC` 失去依据，改为 `ORDER BY table_name ASC`
 *       以保证**分页结果确定**（否则翻页会漏/重）。
 *  ③ **`gen_table` / `gen_table_column` 读写改走 Prisma 模型**（`GenTable` / `GenTableColumn`），
 *     不再手写 SQL。用**基础客户端**（`this.prisma.genTable`）而非 `scoped` —— 代码生成配置属
 *     系统元数据，不该被数据权限过滤（`data-scope.extension` 也只在声明了 `@DataPermission`
 *     的模型上注入，此处从未声明）。
 *  ④ **类型映射口径从 MySQL 改为 PostgreSQL**，但**中间类型词表刻意保持不变**
 *     （`String`/`Integer`/`Long`/`Float`/`Double`/`BigDecimal`/`LocalDate`/`LocalDateTime`/
 *     `Boolean`/`byte[]`）。原因有二：
 *     · `gen_table_column.field_type` 会把该值**落库**，换词表等于让已保存的配置语义漂移；
 *     · 前端 curd 模板（`frontend/{ts,js}/index.curd*.vue.vm`，共 6 处）按 `javaType` 做控件推断，
 *       键名与取值都必须照旧。⇒ **`javaType` 这个键名是历史遗留**，虽已无 Java 语义，
 *       改名会让 6 个前端模板同时退化，故保留。
 *  ⑤ **`entity.ts.vm` → `prisma-model.prisma.vm`**：不再产出 TypeORM 实体（本项目模型由
 *     `schema.prisma` 单一来源），改为产出**可直接粘贴进 `schema.prisma` 的 `model` 块**，
 *     并带上 `@map` / `@@map` / `@db.*` 原生类型与字段注释。输出路径随之变为
 *     `packages/db/prisma/models/<table-kebab>.prisma`（CROSS-08 起 schema 归位于 packages/db）。
 *  ⑥ **`module.ts.vm` / `service.ts.vm` 改成 Prisma 形态**：去掉 `TypeOrmModule.forFeature`、
 *     `@InjectRepository`、`Repository`、`createQueryBuilder`，改为注入 `PrismaService`
 *     并构造 `Prisma.XxxWhereInput`。
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠️ 刻意保持的原有行为（不顺手统一）
 *  ① `packageName` **恒取默认值** `src`，忽略 DTO 与库中已有的 `package_name`
 *     ⇒ 前端把该字段改掉后，保存再读取会被抹回默认值。原实现即如此（保存时写的是
 *     默认值、读取时也返回默认值，两处都忽略入参），保留。
 *  ② `deleteGenConfig` 的查配置 SELECT **不带 `is_deleted` 过滤** ⇒ 对已逻辑删除的配置
 *     再删一次仍会命中并再次置 `is_deleted = 1`（幂等，无副作用）。
 *  ③ `saveGenConfig` 更新分支会把 `is_deleted` 置 `0` ⇒ **保存即「复活」**曾被删除的配置，
 *     原实现即如此（原 SQL 里写死 `is_deleted = b'0'`）。
 *
 * ─────────────────────────────────────────────────────────────
 * ✅ 顺带修掉的两处（都会导致 400/500，属确定性缺陷）
 *  ① `getGenConfig` 对未配置表的 `moduleName` 回退：原实现直接返回库里的 `module_name`，
 *     而该列**可空** ⇒ 返回 `null` 后 `getPreview()` 用它拼路径会得到字面量 `"null"`。
 *     现回退到默认模块名（与 `saveGenConfig` 的 `body.moduleName || 默认值` 口径一致）。
 *  ② `saveGenConfig` 写字段配置时 `field_name` 直接用 DTO 的值，但该列 **NOT NULL**
 *     ⇒ DTO 不带 `fieldName` 时会写入 `null` 并抛原始 Prisma 错误。现回退为
 *     「由 `columnName` 推导的驼峰名」，保证一定满足非空约束。
 */
@Injectable()
export class CodegenService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly codegenConfig = {
    downloadFileName: "niulai-admin-code.zip",
    backendAppName: "niulai-nest",
    frontendAppName: "vue3-element-admin",
    defaultAuthor: "niulaitech",
    defaultModuleName: "system",
    defaultPackageName: "src",
    defaultRemoveTablePrefix: "sys_",
  };

  private readonly templateConfigs: Record<TemplateName, TemplateConfig> = {
    API: { templatePath: "frontend/ts/api.ts.vm", subpackageName: "api", extension: ".ts" },
    API_TYPES: {
      templatePath: "frontend/ts/api-types.ts.vm",
      subpackageName: "types",
      extension: ".ts",
    },
    VIEW: { templatePath: "frontend/ts/index.vue.vm", subpackageName: "views", extension: ".vue" },
    Controller: {
      templatePath: "backend/controller.ts.vm",
      subpackageName: "",
      extension: ".ts",
    },
    Service: {
      templatePath: "backend/service.ts.vm",
      subpackageName: "",
      extension: ".ts",
    },
    Module: {
      templatePath: "backend/module.ts.vm",
      subpackageName: "",
      extension: ".ts",
    },
    /** 取代原 `Entity`（TypeORM 实体）—— 产出 Prisma `model` 块 */
    PrismaModel: {
      templatePath: "backend/prisma-model.prisma.vm",
      subpackageName: "models",
      extension: ".prisma",
    },
    DtoQuery: {
      templatePath: "backend/dto-query.ts.vm",
      subpackageName: "dto",
      extension: ".ts",
    },
    DtoForm: {
      templatePath: "backend/dto-form.ts.vm",
      subpackageName: "dto",
      extension: ".ts",
    },
    DtoCreate: {
      templatePath: "backend/dto-create.ts.vm",
      subpackageName: "dto",
      extension: ".ts",
    },
    DtoUpdate: {
      templatePath: "backend/dto-update.ts.vm",
      subpackageName: "dto",
      extension: ".ts",
    },
  };

  /**
   * 解析前端模板路径
   * @param templateName 模板标识
   * @param templateConfig 模板配置
   * @param frontendType 前端类型
   */
  private resolveFrontendTemplatePath(
    templateName: TemplateName,
    templateConfig: TemplateConfig,
    frontendType: string
  ) {
    if (frontendType !== "js") {
      return templateConfig.templatePath;
    }
    if (templateName === "API") {
      return "frontend/js/api.js.vm";
    }
    if (templateName === "VIEW") {
      return "frontend/js/index.js.vue.vm";
    }
    return templateConfig.templatePath;
  }

  /**
   * 解析前端文件后缀
   * @param templateName 模板标识
   * @param templateConfig 模板配置
   * @param frontendType 前端类型
   */
  private resolveFrontendExtension(
    templateName: TemplateName,
    templateConfig: TemplateConfig,
    frontendType: string
  ) {
    if (frontendType !== "js") {
      return templateConfig.extension;
    }
    if (templateName === "API") {
      return ".js";
    }
    return templateConfig.extension;
  }

  /**
   * 解析文件范围
   */
  private resolveScope(templateName: TemplateName) {
    if (templateName === "API" || templateName === "API_TYPES" || templateName === "VIEW") {
      return "frontend" as const;
    }
    return "backend" as const;
  }

  /**
   * 解析文件语言（扩展名）
   */
  private resolveLanguage(fileName: string) {
    const ext = path.extname(fileName);
    return ext.startsWith(".") ? ext.slice(1).toLowerCase() : "";
  }

  /**
   * 数据表分页列表（PostgreSQL 系统目录内省）
   */
  async getTablePage(query: TableQueryDto) {
    const { pageNum, pageSize, keywords } = query;

    const pageNumSafe = Number(pageNum) > 0 ? Number(pageNum) : 1;
    const pageSizeSafe = Number(pageSize) > 0 ? Number(pageSize) : 20;
    const offset = (pageNumSafe - 1) * pageSizeSafe;

    const conditions: Prisma.Sql[] = [
      Prisma.sql`t.table_schema = current_schema()`,
      // 只列基表（PG 的 information_schema 也会把视图/外部表列出来）
      Prisma.sql`t.table_type = 'BASE TABLE'`,
      // 排除代码生成元数据表；`_prisma_migrations` 是 Prisma 自身的迁移记录表
      // （迁移到 PG 后才出现的「基础设施表」，与 gen_* 同理，不该成为代码生成的候选）
      Prisma.sql`t.table_name NOT IN ('gen_table', 'gen_table_column', '_prisma_migrations')`,
    ];
    if (keywords) {
      // 旧库 MySQL 的 LIKE 默认不区分大小写；PG 的 LIKE 区分 ⇒ 用 ILIKE 对齐（清单约定 15）
      conditions.push(Prisma.sql`t.table_name ILIKE ${"%" + keywords + "%"}`);
    }
    const whereSql = Prisma.join(conditions, " AND ");

    const listSql = Prisma.sql`
      SELECT
        t.table_name AS "tableName",
        COALESCE(obj_description(pc.oid, 'pg_class'), '') AS "tableComment",
        NULL::text AS "tableCollation",
        NULL::text AS "engine",
        NULL::timestamptz AS "createTime",
        CASE WHEN g.id IS NULL THEN 0 ELSE 1 END AS "isConfigured"
      FROM information_schema.tables t
      JOIN pg_namespace pn ON pn.nspname = t.table_schema
      JOIN pg_class pc ON pc.relname = t.table_name AND pc.relnamespace = pn.oid
      LEFT JOIN gen_table g
        ON g.table_name = t.table_name AND g.is_deleted = 0
      WHERE ${whereSql}
      ORDER BY t.table_name ASC
      LIMIT ${pageSizeSafe} OFFSET ${offset}
    `;

    // `COUNT(1)` 在 PG 返回 bigint（Prisma 会给 JS BigInt）⇒ 显式 ::int 免去二次转换
    const totalSql = Prisma.sql`
      SELECT COUNT(1)::int AS total
      FROM information_schema.tables t
      WHERE ${whereSql}
    `;

    const [list, totalRows] = await Promise.all([
      this.prisma.$queryRaw<TableMetaRow[]>(listSql),
      this.prisma.$queryRaw<Array<{ total: number }>>(totalSql),
    ]);

    const total = Number(totalRows?.[0]?.total || 0);
    return {
      data: list,
      page: {
        pageNum: pageNumSafe,
        pageSize: pageSizeSafe,
        total,
      },
    };
  }

  async getGenConfig(tableName: string): Promise<GenConfigFormDto> {
    const config = await this.prisma.genTable.findFirst({
      where: { tableName, isDeleted: 0 },
    });

    if (config) {
      const fieldRows = await this.prisma.genTableColumn.findMany({
        where: { tableId: config.id },
        orderBy: { fieldSort: "asc" },
      });

      return {
        id: config.id.toString(),
        tableName: config.tableName,
        // ✅ 修复①：该列可空，原实现直接返回 null 会让 getPreview 拼出字面量 "null"
        moduleName: config.moduleName ?? this.codegenConfig.defaultModuleName,
        // ⚠️ 保持原行为①：恒取默认值，忽略库中 package_name
        packageName: this.codegenConfig.defaultPackageName,
        businessName: config.businessName,
        entityName: config.entityName,
        author: config.author,
        parentMenuId: config.parentMenuId ? config.parentMenuId.toString() : undefined,
        backendAppName: this.codegenConfig.backendAppName,
        frontendAppName: this.codegenConfig.frontendAppName,
        removeTablePrefix: this.codegenConfig.defaultRemoveTablePrefix,
        pageType: "classic",
        fieldConfigs: fieldRows.map((row) => this.toFieldConfig(row)),
      };
    }

    // 未配置时按表结构生成配置
    const tableComment = await this.getTableComment(tableName);
    const businessName = tableComment ? tableComment.replace("表", "").trim() : tableName;

    const removePrefix = this.codegenConfig.defaultRemoveTablePrefix;
    const processed =
      removePrefix && tableName.startsWith(removePrefix)
        ? tableName.slice(removePrefix.length)
        : tableName;
    const entityName = toPascalCase(processed);

    const columns = await this.getTableColumns(tableName);

    const fieldConfigs: FieldConfigDto[] = (columns || []).map((col, idx) => {
      const columnType = String(col.columnType || "");
      return {
        columnName: col.columnName,
        columnType,
        fieldName: toCamelCase(String(col.columnName)),
        fieldType: getFieldTypeByColumnType(columnType),
        fieldComment: col.columnComment,
        isRequired: String(col.isNullable).toUpperCase() === "YES" ? 0 : 1,
        formType: getDefaultFormTypeByColumnType(columnType),
        queryType: 1, // EQ
        maxLength: col.maxLength ? Number(col.maxLength) : undefined,
        fieldSort: idx + 1,
        isShowInList: 1,
        isShowInForm: 1,
        isShowInQuery: 0,
      };
    });

    return {
      tableName,
      businessName,
      moduleName: this.codegenConfig.defaultModuleName,
      packageName: this.codegenConfig.defaultPackageName,
      entityName,
      author: this.codegenConfig.defaultAuthor,
      backendAppName: this.codegenConfig.backendAppName,
      frontendAppName: this.codegenConfig.frontendAppName,
      removeTablePrefix: removePrefix,
      pageType: "classic",
      fieldConfigs,
    };
  }

  async saveGenConfig(tableName: string, body: GenConfigFormDto) {
    const now = new Date();

    // 注意：此处**不过滤** is_deleted —— 原实现即如此，已被逻辑删除的配置会被「复活」
    const existing = await this.prisma.genTable.findFirst({
      where: { tableName },
      select: { id: true },
    });

    const moduleName = body.moduleName || this.codegenConfig.defaultModuleName;
    const packageName = this.codegenConfig.defaultPackageName;
    const businessName = body.businessName || tableName;
    const entityName = body.entityName || toPascalCase(tableName);
    const author = body.author || this.codegenConfig.defaultAuthor;
    const parentMenuId = body.parentMenuId ? toBigInt(body.parentMenuId) : null;

    let configId: bigint;
    if (existing) {
      configId = existing.id;
      await this.prisma.genTable.update({
        where: { id: configId },
        data: {
          moduleName,
          packageName,
          businessName,
          entityName,
          author,
          parentMenuId,
          updateTime: now,
          // ⚠️ 保持原行为③：保存即把 is_deleted 置 0（复活）
          isDeleted: 0,
        },
      });
    } else {
      const created = await this.prisma.genTable.create({
        data: {
          tableName,
          moduleName,
          packageName,
          businessName,
          entityName,
          author,
          parentMenuId,
          createTime: now,
          updateTime: now,
          isDeleted: 0,
        },
        select: { id: true },
      });
      configId = created.id;
    }

    // 先清理旧字段配置，再写入新配置
    await this.prisma.genTableColumn.deleteMany({ where: { tableId: configId } });

    const fieldConfigs = body.fieldConfigs || [];
    if (fieldConfigs.length) {
      await this.prisma.genTableColumn.createMany({
        data: fieldConfigs.map((f, i) => {
          const columnType = String(f.columnType || "");
          return {
            tableId: configId,
            columnName: f.columnName || null,
            columnType: columnType || null,
            // ✅ 修复②：field_name 是 NOT NULL，DTO 缺省时不能写 null
            fieldName: f.fieldName || toCamelCase(String(f.columnName || "")) || `field${i + 1}`,
            fieldType: f.fieldType || getFieldTypeByColumnType(columnType),
            fieldSort: f.fieldSort ?? i + 1,
            fieldComment: f.fieldComment || null,
            maxLength: f.maxLength ?? null,
            isRequired: f.isRequired ?? 0,
            isShowInList: f.isShowInList ?? 0,
            isShowInForm: f.isShowInForm ?? 0,
            isShowInQuery: f.isShowInQuery ?? 0,
            queryType: f.queryType ?? 1,
            formType: f.formType ?? getDefaultFormTypeByColumnType(columnType),
            dictType: f.dictType ?? null,
            createTime: now,
            updateTime: now,
          };
        }),
      });
    }

    return true;
  }

  async deleteGenConfig(tableName: string) {
    // ⚠️ 保持原行为②：此处不带 is_deleted 过滤
    const config = await this.prisma.genTable.findFirst({
      where: { tableName },
      select: { id: true },
    });
    if (!config) {
      return true;
    }

    await this.prisma.genTableColumn.deleteMany({ where: { tableId: config.id } });
    await this.prisma.genTable.update({
      where: { id: config.id },
      data: { isDeleted: 1, updateTime: new Date() },
    });

    return true;
  }

  /**
   * 获取预览代码
   * @param tableName 表名
   * @param pageType 页面类型
   * @param type 前端类型
   */
  async getPreview(
    tableName: string,
    pageType: "classic" | "curd" = "classic",
    type: "ts" | "js" = "ts"
  ): Promise<CodegenPreviewDto[]> {
    const config = await this.getGenConfig(tableName);
    const fieldConfigs = config.fieldConfigs || [];
    const frontendType = type === "js" ? "js" : "ts";

    const previews: CodegenPreviewDto[] = [];
    for (const [templateName, templateConfig] of Object.entries(this.templateConfigs) as [
      TemplateName,
      TemplateConfig,
    ][]) {
      if (frontendType === "js" && templateName === "API_TYPES") {
        continue;
      }

      const effectiveTemplatePath = this.resolveFrontendTemplatePath(
        templateName,
        templateConfig,
        frontendType
      );
      const extension = this.resolveFrontendExtension(templateName, templateConfig, frontendType);
      const fileName = this.getFileName(
        config.entityName!,
        templateName,
        extension,
        config.tableName
      );
      const filePath = this.getFilePath(
        templateName,
        config.moduleName!,
        config.packageName!,
        templateConfig.subpackageName,
        config.entityName!
      );

      const content = this.renderTemplate(
        templateName,
        effectiveTemplatePath,
        templateConfig.subpackageName,
        config,
        fieldConfigs,
        pageType
      );
      previews.push({
        path: filePath,
        fileName,
        content,
        scope: this.resolveScope(templateName),
        language: this.resolveLanguage(fileName),
      });
    }

    return previews;
  }

  /**
   * 下载代码
   * @param tableNames 表名列表
   * @param pageType 页面类型
   * @param type 前端类型
   */
  async downloadZip(
    tableNames: string[],
    pageType: "classic" | "curd" = "classic",
    type: "ts" | "js" = "ts"
  ) {
    const zip = new JSZip();

    for (const tableName of tableNames) {
      const list = await this.getPreview(tableName, pageType, type);
      for (const item of list) {
        const zipPath = `${item.path}/${item.fileName}`.replace(/\\/g, "/");
        zip.file(zipPath, item.content);
      }
    }

    const buffer = await zip.generateAsync({ type: "nodebuffer" });
    return { fileName: this.codegenConfig.downloadFileName, buffer };
  }

  /**
   * 渲染模板
   * @param templateName 模板标识
   * @param templatePath 模板路径
   * @param subpackageName 子包名
   * @param config 生成配置
   * @param fieldConfigs 字段配置
   * @param pageType 页面类型
   */
  private renderTemplate(
    templateName: TemplateName,
    templatePath: string,
    subpackageName: string,
    config: GenConfigFormDto,
    fieldConfigs: FieldConfigDto[],
    pageType: "classic" | "curd"
  ) {
    let effectivePath = templatePath;
    if (templateName === "VIEW" && pageType === "curd") {
      if (effectivePath.endsWith("index.js.vue.vm")) {
        effectivePath = effectivePath.replace(
          "frontend/js/index.js.vue.vm",
          "frontend/js/index.curd.js.vue.vm"
        );
      } else if (effectivePath.endsWith("index.vue.vm")) {
        effectivePath = effectivePath.replace(
          "frontend/ts/index.vue.vm",
          "frontend/ts/index.curd.vue.vm"
        );
      }
    }

    const absTemplatePath = resolveBootTemplatePath(effectivePath);
    const tpl = fs.readFileSync(absTemplatePath, "utf8");

    const entityName = config.entityName || "";
    const bindMap: any = {
      packageName: config.packageName,
      moduleName: config.moduleName,
      subpackageName,
      // 按应用时区格式化（清单约定 9）：`new Date().getHours()` 依赖进程时区，UTC 机器会差 8 小时
      date: formatDateTimeInZone(new Date()),
      entityName,
      tableName: config.tableName,
      tableKebab: toKebabCase(config.tableName || entityName),
      author: config.author,
      entityLowerCamel: lowerFirst(entityName),
      entityKebab: toKebabCase(entityName),
      entityUpperSnake: toSnakeUpper(entityName),
      dollar: "$",
      businessName: config.businessName,
      entityComment: config.businessName,
      fieldConfigs: fieldConfigs.map((f) => this.toTemplateFieldConfig(f)),
    };

    return (Velocity as any).render(tpl, bindMap);
  }

  private toTemplateFieldConfig(field: FieldConfigDto) {
    const fieldType = field.fieldType || getFieldTypeByColumnType(field.columnType || "");
    const prisma = getPrismaTypeByColumnType(field.columnType || "", field.maxLength);
    return {
      ...field,
      // ⚠️ `javaType` 是**历史遗留键名**，前端 curd 模板（6 处）按它做控件推断；
      //    取值词表刻意保持不变，改名/换词表会同时打坏那 6 个模板。
      javaType: fieldType,
      fieldType,
      tsType: getTsTypeByFieldType(fieldType),
      prismaType: prisma.type,
      prismaAttr: prisma.attr || "",
      // 🔴 `prisma-model.prisma.vm` 的字段行**不允许以指令收尾**。
      //    velocityjs 会吃掉「紧跟在指令标记之后」的换行 —— 无论该指令是独立占行还是行内，
      //    也无论后面跟不跟 `##`。后果是字段注释被粘到上一个字段行尾（模型语法直接坏掉），
      //    而**单字段 / 无注释的配置看不出来**，极易漏检。
      //    ⇒ 三个可选片段在这里预拼成纯文本，模板里只做插值，一个指令都不留。
      //    注：`prismaAttr` 本身保留（不带前导空格），供断言与二次拼接使用。
      prismaComment: field.fieldComment || "",
      prismaOptional: field.isRequired === 1 ? "" : "?",
      prismaAttrPart: prisma.attr ? ` ${prisma.attr}` : "",
      prismaMapPart:
        field.columnName && field.columnName !== field.fieldName
          ? ` @map("${field.columnName}")`
          : "",
      // Velocity 模板在比较时使用字符串枚举名
      formType: getFormTypeName(field.formType),
      queryType: getQueryTypeName(field.queryType),
    };
  }

  /** `gen_table_column` 行 → 对外字段配置（Prisma 返回 camelCase，仅需补默认值） */
  private toFieldConfig(row: GenTableColumnRow): FieldConfigDto {
    const columnType = row.columnType || "";
    return {
      id: row.id?.toString(),
      columnName: row.columnName ?? undefined,
      columnType,
      fieldName: row.fieldName,
      fieldType: row.fieldType || getFieldTypeByColumnType(columnType),
      fieldComment: row.fieldComment ?? undefined,
      isShowInList: row.isShowInList ?? 0,
      isShowInForm: row.isShowInForm ?? 0,
      isShowInQuery: row.isShowInQuery ?? 0,
      isRequired: row.isRequired ?? 0,
      formType: row.formType ?? getDefaultFormTypeByColumnType(columnType),
      queryType: row.queryType ?? 1,
      maxLength: row.maxLength ?? undefined,
      fieldSort: row.fieldSort ?? undefined,
      dictType: row.dictType ?? undefined,
    };
  }

  /** 取表注释（PG 的注释不在 information_schema 里，走 obj_description） */
  private async getTableComment(tableName: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<Array<{ tableComment: string }>>`
      SELECT COALESCE(obj_description(pc.oid, 'pg_class'), '') AS "tableComment"
      FROM information_schema.tables t
      JOIN pg_namespace pn ON pn.nspname = t.table_schema
      JOIN pg_class pc ON pc.relname = t.table_name AND pc.relnamespace = pn.oid
      WHERE t.table_schema = current_schema() AND t.table_name = ${tableName}
      LIMIT 1
    `;
    return String(rows?.[0]?.tableComment || "");
  }

  /** 取列元数据（PG）。列注释同样走 pg_description 的 objsubid = 列序号 */
  private async getTableColumns(tableName: string): Promise<ColumnMetaRow[]> {
    return await this.prisma.$queryRaw<ColumnMetaRow[]>`
      SELECT
        c.column_name AS "columnName",
        c.data_type AS "columnType",
        COALESCE(pgd.description, '') AS "columnComment",
        c.is_nullable AS "isNullable",
        c.character_maximum_length AS "maxLength",
        c.ordinal_position AS "ordinalPosition"
      FROM information_schema.columns c
      JOIN pg_namespace pn ON pn.nspname = c.table_schema
      JOIN pg_class pc ON pc.relname = c.table_name AND pc.relnamespace = pn.oid
      LEFT JOIN pg_description pgd
        ON pgd.objoid = pc.oid AND pgd.objsubid = c.ordinal_position
      WHERE c.table_schema = current_schema() AND c.table_name = ${tableName}
      ORDER BY c.ordinal_position ASC
    `;
  }

  private getFileName(
    entityName: string,
    templateName: TemplateName,
    extension: string,
    tableName?: string
  ) {
    const entityKebab = toKebabCase(entityName);
    if (templateName === "PrismaModel") {
      const tableKebab = toKebabCase(tableName || entityName);
      return `${tableKebab}${extension}`;
    }
    if (templateName === "API") {
      return `index${extension}`;
    }
    if (templateName === "API_TYPES") {
      return `types${extension}`;
    }
    if (templateName === "VIEW") {
      return "index.vue";
    }
    if (templateName === "Controller") {
      return `${entityKebab}.controller${extension}`;
    }
    if (templateName === "Service") {
      return `${entityKebab}.service${extension}`;
    }
    if (templateName === "Module") {
      return `${entityKebab}.module${extension}`;
    }
    if (templateName === "DtoQuery") {
      return `${entityKebab}-query.dto${extension}`;
    }
    if (templateName === "DtoForm") {
      return `${entityKebab}-form.dto${extension}`;
    }
    if (templateName === "DtoCreate") {
      return `create-${entityKebab}.dto${extension}`;
    }
    if (templateName === "DtoUpdate") {
      return `update-${entityKebab}.dto${extension}`;
    }
    return `${entityName}${templateName}${extension}`;
  }

  private getFilePath(
    templateName: TemplateName,
    moduleName: string,
    packageName: string,
    subpackageName: string,
    entityName: string
  ) {
    const backend = this.codegenConfig.backendAppName;
    const frontend = this.codegenConfig.frontendAppName;

    if (templateName === "API" || templateName === "API_TYPES") {
      return path.join(frontend, "src", "api", moduleName, toKebabCase(entityName));
    }
    if (templateName === "VIEW") {
      return path.join(frontend, "src", subpackageName, moduleName, toKebabCase(entityName));
    }
    // Prisma 模型不是「某个业务模块下的文件」，而是 schema 的组成部分 ⇒ 落独立目录。
    // CROSS-08 起 schema 唯一存放于 packages/db/prisma/，生成片段随之归位（与 backendAppName 无关）
    if (templateName === "PrismaModel") {
      return path.join("packages", "db", "prisma", "models");
    }

    const featureDir = path.join(backend, "src", moduleName, toKebabCase(entityName));
    if (
      templateName === "DtoQuery" ||
      templateName === "DtoForm" ||
      templateName === "DtoCreate" ||
      templateName === "DtoUpdate"
    ) {
      return path.join(featureDir, "dto");
    }
    return featureDir;
  }
}

/** `information_schema.tables` 内省行（对外的表列表形状） */
export interface TableMetaRow {
  tableName: string;
  tableComment: string;
  /** PG 排序规则是列级而非表级 ⇒ 恒为 null（仅为对齐原接口形状而保留键） */
  tableCollation: string | null;
  /** PG 无存储引擎概念 ⇒ 恒为 null（仅为对齐原接口形状而保留键） */
  engine: string | null;
  /** PG 系统目录不记录建表时间 ⇒ 恒为 null；排序改按 table_name ASC 保证分页确定 */
  createTime: string | null;
  isConfigured: number;
}

/** `information_schema.columns` 内省行 */
export interface ColumnMetaRow {
  columnName: string;
  columnType: string;
  columnComment: string | null;
  isNullable: string;
  maxLength: number | null;
  ordinalPosition: number;
}

/** `gen_table_column` 的 Prisma 行形状（仅取本服务用到的列） */
export interface GenTableColumnRow {
  id: bigint;
  columnName: string | null;
  columnType: string | null;
  fieldName: string;
  fieldType: string | null;
  fieldSort: number | null;
  fieldComment: string | null;
  maxLength: number | null;
  isRequired: number | null;
  isShowInList: number | null;
  isShowInForm: number | null;
  isShowInQuery: number | null;
  queryType: number | null;
  formType: number | null;
  dictType: string | null;
}

function resolveBootTemplatePath(templatePath: string) {
  // 使用本地模板目录，模板路径：<project-root>/src/codegen/templates/<templatePath>
  const p = path.resolve(process.cwd(), "src", "codegen", "templates", templatePath);

  if (fs.existsSync(p)) {
    return p;
  }

  throw new Error(
    `Codegen template not found: '${templatePath}'. Expected location:\n  - ${p}\n\n` +
      `Please place templates under 'src/codegen/templates'.`
  );
}

function lowerFirst(s: string) {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function toCamelCase(s: string) {
  return String(s)
    .toLowerCase()
    .replace(/[_-](\w)/g, (_, c) => String(c).toUpperCase());
}

function toPascalCase(s: string) {
  const c = toCamelCase(s);
  return c ? c.charAt(0).toUpperCase() + c.slice(1) : c;
}

function toKebabCase(s: string) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

function toSnakeUpper(s: string) {
  return String(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toUpperCase();
}

function normalizeColumnType(columnType: string) {
  return String(columnType || "")
    .trim()
    .toLowerCase()
    .replace(/unsigned/g, "")
    .replace(/zerofill/g, "")
    .replace(/\(.*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * PostgreSQL `data_type` → 中间类型。
 *
 * ⚠️ 中间类型词表**刻意沿用**原 MySQL 版本（`String`/`Integer`/`Long`/… ），
 * 因为它会落库到 `gen_table_column.field_type`，且前端 curd 模板按 `javaType` 做控件推断。
 */
function getFieldTypeByColumnType(columnType: string) {
  const t = normalizeColumnType(columnType);
  switch (t) {
    case "character varying":
    case "character":
    case "text":
    case "json":
    case "jsonb":
    case "uuid":
    case "name":
    case "citext":
    case "inet":
    case "cidr":
    case "macaddr":
      return "String";
    case "bytea":
      return "byte[]";
    case "integer":
    case "smallint":
    case "serial":
    case "smallserial":
      return "Integer";
    case "bigint":
    case "bigserial":
    case "oid":
      return "Long";
    case "real":
      return "Float";
    case "double precision":
      return "Double";
    case "numeric":
    case "decimal":
    case "money":
      return "BigDecimal";
    case "date":
      return "LocalDate";
    case "timestamp with time zone":
    case "timestamp without time zone":
    case "time with time zone":
    case "time without time zone":
    case "interval":
      return "LocalDateTime";
    case "boolean":
    case "bit":
    case "bit varying":
      return "Boolean";
    default:
      return "String";
  }
}

/** 中间类型 → TypeScript 类型（供模板使用） */
function getTsTypeByFieldType(fieldType: string) {
  switch (fieldType) {
    case "String":
      return "string";
    case "Integer":
    case "Long":
    case "Float":
    case "Double":
    case "BigDecimal":
      return "number";
    case "Boolean":
      return "boolean";
    case "byte[]":
      return "Uint8Array";
    case "LocalDate":
    case "LocalDateTime":
      return "string";
    default:
      return "any";
  }
}

/**
 * PostgreSQL `data_type` → Prisma 标量类型 + 原生类型注解（供 `prisma-model.prisma.vm` 使用）。
 */
function getPrismaTypeByColumnType(
  columnType: string,
  maxLength?: number | null
): { type: string; attr?: string } {
  const t = normalizeColumnType(columnType);
  switch (t) {
    case "character varying":
      return { type: "String", attr: maxLength ? `@db.VarChar(${maxLength})` : undefined };
    case "character":
      return { type: "String", attr: maxLength ? `@db.Char(${maxLength})` : undefined };
    case "text":
      return { type: "String" };
    case "uuid":
      return { type: "String", attr: "@db.Uuid" };
    case "json":
      return { type: "Json", attr: "@db.Json" };
    case "jsonb":
      return { type: "Json", attr: "@db.JsonB" };
    case "bytea":
      return { type: "Bytes" };
    case "integer":
      return { type: "Int" };
    case "smallint":
      return { type: "Int", attr: "@db.SmallInt" };
    case "bigint":
      return { type: "BigInt" };
    case "real":
      return { type: "Float", attr: "@db.Real" };
    case "double precision":
      return { type: "Float" };
    case "numeric":
      return { type: "Decimal" };
    case "date":
      return { type: "DateTime", attr: "@db.Date" };
    case "timestamp with time zone":
      return { type: "DateTime", attr: "@db.Timestamptz(3)" };
    case "timestamp without time zone":
      return { type: "DateTime", attr: "@db.Timestamp(3)" };
    case "time without time zone":
      return { type: "DateTime", attr: "@db.Time" };
    case "boolean":
      return { type: "Boolean" };
    default:
      return { type: "String" };
  }
}

function getDefaultFormTypeByColumnType(columnType: string) {
  const t = normalizeColumnType(columnType);
  if (t === "date") return 8;
  if (t.startsWith("timestamp") || t.startsWith("time ")) return 9;
  return 1;
}

function getFormTypeName(value?: number) {
  switch (value) {
    case 1:
      return "INPUT";
    case 2:
      return "SELECT";
    case 3:
      return "RADIO";
    case 4:
      return "CHECK_BOX";
    case 5:
      return "INPUT_NUMBER";
    case 6:
      return "SWITCH";
    case 7:
      return "TEXT_AREA";
    case 8:
      return "DATE";
    case 9:
      return "DATE_TIME";
    case 10:
      return "HIDDEN";
    default:
      return "INPUT";
  }
}

function getQueryTypeName(value?: number) {
  switch (value) {
    case 1:
      return "EQ";
    case 2:
      return "LIKE";
    case 3:
      return "IN";
    case 4:
      return "BETWEEN";
    case 5:
      return "GT";
    case 6:
      return "GE";
    case 7:
      return "LT";
    case 8:
      return "LE";
    case 9:
      return "NE";
    case 10:
      return "LIKE_LEFT";
    case 11:
      return "LIKE_RIGHT";
    default:
      return "EQ";
  }
}
