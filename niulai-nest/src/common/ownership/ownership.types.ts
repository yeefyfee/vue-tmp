/**
 * P0-07-03 归属链越权防护基座 —— 类型定义
 *
 * 归属链模型（权威口径，见 packages/db/prisma/schema.prisma）：
 *  - `customer`（客户 / 萌主档案）1 — N `pet`（宠物）；
 *  - `pet.ownerCustomerId`（NOT NULL）是宠物**唯一现行主人**，为权威归属；
 *  - `customer_pet` 是「萌主-宠物归属关系」关联表，与 `pet.ownerCustomerId`
 *    保持**强一致**（绑定仅当 owner 与客户一致时成立，见 CustomerPetService）；
 *  - 业务实体（订单 / 健康记录 / 体重 / 转移申请…）通过 `customerId` / `petId`
 *    挂到归属链上，因此「归属链校验」是把「跨租户 / 跨客户越权访问」拦在
 *    业务入口的统一关口。
 *
 * 本基座**不产响应信封**（envelope 由全局 ResponseInterceptor 负责），只产
 * 「断言通过 / 抛业务异常」两种结果；异常经 BusinessException 走统一信封。
 *
 * 关键口径：
 *  1. **fail-closed**：实体缺失、跨租户、归属不匹配一律抛业务异常，绝不静默放行；
 *  2. **数据访问一律 `prisma.scoped.<model>`**（租户隔离 + 数据权限扩展链，
 *     fail-closed），禁止裸 prisma 访问租户业务表；
 *  3. **BigInt 出参字符串化**（移植铁律 1）：租户 ID 等 bigint 字段对外统一 string。
 *
 * 本文件为「纯类型 + 常量」，可被 controller / service / guard 任意引入，无副作用。
 */

/**
 * 已建模的归属实体类型（新增业务实体、且已在 Prisma schema 落地时在此追加）。
 *
 * 注意：这只是「已知取值清单」，供 IDE 补全与文档使用；类型本身允许扩展字符串
 * （见 {@link OwnershipEntityType}），以免 P0-08+（订单 / 寄养 / 支付）新实体
 * 落地时被迫改动本基座。
 */
export const OWNERSHIP_ENTITY_TYPES = [
  "pet",
  "customer",
  "customer_pet",
  "pet_transfer_request",
  "health_record",
  "weight_record",
] as const;

/** 已建模归属实体类型（字面量联合） */
export type OwnershipKnownEntityType = (typeof OWNERSHIP_ENTITY_TYPES)[number];

/**
 * 归属实体类型（可扩展字符串）。
 *
 * 采用宽松字符串语义：未在 {@link OWNERSHIP_ENTITY_MODEL} 声明的实体（如尚未落地的
 * `order`）在 {@link OwnershipService.assertTenantScoped} 内 **fail-closed 拒绝**
 * （抛 `OWNERSHIP_ENTITY_TYPE_UNSUPPORTED`），而绝不会误放行。
 */
export type OwnershipEntityType = OwnershipKnownEntityType | string;

/** Prisma `PrismaService.scoped` 客户端上的模型键（与扩展链属性名一致） */
export type OwnershipModelKey =
  "customer" | "customerPet" | "pet" | "petTransferRequest" | "healthRecord" | "weight";

/**
 * 归属实体类型 → Prisma scoped 模型键。
 *
 * 未列出的实体视为「尚未建模」，基座对其 fail-closed 拒绝。
 * 单一路由：新增实体时若已落 schema，只需在此补一行映射即可被基座覆盖。
 */
export const OWNERSHIP_ENTITY_MODEL: Readonly<Record<string, OwnershipModelKey>> = {
  customer: "customer",
  customer_pet: "customerPet",
  pet: "pet",
  pet_transfer_request: "petTransferRequest",
  health_record: "healthRecord",
  weight_record: "weight",
};

/**
 * 操作者（当前请求）上下文快照，用于断言结果与审计上下文。
 *
 * 全部取自 `RequestContext`（JWT 派生，**不接受请求参数传入**）：
 *  - `tenantId`：租户上下文（平台账号 / 未登录为 null）；
 *  - `userId`：操作人（供审计打点）；
 *  - `storeId`：门店上下文（`X-Store-Id` 请求头，可空）。
 */
export interface OwnershipActorContext {
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly storeId: string | null;
}

/**
 * 归属断言结果（断言成功时返回；失败时抛 BusinessException，故 `ok` 恒为 true）。
 *
 * 之所以仍返回结构化结果而非 `void`：便于调用方在成功路径上直接取得
 * `ownerCustomerId` 与操作者上下文，避免二次查询、也便于审计打点。
 */
export interface OwnershipAssertionResult {
  /** 断言是否通过（当前实现恒为 true —— 失败即抛异常） */
  readonly ok: boolean;
  /** 被校验的实体类型 */
  readonly entityType: OwnershipEntityType;
  /** 被校验的实体 id */
  readonly entityId: string;
  /** 命中的归属客户 id（仅 pet 相关断言会填充；其它实体为 null） */
  readonly ownerCustomerId: string | null;
  /** 操作者上下文快照 */
  readonly actor: OwnershipActorContext;
}

/**
 * 宠物归属解析结果（{@link OwnershipService.resolvePetOwnership}）。
 *
 * `pet` 为该宠物在**当前租户内、未软删**的行（结构上是 Prisma pet 行的子集）；
 * `ownerCustomerId` 即权威现行主人。
 */
export interface ResolvedPetOwnership {
  readonly pet: OwnershipPetRow;
  readonly ownerCustomerId: string;
}

/** 归属链所需的最小宠物行视图（结构兼容 Prisma `Pet` 行） */
export interface OwnershipPetRow {
  readonly id: string;
  readonly name: string;
  /** 租户 id（Prisma bigint，出参由基座字符串化） */
  readonly tenantId: bigint | string;
  readonly storeId: string | null;
  /** 权威现行主人（customer.id） */
  readonly ownerCustomerId: string;
}

/**
 * 归属链快照（宠物 → 客户），用于日志 / 审计上下文。
 *
 * - `pet` / `customer` 中的 `tenantId` 已按移植铁律 1 **字符串化**（BigInt → string）；
 * - `customer` 可能为 null（`pet.ownerCustomerId` 指向的客户缺失 / 已软删 —— 脏数据），
 *   此时仍返回快照（不抛错），由调用方按 `customer === null` 判定数据完整性；
 * - `link` 刻画 `customer_pet` 关联与权威归属的一致性：
 *    `exists` = 是否存在 active 关联；`consistent` = 关联是否全部指向权威主人。
 */
export interface OwnershipChainSnapshot {
  readonly pet: {
    readonly id: string;
    readonly name: string;
    /** BigInt → string */
    readonly tenantId: string;
    readonly storeId: string | null;
    readonly ownerCustomerId: string;
  };
  readonly customer: {
    readonly id: string;
    readonly name: string;
    readonly mobile: string;
    /** BigInt → string */
    readonly tenantId: string;
  } | null;
  readonly link: {
    readonly exists: boolean;
    readonly consistent: boolean;
  };
}
