import { RequestContext } from "../context/request-context";
import { toBigInt } from "./prisma-ids";

/**
 * 审计字段填充工具（替代原 TypeORM `AuditSubscriber`）
 *
 * 背景：原 `AuditSubscriber` 监听实体 `beforeInsert` / `beforeUpdate`，
 * 自动填充 `createBy` / `updateBy` / `createTime` / `updateTime`。Prisma 没有订阅器，
 * 换引擎后这些字段不会再有谁自动填 —— 而列都可空，漏填**不会报错**，
 * 只会表现为「列表里创建时间是空的」，属最难查的一类静默缺陷。
 *
 * 因此这里把原订阅器的语义变成**显式函数**，写入时必须包一层：
 * ```ts
 * await this.prisma.sysDept.create({ data: { ...dto, ...auditOnCreate(createBy) } });
 * ```
 * 显式化的好处：可 grep、可单测，且每个模块的真库校验都会断言这几个列非空。
 *
 * 语义对齐原订阅器（`audit.subscriber.ts`）：
 *  - 时间：一律填当前时间（原逻辑只在为空时填；新建场景恒为空，等价）
 *  - 操作人：**上下文用户优先**，其次才用调用方显式传入的值（原逻辑 `if (userId) entity.createBy = userId` 即覆盖）
 *  - 无上下文且无显式值时**不写入该字段**（保持 NULL，与原逻辑「不 set 就不出现在 INSERT」一致）
 *
 * ⚠️ 原订阅器只对 `save()` 生效，对 `repository.update()` / `delete()` **不生效**；
 *    走直接 UPDATE 的路径（如部门编辑、逻辑删除）需由调用方自行填 `updateTime`，不要误以为已自动处理。
 */

/** 当前请求上下文中的操作用户（BigInt），无上下文返回 null */
export function currentAuditUserId(): bigint | null {
  return toBigInt(RequestContext.getUserId());
}

/** 新增时可写入的审计字段 */
export interface AuditCreateFields {
  createTime: Date;
  updateTime: Date;
  createBy?: bigint;
  updateBy?: bigint;
}

/** 更新时可写入的审计字段 */
export interface AuditUpdateFields {
  updateTime: Date;
  updateBy?: bigint;
}

/**
 * 新增场景的审计字段。
 * @param explicitCreateBy 调用方显式给出的创建人（上下文用户优先，与其对齐原订阅器语义）
 * @param now 便于测试注入固定时间
 */
export function auditOnCreate(
  explicitCreateBy?: bigint | null,
  now: Date = new Date()
): AuditCreateFields {
  const operator = currentAuditUserId() ?? explicitCreateBy ?? null;
  const fields: AuditCreateFields = { createTime: now, updateTime: now };
  if (operator !== null) {
    fields.createBy = operator;
    fields.updateBy = operator;
  }
  return fields;
}

/**
 * 更新场景的审计字段。
 * @param explicitUpdateBy 调用方显式给出的修改人（上下文用户优先）
 * @param now 便于测试注入固定时间
 */
export function auditOnUpdate(
  explicitUpdateBy?: bigint | null,
  now: Date = new Date()
): AuditUpdateFields {
  const operator = currentAuditUserId() ?? explicitUpdateBy ?? null;
  const fields: AuditUpdateFields = { updateTime: now };
  if (operator !== null) {
    fields.updateBy = operator;
  }
  return fields;
}
