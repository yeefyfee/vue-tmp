import { Injectable } from "@nestjs/common";

import { BusinessException } from "../exceptions/business.exception";
import { PrismaService } from "../prisma/prisma.service";
import { RequestContext } from "../context/request-context";

import { OwnershipErrorCode } from "./ownership.error-codes";
import {
  OWNERSHIP_ENTITY_MODEL,
  type OwnershipActorContext,
  type OwnershipAssertionResult,
  type OwnershipChainSnapshot,
  type OwnershipEntityType,
  type OwnershipModelKey,
  type ResolvedPetOwnership,
} from "./ownership.types";

/**
 * P0-07-03 归属链越权防护基座 —— OwnershipService
 *
 * 目标：把「跨租户 / 跨客户越权访问」收敛到一处可复用的**归属链校验**入口，
 * 让宠物详情 / 健康档案 / 体重 / 转移申请 / 订单等端点无需重复手写归属判断。
 *
 * 设计要点：
 *  1. **fail-closed**：所有断言在实体缺失、跨租户、归属不匹配时抛 BusinessException，
 *     绝不静默放行（跨租户在 scoped 视角折叠为「不存在」，防资源枚举）。
 *  2. **数据访问一律 `prisma.scoped.<model>`**：租户隔离 + 数据权限扩展链自动注入
 *     tenantId 条件（fail-closed），RLS 兜底；**绝不**从请求参数读取 tenantId——
 *     归属/租户一律以 `RequestContext`（JWT 派生）为锚点。
 *  3. **权威归属**：以 `pet.ownerCustomerId` 为准，`customer_pet` 关联仅作一致性校验。
 *  4. **纯查询、无写副作用**：本基座只读，不做任何落库；断言成功返回结构化结果。
 *  5. **不侵入业务**：本基座不修改任何既有端点；业务按需 opt-in 接入
 *     （见文末「用法示例」与「后续接入清单」）。
 *
 * ── 用法示例 ─────────────────────────────────────────────
 * ```ts
 * // 1) 直接注入 service，在业务入口显式断言（推荐，语义最清晰）
 * @Injectable()
 * export class HealthRecordService {
 *   constructor(private readonly ownership: OwnershipService) {}
 *
 *   async detail(recordId: string) {
 *     // 健康记录挂 petId，先断言「宠物在本租户可达」
 *     const record = await this.prisma.scoped.healthRecord.findFirst({ where: { id: recordId } });
 *     await this.ownership.assertTenantScoped("pet", record.petId);
 *     ...
 *   }
 * }
 *
 * // 2) 或挂守卫，控制器方法上 opt-in（本轮不接业务，仅提供实现）
 * @Get(":id")
 * @RequireOwnership({ entity: "pet", idParam: "id" })
 * detail(@Param("id") id: string) { ... }
 *
 * // 3) 宠主端：确认「该宠物归属某客户」（owner 模式）
 * await this.ownership.assertCustomerOwnsPet(customerId, petId);
 *
 * // 4) 宠主端 / 员工端复用：归属链可达性（owner 或其关联客户）
 * await this.ownership.assertPetAccessibleByCustomer(customerId, petId);
 *
 * // 5) 审计上下文快照（BigInt 已字符串化）
 * const chain = await this.ownership.resolveOwnershipChain(petId);
 * logger.log({ petId, owner: chain.customer?.id, link: chain.link });
 * ```
 *
 * ── 后续接入清单（逐端点 opt-in；本轮不接）─────────────────
 *  | 端点（示例）                                   | 归属链校验                                      |
 *  |------------------------------------------------|-------------------------------------------------|
 *  | GET /pets/:id（宠物详情）                        | assertTenantScoped("pet", id)                    |
 *  | PUT/PATCH /pets/:id（宠物更新）                  | assertCustomerOwnsPet(body.ownerCustomerId, id)* |
 *  | DELETE /pets/:id（软删）                         | assertTenantScoped("pet", id)                    |
 *  | GET/POST /pets/:id/health-records（健康档案）     | assertTenantScoped("pet", id)                    |
 *  | GET/POST /pets/:id/weights（体重曲线）            | assertTenantScoped("pet", id)                    |
 *  | GET /customers/:id/pets（客户宠物列表）           | assertTenantScoped("customer", id)               |
 *  | POST /customers/:id/pets（绑定）                 | assertCustomerOwnsPet(id, body.petId)            |
 *  | GET/POST /pet-transfer-requests（转移申请）       | assertCustomerOwnsPet(fromCustomerId, petId)     |
 *  | 订单 / 寄养 / 支付（P0-08+，实体落地后）           | 先 assertTenantScoped 再挂对应归属断言            |
 *  | 宠主端（X-Client: owner）任意宠物资源            | assertPetAccessibleByCustomer(customerId, petId) |
 *
 *  * 宠物主人变更的唯一合法通道是「转移申请 + 审批」；此处 ownerCustomerId 变更校验
 *    仅为防御性断言，不得作为绕过审批流的写入通道。
 */
@Injectable()
export class OwnershipService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 断言实体在**当前租户内可见**（fail-closed）。
   *
   * 依赖 `prisma.scoped` 的租户隔离扩展：跨租户实体会被扩展层自动折叠为
   * 「查不到」，因此「不存在」与「跨租户」在本方法出口**不可区分**（同一错误码，
   * 防资源枚举）。未软删（`deletedAt: null`）为可见性前提。
   *
   * @param entity   归属实体类型（须已在 {@link OWNERSHIP_ENTITY_MODEL} 声明映射）
   * @param entityId 实体 id（uuid 形态字符串）
   * @throws BusinessException `ENTITY_ID_REQUIRED` / `ENTITY_TYPE_UNSUPPORTED` / `ENTITY_NOT_FOUND`
   */
  async assertTenantScoped(
    entity: OwnershipEntityType,
    entityId: string
  ): Promise<OwnershipAssertionResult> {
    const id = normalizeRequiredId(entityId);
    const modelKey: OwnershipModelKey | undefined = OWNERSHIP_ENTITY_MODEL[entity];
    if (!modelKey) {
      throw new BusinessException(OwnershipErrorCode.ENTITY_TYPE_UNSUPPORTED);
    }

    const delegate = resolveScopedDelegate(this.prisma, modelKey);
    const row = await delegate.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!row) {
      throw new BusinessException(OwnershipErrorCode.ENTITY_NOT_FOUND);
    }

    return this.buildResult(entity, id, null);
  }

  /**
   * 解析宠物归属：返回宠物行 + 权威现行主人 `ownerCustomerId`。
   *
   * @throws BusinessException `ENTITY_ID_REQUIRED` / `PET_NOT_FOUND`（不存在或跨租户）
   */
  async resolvePetOwnership(petId: string): Promise<ResolvedPetOwnership> {
    const id = normalizeRequiredId(petId);
    const pet = await this.prisma.scoped.pet.findFirst({ where: { id, deletedAt: null } });
    if (!pet) {
      throw new BusinessException(OwnershipErrorCode.PET_NOT_FOUND);
    }
    return { pet, ownerCustomerId: pet.ownerCustomerId };
  }

  /**
   * 断言「某客户是该宠物的主人」（以 `pet.ownerCustomerId` 为准）。
   *
   * 额外做 `customer_pet` 关联一致性校验：若该宠物存在指向**其它客户**的
   * active 关联（历史脏数据），则判为归属链不一致并拒绝（fail-closed）。
   * 关联缺失（无 active 关联）**不算不一致** —— 归属以宠物主档为准，关联表为
   * 可选的从属关系。
   *
   * @throws BusinessException `ENTITY_ID_REQUIRED` / `PET_NOT_FOUND` /
   *         `CUSTOMER_PET_MISMATCH`（归属不符）/ `CUSTOMER_PET_INCONSISTENT`（关联冲突）
   */
  async assertCustomerOwnsPet(
    customerId: string,
    petId: string
  ): Promise<OwnershipAssertionResult> {
    const cid = normalizeRequiredId(customerId);
    const pid = normalizeRequiredId(petId);

    const { ownerCustomerId } = await this.resolvePetOwnership(pid);
    if (ownerCustomerId !== cid) {
      throw new BusinessException(OwnershipErrorCode.CUSTOMER_PET_MISMATCH);
    }

    // 一致性校验：存在指向其它客户的 active 关联 → 归属链不一致
    const conflict = await this.prisma.scoped.customerPet.findFirst({
      where: { petId: pid, deletedAt: null, customerId: { not: cid } },
      select: { id: true },
    });
    if (conflict) {
      throw new BusinessException(OwnershipErrorCode.CUSTOMER_PET_INCONSISTENT);
    }

    return this.buildResult("pet", pid, ownerCustomerId);
  }

  /**
   * 断言「某客户对某宠物的归属链**可达**」（供宠主端 / 员工端复用）。
   *
   * 可达定义（比 {@link assertCustomerOwnsPet} 略宽）：
   *  1. 该客户是宠物现行主人（`pet.ownerCustomerId === customerId`）；或
   *  2. 存在 `(customerId, petId)` 的 active 归属关联（`customer_pet`）。
   *
   * 之所以允许「有关联即达」：员工端代客操作、或归属变更过渡期，客户与宠物可能
   * 存在合法关联但非当前主人；本方法只做**可达性**判断，不改变权威归属语义。
   * 严格「本人即主人」的写操作请改用 {@link assertCustomerOwnsPet}。
   *
   * @throws BusinessException `ENTITY_ID_REQUIRED` / `PET_NOT_FOUND` / `CUSTOMER_PET_MISMATCH`
   */
  async assertPetAccessibleByCustomer(
    customerId: string,
    petId: string
  ): Promise<OwnershipAssertionResult> {
    const cid = normalizeRequiredId(customerId);
    const pid = normalizeRequiredId(petId);

    const { ownerCustomerId } = await this.resolvePetOwnership(pid);
    if (ownerCustomerId === cid) {
      return this.buildResult("pet", pid, ownerCustomerId);
    }

    const link = await this.prisma.scoped.customerPet.findFirst({
      where: { petId: pid, customerId: cid, deletedAt: null },
      select: { id: true },
    });
    if (link) {
      return this.buildResult("pet", pid, ownerCustomerId);
    }

    throw new BusinessException(OwnershipErrorCode.CUSTOMER_PET_MISMATCH);
  }

  /**
   * 解析「宠物 → 客户」归属链快照（用于日志 / 审计上下文）。
   *
   * 与断言方法不同，本方法**容忍脏数据**：`ownerCustomerId` 指向的客户缺失 /
   * 已软删时 `customer` 返回 null（不抛错），由调用方按完整性判定处理。
   * 但宠物本身不存在 / 跨租户仍 fail-closed 抛 `PET_NOT_FOUND`。
   *
   * 输出中 `pet.tenantId` / `customer.tenantId`（Prisma bigint）已**字符串化**。
   *
   * @throws BusinessException `ENTITY_ID_REQUIRED` / `PET_NOT_FOUND`
   */
  async resolveOwnershipChain(petId: string): Promise<OwnershipChainSnapshot> {
    const pid = normalizeRequiredId(petId);
    const { pet, ownerCustomerId } = await this.resolvePetOwnership(pid);

    const customer = await this.prisma.scoped.customer.findFirst({
      where: { id: ownerCustomerId, deletedAt: null },
    });

    const links = await this.prisma.scoped.customerPet.findMany({
      where: { petId: pid, deletedAt: null },
      select: { customerId: true },
    });
    const exists = links.length > 0;
    const consistent = exists && links.every((link) => link.customerId === ownerCustomerId);

    return {
      pet: {
        id: pet.id,
        name: pet.name,
        tenantId: String(pet.tenantId),
        storeId: pet.storeId ?? null,
        ownerCustomerId,
      },
      customer: customer
        ? {
            id: customer.id,
            name: customer.name,
            mobile: customer.mobile,
            tenantId: String(customer.tenantId),
          }
        : null,
      link: { exists, consistent },
    };
  }

  // ─────────────────────────────────────────────
  // 内部工具
  // ─────────────────────────────────────────────

  /** 组装断言结果（含操作者上下文快照） */
  private buildResult(
    entityType: OwnershipEntityType,
    entityId: string,
    ownerCustomerId: string | null
  ): OwnershipAssertionResult {
    return {
      ok: true,
      entityType,
      entityId,
      ownerCustomerId,
      actor: this.currentActor(),
    };
  }

  /** 从 RequestContext（JWT 派生）读取操作者上下文；不接受请求参数传入 */
  private currentActor(): OwnershipActorContext {
    return {
      tenantId: RequestContext.getTenantId(),
      userId: RequestContext.getUserId(),
      storeId: RequestContext.getStoreId(),
    };
  }
}

/** `prisma.scoped.<model>` 委托的最小结构（用于泛型实体查找，避免强类型耦合） */
interface ScopedModelDelegate {
  findFirst(args: {
    where: Record<string, unknown>;
    select?: Record<string, unknown>;
    orderBy?: unknown;
  }): Promise<Record<string, unknown> | null>;
}

/**
 * 从 `PrismaService.scoped` 上按模型键取委托。
 *
 * 未知模型（尚未建模 / 未登记）→ fail-closed 抛 `ENTITY_TYPE_UNSUPPORTED`，
 * 绝不放行（防止「实体存在但基座静默跳过校验」的越权缺口）。
 */
function resolveScopedDelegate(
  prisma: PrismaService,
  modelKey: OwnershipModelKey
): ScopedModelDelegate {
  const bag = prisma.scoped as unknown as Record<string, ScopedModelDelegate | undefined>;
  const delegate = bag[modelKey];
  if (!delegate) {
    throw new BusinessException(OwnershipErrorCode.ENTITY_TYPE_UNSUPPORTED);
  }
  return delegate;
}

/** 归一化「必填」实体 id：空 / 非法 → 抛 `ENTITY_ID_REQUIRED` */
function normalizeRequiredId(value: unknown): string {
  const id = value === undefined || value === null ? "" : String(value).trim();
  if (!id) {
    throw new BusinessException(OwnershipErrorCode.ENTITY_ID_REQUIRED);
  }
  return id;
}
