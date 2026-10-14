import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { AuditLogService } from "../common/audit/audit-log.service";
import { CustomerErrorCode } from "./customer-error-codes";
import { PetTransferStatus } from "./pet-transfer.service";
import { MergeCustomerDto } from "./dto/merge-customer.dto";

/**
 * 审计动作：客户合并（P0-05-07）
 *
 * ⚠️ `@peluvida/shared` 的 `AuditAction` 当前登记至 7（GRANT），尚无 MERGE 语义；
 * 本轮文件域隔离**禁改 shared 包**，故在此以「下一个未占用 SmallInt 值 8」承载
 * 「合并」动作（`audit_log.action` 为 SmallInt 且无 CHECK；`AuditLogService.record`
 * 的 action 形态为 `AuditAction | number`，接受数值）。待 shared 侧收敛
 * `AuditAction.MERGE = 8` 后，本常量平移为引用即可（对外语义零变化）。
 */
const AUDIT_MERGE_ACTION = 8;

/**
 * 客户合并服务（P0-05-07 · FR-7）
 *
 * 语义：把 `source`（被并入方）合并到 `target`（保留方）——合并后**仅保留 target**，
 * source 归档（软删 + 备注追加「已合并至 …」），二者历史数据归并到 target。
 *
 * ── 核心不变式（事务内，`$transaction` 原子执行）──
 *  1. source / target 均在本租户且**未软删**（scoped 查询 fail-closed，跨租户不可见）；
 *     sourceId ≠ targetId；target 不能是「已合并」档案（已归档软删 ⇒ 由 deletedAt 过滤拦截）；
 *  2. **在途转移护栏**：source 存在 `pet_transfer_request`（status=1 在途，from_customer_id=source）
 *     ⇒ 拒绝合并（A0528）——避免「审批进行中改归属」与「合并改归属」并发写同一宠物；
 *  3. **宠物归属迁移（权威字段）**：`pet.owner_customer_id = source` 的宠物改判为 target；
 *  4. **客户-宠物关联迁移**：`customer_pet` 中 source 的 active 关联迁到 target；若 target
 *     已存在同一宠物的 active 关联 ⇒ 软删 source 那条**去重**（避免重复关联）；
 *  5. **触达记录迁移**：`reach_log.customer_id = source` → target（append-only，历史留痕随客户归并）；
 *  6. **黑名单取舍（显式）**：source 的 `blacklist` 记录**不迁移**到 target（见下方注释）；
 *  7. **源客户归档**：`source.deleted_at = now`，remark 追加「已合并至 <targetName>(<targetId>)」，version+1；
 *  8. **审计**：`AuditLogService.record`（entityType "customer" / action merge / diff）**同事务**写入。
 *
 * ── 黑名单为何不迁移（取舍说明）──
 * 黑名单是**风控记录**，绑定「发生拉黑行为时的那份客户档案 + 当时门店/原因」的语义。
 * 若机械迁往 target，会把「针对重复建档 / 问题客户的既有风控结论」误加于保留档案，
 * 造成**误伤**（target 可能本是正常客户）；且门店级黑名单的 store_id 语义也依赖原档案
 * 归属。故本轮**不迁移**：source 归档时其黑名单记录随档案一并归档（`blacklist` 仍 OR 于
 * `deleted_at IS NULL` 的运行时判定，归档档案的黑名单不再对 target 生效）。
 * 若业务需「合并即继承黑名单」，应由运营在 target 上**显式重新拉黑**（留可追责的操作人链路）。
 *
 * 数据访问统一走 `prisma.scoped.*`（租户隔离扩展自动注入 tenantId，RLS 兜底）；
 * 业务代码绝不从请求参数读取 tenantId——归属以 `RequestContext.getTenantId()` 为锚点。
 */
@Injectable()
export class CustomerMergeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService
  ) {}

  /**
   * 合并客户（FR-7）。
   *
   * @param dto sourceId（被并入方）/ targetId（保留方）/ version?（乐观锁）
   * @returns `{ targetId, movedPets, movedReachLogs, mergedSourceId }`
   *   - movedPets：归属改判到 target 的宠物数（`pet.owner_customer_id` 权威口径）；
   *   - movedReachLogs：迁移到 target 的触达记录数；
   *   - mergedSourceId：被归档的源客户 id。
   */
  async mergeCustomers(dto: MergeCustomerDto): Promise<{
    targetId: string;
    movedPets: number;
    movedReachLogs: number;
    mergedSourceId: string;
  }> {
    const userId = RequestContext.getUserId();
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }

    const { sourceId, targetId } = dto;
    // 自我合并拒绝（早于任何查询，避免无意义的事务开销）
    if (sourceId === targetId) {
      throw new BusinessException(CustomerErrorCode.CUSTOMER_MERGE_SELF);
    }
    const versionProvided = dto.version !== undefined;

    try {
      return await this.prisma.scoped.$transaction(async (tx) => {
        // ① 载入 source / target（scoped：租户内 + 未软删；fail-closed）
        const source = await tx.customer.findFirst({
          where: { id: sourceId, deletedAt: null },
          select: { id: true, name: true, remark: true, version: true },
        });
        if (!source) {
          throw new BusinessException(CustomerErrorCode.CUSTOMER_MERGE_SOURCE_INVALID);
        }

        const target = await tx.customer.findFirst({
          where: { id: targetId, deletedAt: null },
          select: { id: true, name: true },
        });
        // target 缺失 / 已软删（含「已被并入他档」的归档态）→ 不可作为保留方
        if (!target) {
          throw new BusinessException(CustomerErrorCode.CUSTOMER_MERGE_TARGET_INVALID);
        }

        // ② 在途转移护栏：source 存在 status=1（在途）转移申请即拒绝
        const pendingTransfer = await tx.petTransferRequest.findFirst({
          where: {
            fromCustomerId: sourceId,
            status: PetTransferStatus.PENDING,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (pendingTransfer) {
          throw new BusinessException(CustomerErrorCode.CUSTOMER_MERGE_TRANSFER_PENDING);
        }

        const now = new Date();

        // ③ 宠物归属迁移（权威字段 pet.owner_customer_id：source → target）
        const petUpdate = await tx.pet.updateMany({
          where: { ownerCustomerId: sourceId, deletedAt: null },
          data: {
            ownerCustomerId: targetId,
            updatedBy: toBigInt(userId),
            version: { increment: 1 },
          },
        });
        const movedPets = petUpdate.count;

        // ④ 客户-宠物关联迁移（去重：target 同宠物已有 active 关联则软删 source 那条）
        const sourceAssociations = await tx.customerPet.findMany({
          where: { customerId: sourceId, deletedAt: null },
          select: { id: true, petId: true },
        });
        for (const association of sourceAssociations) {
          const existingTargetAssociation = await tx.customerPet.findFirst({
            where: { customerId: targetId, petId: association.petId, deletedAt: null },
            select: { id: true },
          });
          if (existingTargetAssociation) {
            // 目标已存在同一宠物的 active 关联 → 软删源关联，避免重复
            await tx.customerPet.update({
              where: { id: association.id },
              data: { deletedAt: now, updatedBy: toBigInt(userId) },
            });
          } else {
            // 无障碍 → 关联改挂到 target
            await tx.customerPet.update({
              where: { id: association.id },
              data: {
                customerId: targetId,
                updatedBy: toBigInt(userId),
                version: { increment: 1 },
              },
            });
          }
        }

        // ⑤ 触达记录迁移（reach_log.customer_id：source → target）
        const reachUpdate = await tx.reachLog.updateMany({
          where: { customerId: sourceId },
          data: { customerId: targetId, updatedBy: toBigInt(userId) },
        });
        const movedReachLogs = reachUpdate.count;

        // ⑥ 黑名单：显式**不迁移**（取舍见类头注释）。此处不写任何 blacklist 变更语句。

        // ⑦ 源客户归档（软删 + 备注追加 + 乐观锁）
        const mergedRemark = this.buildMergedRemark(source.remark, target.name, targetId);
        await tx.customer.update({
          where: {
            id: sourceId,
            deletedAt: null,
            ...(versionProvided ? { version: dto.version } : {}),
          },
          data: {
            deletedAt: now,
            remark: mergedRemark,
            updatedBy: toBigInt(userId),
            version: { increment: 1 },
          },
        });

        // ⑧ 审计（同事务显式轨）：before 传空对象 → buildAuditDiff 产出 after 即变更集
        //    { sourceId, targetId, movedPets, movedReachLogs }（before 侧为 null）。
        await this.auditLogService.record(
          {
            entityType: "customer",
            entityId: sourceId,
            action: AUDIT_MERGE_ACTION,
            before: {},
            after: { sourceId, targetId, movedPets, movedReachLogs },
          },
          tx as unknown as Prisma.TransactionClient
        );

        return { targetId, movedPets, movedReachLogs, mergedSourceId: sourceId };
      });
    } catch (error) {
      if (error instanceof BusinessException) {
        throw error;
      }
      // 乐观锁：源客户归档 update 的 where（id + deletedAt=null [+ version]）不匹配 → P2025
      if ((error as { code?: string })?.code === "P2025") {
        throw new BusinessException(
          versionProvided
            ? ErrorCode.CUSTOMER_VERSION_CONFLICT
            : CustomerErrorCode.CUSTOMER_MERGE_SOURCE_INVALID
        );
      }
      throw error;
    }
  }

  /**
   * 构造归档备注：追加「已合并至 <targetName>(<targetId>)」，并裁剪至列长上限
   * `VarChar(500)`（源备注较长时保留前缀 + 合并摘要，避免超长写库失败）。
   */
  private buildMergedRemark(existing: string | null, targetName: string, targetId: string): string {
    const suffix = `已合并至 ${targetName}(${targetId})`;
    const base = existing && existing.trim() !== "" ? `${existing} ${suffix}` : suffix;
    return base.length > 500 ? base.slice(0, 500) : base;
  }
}
