import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";

/** 客户宠物归属列表项（join pet 摘要） */
export interface CustomerPetListItem {
  /** 归属关联 id（customer_pet.id） */
  id: string;
  customerId: string;
  petId: string;
  isPrimary: boolean | null;
  /** 关联行冗余的宠物名快照 */
  petName: string | null;
  /** join pet 摘要（宠物软删 / 缺失时为 null） */
  pet: {
    id: string;
    name: string;
    petType: number;
    profileCompleteness: number;
  } | null;
}

/**
 * 客户-宠物归属关系服务（P0-05-03 · FR-2 多宠物归属）
 *
 * 归属模型（关键设计口径）：
 *  - `pet.ownerCustomerId`（NOT NULL）是宠物的**唯一现行主人**，由宠物域维护；
 *  - `customer_pet` 是 FR-2 的「萌主-宠物归属关系」表，一条 active 关联对应
 *    宠物当前主人；两者保持**强一致**（绑定仅当 pet.ownerCustomerId === 目标客户时成立）；
 *  - **未审批不可变更归属**：绑定接口不改变既有归属；变更归属的唯一合法通道是
 *    「转移申请 + 审批」（见 PetTransferService）；因此**解绑当前归属关联被禁止**
 *    （ownerCustomerId NOT NULL 无法表达「无主」，硬解绑会产生列表/主档不一致），
 *    只有历史脏关联（非当前主人）才允许软删清理。
 *
 * 数据访问统一走 `prisma.scoped.*`（租户隔离扩展自动注入 tenantId，RLS 兜底）；
 * 业务代码绝不从请求参数读取 tenantId——归属一律以 `RequestContext.getTenantId()`
 * 为锚点。
 */
@Injectable()
export class CustomerPetService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 某客户的宠物列表（FR-2）：返回该客户全部 active 归属关联 + pet 摘要
   * （name / petType / profileCompleteness）。关联行按 isPrimary 优先、创建时间升序。
   */
  async listCustomerPets(customerId: string): Promise<CustomerPetListItem[]> {
    await this.assertCustomerExists(customerId);

    const associations = await this.prisma.scoped.customerPet.findMany({
      where: { customerId, deletedAt: null },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    if (associations.length === 0) {
      return [];
    }

    const petIds = associations.map((row) => row.petId);
    const pets = await this.prisma.scoped.pet.findMany({
      where: { id: { in: petIds }, deletedAt: null },
      select: { id: true, name: true, petType: true, profileCompleteness: true },
    });
    const petMap = new Map(pets.map((pet) => [pet.id, pet]));

    return associations.map((row) => {
      const pet = petMap.get(row.petId);
      return {
        id: row.id,
        customerId: row.customerId,
        petId: row.petId,
        isPrimary: row.isPrimary,
        petName: row.petName,
        pet: pet
          ? {
              id: pet.id,
              name: pet.name,
              petType: pet.petType,
              profileCompleteness: pet.profileCompleteness,
            }
          : null,
      };
    });
  }

  /**
   * 绑定宠物归属（FR-2）。
   *
   * 校验：宠物属当前租户（A0601）→ 宠物当前主人等于目标客户（否则 A0514，
   * 引导走转移申请）。已绑定同一客户时**幂等**返回既有关联。
   * **不改动 pet.ownerCustomerId**（归属变更只经审批转移）。
   */
  async bindPet(customerId: string, petId: string) {
    const userId = RequestContext.getUserId();
    await this.assertCustomerExists(customerId);
    const pet = await this.assertPetExists(petId);

    // 「已绑定他主」拒绝：宠物的现行主人不是目标客户 → 引导走转移申请
    if (pet.ownerCustomerId !== customerId) {
      throw new BusinessException(ErrorCode.PET_BINDING_CONFLICT);
    }

    // 幂等：同一(客户,宠物)已有 active 关联直接返回
    const existing = await this.prisma.scoped.customerPet.findFirst({
      where: { customerId, petId, deletedAt: null },
    });
    if (existing) {
      return existing;
    }

    // 防御：宠物存在其他客户的 active 关联（历史脏数据）→ 同样拒绝
    const conflict = await this.prisma.scoped.customerPet.findFirst({
      where: { petId, deletedAt: null, customerId: { not: customerId } },
      select: { id: true },
    });
    if (conflict) {
      throw new BusinessException(ErrorCode.PET_BINDING_CONFLICT);
    }

    const activeCount = await this.prisma.scoped.customerPet.count({
      where: { customerId, deletedAt: null },
    });

    const data: Prisma.CustomerPetUncheckedCreateInput = {
      tenantId: BigInt(RequestContext.getTenantId() ?? "0"),
      customerId,
      petId,
      petName: pet.name,
      petType: pet.petType,
      isPrimary: activeCount === 0,
      createdBy: toBigInt(userId),
      updatedBy: toBigInt(userId),
    };
    return this.prisma.scoped.customerPet.create({ data });
  }

  /**
   * 解绑宠物归属（FR-2）。
   *
   * **设计取舍：禁止直接解绑当前归属关联**（抛 A0519，引导走转移申请）——
   * `pet.ownerCustomerId` NOT NULL 无法表达「无主」，若允许软删关联而不清主档
   * 归属，则 GET /customers/:id/pets 与宠物主档会永久不一致；而归一不变的
   * 「未审批不可变更归属」原则下，归属变更唯一合法通道是审批转移。
   * 仅当关联为**历史脏数据**（该宠物现行主人已非本客户）时才允许软删清理。
   */
  async unbindPet(customerId: string, petId: string): Promise<boolean> {
    const userId = RequestContext.getUserId();
    await this.assertCustomerExists(customerId);

    const association = await this.prisma.scoped.customerPet.findFirst({
      where: { customerId, petId, deletedAt: null },
    });
    if (!association) {
      throw new BusinessException(ErrorCode.PET_BINDING_NOT_FOUND);
    }

    const pet = await this.prisma.scoped.pet.findFirst({
      where: { id: petId, deletedAt: null },
      select: { ownerCustomerId: true },
    });
    // 关联即宠物现行主人 → 归属变更须经审批，禁止直接解绑
    if (pet && pet.ownerCustomerId === customerId) {
      throw new BusinessException(ErrorCode.PET_UNBIND_FORBIDDEN);
    }

    await this.prisma.scoped.customerPet.update({
      where: { id: association.id },
      data: { deletedAt: new Date(), updatedBy: toBigInt(userId) },
    });
    return true;
  }

  /** 客户存在性校验（scoped：租户内 + 未软删），不通过抛 A0510 */
  private async assertCustomerExists(customerId: string): Promise<void> {
    const customer = await this.prisma.scoped.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      throw new BusinessException(ErrorCode.CUSTOMER_NOT_FOUND);
    }
  }

  /** 宠物存在性校验（scoped：租户内 + 未软删），不通过抛 A0601；命中返回该行 */
  private async assertPetExists(petId: string) {
    const pet = await this.prisma.scoped.pet.findFirst({
      where: { id: petId, deletedAt: null },
    });
    if (!pet) {
      throw new BusinessException(ErrorCode.PET_NOT_FOUND);
    }
    return pet;
  }
}
