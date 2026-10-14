import { SetMetadata } from "@nestjs/common";

export const DATA_PERMISSION_KEY = "data_permission";

/** 数据权限装饰器配置 */
export interface DataPermissionConfig {
  // ─────────── Prisma 形态（PEL-10c 起，新代码用这组） ───────────
  /** 施加数据权限的 Prisma 模型名（如 "SysUser"）。不声明则本请求不注入 */
  model?: string;
  /** 部门维度字段（Prisma 字段名，如 "deptId"） */
  deptField?: string;
  /** 归属人维度字段（Prisma 字段名，如 "createBy"） */
  ownerField?: string;

  // ─────────── TypeORM 遗留形态（迁移完成后删除） ───────────
  /** @deprecated 仅 TypeORM QueryBuilder 插件使用 */
  deptAlias?: string;
  /** @deprecated 仅 TypeORM QueryBuilder 插件使用 */
  deptIdColumnName?: string;
  /** @deprecated 仅 TypeORM QueryBuilder 插件使用 */
  userAlias?: string;
  /** @deprecated 仅 TypeORM QueryBuilder 插件使用 */
  userIdColumnName?: string;
}

/**
 * 数据权限装饰器
 *
 * 迁移期两套并存：Prisma 扩展读 `model/deptField/ownerField`，
 * TypeORM 插件读 `deptAlias/*ColumnName`。给同一个 handler 同时写两组即可，
 * TypeORM 摘除后把遗留字段一并删掉。
 */
export function DataPermission(config?: DataPermissionConfig): MethodDecorator & ClassDecorator {
  return (
    target: any,
    propertyKey?: string | symbol,
    descriptor?: TypedPropertyDescriptor<any>
  ) => {
    const finalConfig: DataPermissionConfig = {
      model: config?.model,
      deptField: config?.deptField,
      ownerField: config?.ownerField,
      deptAlias: config?.deptAlias,
      deptIdColumnName: config?.deptIdColumnName ?? "dept_id",
      userAlias: config?.userAlias,
      userIdColumnName: config?.userIdColumnName ?? "create_by",
    };

    if (descriptor) {
      SetMetadata(DATA_PERMISSION_KEY, finalConfig)(target, propertyKey, descriptor);
    } else {
      SetMetadata(DATA_PERMISSION_KEY, finalConfig)(target);
    }
  };
}

export const SKIP_DATA_PERMISSION_KEY = "skip_data_permission";

/** 跳过数据权限装饰器 */
export function SkipDataPermission(): MethodDecorator {
  return SetMetadata(SKIP_DATA_PERMISSION_KEY, true);
}
