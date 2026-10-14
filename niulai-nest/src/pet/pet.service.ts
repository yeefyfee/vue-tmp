import { Injectable, Logger, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { endOfDay, parseWallClock } from "../common/utils/date.util";
import { calcProfileCompleteness } from "./pet-completeness";
import { TimelineWriteService } from "./timeline-write.service";
import type { TimelineWriteInput } from "./timeline-write.service";
import { CreatePetDto } from "./dto/create-pet.dto";
import { UpdatePetDto } from "./dto/update-pet.dto";
import { QueryPetDto } from "./dto/query-pet.dto";

/**
 * 排序字段白名单：sortBy 必须落在集合内，否则回落默认值。
 * 防止把任意字符串透传给 orderBy（既是防注入，也是防无索引全表排序）。
 */
const SORTABLE_FIELDS = ["createdAt", "name"] as const;
type SortableField = (typeof SORTABLE_FIELDS)[number];

/** 详情返回形态：pet 行 + 挂载的行为标签摘要 */
export type PetRow = Prisma.PetGetPayload<null>;
export interface PetWithTags extends PetRow {
  behaviorTags: Array<{ id: string; name: string }>;
}

/**
 * 列表 / 详情附加的**跨域展示字段**（MVP-WEB-05-01）
 *
 * `pet` 表只存 `owner_customer_id` / `store_id` 快照（业务表关联无外键）⇒ 直接下发的
 * 列表会渲染成两串 UUID（不可读，与 P0-05-03 的转移队列同病）。故列表 / 详情统一
 * 批量回查主人（`customer.name` / `mobile`）与门店（`store.name`）补齐展示名。
 *
 * 口径：
 *  - **非 N+1**：一次 `in` 批量回查两张表（与行数无关）；
 *  - **不过滤 `deletedAt`**：主人可能已被合并归档（源客户软删）、门店可能停用，
 *    此时仍应显示其名称而非空值（同 04-03 `attachDisplayFields` 口径）；
 *  - 关联缺失（硬删 / 跨租户残留）回退 `null`，由前端渲染占位，**不抛错**。
 */
export interface PetDisplayFields {
  /** 主人客户姓名（回查失败为 null） */
  ownerName: string | null;
  /** 主人客户手机号（供前端做「跳客户列表」定位） */
  ownerMobile: string | null;
  /** 归属门店名（`storeId` 为空 = 租户级档案，恒 null） */
  storeName: string | null;
}

/** 列表行形态：pet 行 + 展示字段 */
export type PetListRow = PetRow & PetDisplayFields;
/** 详情形形态：pet 行 + 行为标签 + 展示字段 */
export type PetDetailView = PetWithTags & PetDisplayFields;

/**
 * 宠物档案服务（P0-06-02 · FR-1）
 *
 * 数据访问统一走 `prisma.scoped.pet` 等委托（租户隔离扩展自动注入 tenantId
 * 条件，RLS 兜底）；**业务代码绝不从请求参数读取 tenantId**——归属一律以
 * `RequestContext.getTenantId()`（JWT payload）为锚点。
 *
 * 契约口径（对齐萌主档案 customer 范式）：
 *  - 分页返回 `{ data, page: { pageNum, pageSize, total } }`，由全局
 *    ResponseInterceptor 改写成 `list/total/page/page_size` 信封；
 *  - 软删（deletedAt = now），列表/详情/更新入口一律过滤 `deletedAt: null`；
 *  - 乐观锁：update 以 `where: { id, version }` 提交，不匹配抛 `PET_VERSION_CONFLICT`；
 *  - 主人客户归属校验（scoped，租户内 + 未软删）不通过抛 A0603；
 *  - 完整度评分：create/update 时经 calcProfileCompleteness 重算写入。
 */
@Injectable()
export class PetService {
  private readonly logger = new Logger(PetService.name);

  constructor(
    private readonly prisma: PrismaService,
    // 时间线写入 SDK（P0-06-10）：@Optional 保证单测直构（无 Nest DI）时构造签名不变；
    // 未注入时时间线写入整体短路（最佳努力，不影响主流程）。
    @Optional() private readonly timelineWrite?: TimelineWriteService
  ) {}

  /**
   * 创建宠物档案（FR-1）
   *
   * ownerCustomerId 必须指向当前租户内未软删的客户（A0603）；storeId 显式传入时
   * 校验归属门店（A0604）；behaviorTagIds 全量校验租户内存在（A0605）后落关联行；
   * profileCompleteness 按填充字段重算。createdBy/updatedBy 从 ALS 上下文注入。
   */
  async createPet(dto: CreatePetDto) {
    const userId = RequestContext.getUserId();

    // 租户归属只认上下文（@RequireTenant 保证非空；缺失 fail-closed 拒绝）
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }

    await this.assertCustomerExists(dto.ownerCustomerId);
    if (dto.storeId) {
      await this.assertStoreExists(dto.storeId);
    }
    const tagIds = await this.resolveBehaviorTagIds(dto.behaviorTagIds ?? []);

    const data: Prisma.PetUncheckedCreateInput = {
      tenantId: BigInt(tenantId),
      storeId: dto.storeId ?? null,
      ownerCustomerId: dto.ownerCustomerId,
      name: dto.name,
      petType: dto.petType,
      breed: dto.breed ?? null,
      gender: dto.gender ?? null,
      birthday: dto.birthday ? new Date(`${dto.birthday}T00:00:00.000Z`) : null,
      weightKg: dto.weightKg ?? null,
      coatColor: dto.coatColor ?? null,
      sterilized: dto.sterilized ?? null,
      chipNo: dto.chipNo ?? null,
      photoUrl: dto.photoUrl ?? null,
      photos: dto.photos ?? null,
      remark: dto.remark ?? null,
      profileCompleteness: calcProfileCompleteness({
        name: dto.name,
        ownerCustomerId: dto.ownerCustomerId,
        petType: dto.petType,
        birthday: dto.birthday ?? null,
        weightKg: dto.weightKg ?? null,
        photoUrl: dto.photoUrl ?? null,
        photos: dto.photos ?? null,
        breed: dto.breed ?? null,
        sterilized: dto.sterilized ?? null,
        chipNo: dto.chipNo ?? null,
        coatColor: dto.coatColor ?? null,
        behaviorTagCount: tagIds.length,
      }),
      createdBy: toBigInt(userId),
      updatedBy: toBigInt(userId),
    };

    const pet = await this.prisma.scoped.pet.create({ data });
    if (tagIds.length > 0) {
      await this.replaceBehaviorTags(pet.id, tagIds);
    }
    // 统一时间线写入点（P0-06-10 · pet.created）：最佳努力，失败不阻断建档
    await this.recordTimelineBestEffort({
      petId: pet.id,
      eventName: "pet.created",
      content: `宠物「${pet.name}」建档`,
      payload: {
        petName: pet.name,
        petType: pet.petType,
        ownerCustomerId: pet.ownerCustomerId,
      },
      refType: "pet",
      refId: pet.id,
    });
    return this.attachBehaviorTags(pet);
  }

  /**
   * 宠物档案分页列表（FR-1）
   *
   * 筛选：petType / ownerCustomerId / storeId / chipNo 精确 + name 模糊 +
   * createdAt 闭区间；排序白名单字段 + ASC/DESC，默认 createdAt desc。
   * 列表不做标签聚合（防 N+1），标签在详情接口返回。
   */
  async getPetPage(query: QueryPetDto) {
    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 20;

    const where: Prisma.PetWhereInput = { deletedAt: null };
    if (query.petType !== undefined && query.petType !== null) {
      where.petType = query.petType;
    }
    if (query.ownerCustomerId) {
      where.ownerCustomerId = query.ownerCustomerId;
    }
    if (query.storeId) {
      where.storeId = query.storeId;
    }
    if (query.name) {
      where.name = { contains: query.name };
    }
    if (query.chipNo) {
      where.chipNo = query.chipNo;
    }
    if (query.behaviorTagId) {
      // 按行为标签筛选（P0-06-05 FR-4）：pet 与 pet_behavior_tag 之间无 Prisma
      // relation（业务表关联无外键），故两步查：先取挂该标签的 petId 集合，
      // 再以 id in 收敛主查询（tenant 扩展已对两份查询均注入租户条件）。
      const links = await this.prisma.scoped.petBehaviorTag.findMany({
        where: { tagId: query.behaviorTagId, deletedAt: null },
        select: { petId: true },
      });
      where.id = { in: links.map((link) => link.petId) };
    }
    if (query.createdAtStart || query.createdAtEnd) {
      // 时间处理铁律 4：区间端点一律走 date.util 按应用时区解析（禁止裸 new Date）
      const gte = query.createdAtStart ? parseWallClock(query.createdAtStart) : null;
      const lte = query.createdAtEnd ? endOfDay(query.createdAtEnd) : null;
      where.createdAt = {
        ...(gte ? { gte } : {}),
        ...(lte ? { lte } : {}),
      };
    }

    const sortBy = this.resolveSortField(query.sortBy);
    const order: Prisma.SortOrder = query.order?.toUpperCase() === "ASC" ? "asc" : "desc";
    const orderBy: Prisma.PetOrderByWithRelationInput = { [sortBy]: order };

    const [list, total] = await Promise.all([
      this.prisma.scoped.pet.findMany({
        where,
        orderBy,
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.pet.count({ where }),
    ]);

    return {
      data: await this.attachDisplayFields(list),
      page: {
        pageNum,
        pageSize,
        total,
      },
    };
  }

  /**
   * 宠物档案详情（FR-1）；已软删记录视为不存在；返回行含挂载的行为标签摘要
   * 与主人 / 门店展示字段（MVP-WEB-05-01）。
   */
  async getPetDetail(id: string): Promise<PetDetailView> {
    const pet = await this.prisma.scoped.pet.findFirst({
      where: { id, deletedAt: null },
    });
    if (!pet) {
      throw new BusinessException(ErrorCode.PET_NOT_FOUND);
    }
    const withTags = await this.attachBehaviorTags(pet);
    const [view] = await this.attachDisplayFields([withTags]);
    return view;
  }

  /**
   * 更新宠物档案（FR-1，乐观锁）
   *
   * `where: { id, version }`（extendedWhereUnique）一步完成「存在性 + 版本」校验；
   * P2025 时区分：记录不存在（含已软删）抛 PET_NOT_FOUND，否则视为版本冲突。
   * ownerCustomerId / storeId / behaviorTagIds 变更时逐项校验归属（A0603/A0604/A0605）；
   * 标签关联为全量替换语义（空数组=清空）。更新成功 version 自增并重算完整度评分。
   */
  async updatePet(id: string, dto: UpdatePetDto): Promise<PetWithTags> {
    const userId = RequestContext.getUserId();

    const data: Prisma.PetUncheckedUpdateInput = { updatedBy: toBigInt(userId) };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.ownerCustomerId !== undefined) {
      await this.assertCustomerExists(dto.ownerCustomerId);
      data.ownerCustomerId = dto.ownerCustomerId;
    }
    if (dto.petType !== undefined) data.petType = dto.petType;
    if (dto.storeId !== undefined) {
      if (dto.storeId) {
        await this.assertStoreExists(dto.storeId);
      }
      data.storeId = dto.storeId;
    }
    if (dto.breed !== undefined) data.breed = dto.breed;
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.birthday !== undefined) {
      data.birthday = dto.birthday ? new Date(`${dto.birthday}T00:00:00.000Z`) : null;
    }
    if (dto.weightKg !== undefined) {
      data.weightKg = dto.weightKg ?? null;
    }
    if (dto.coatColor !== undefined) data.coatColor = dto.coatColor;
    if (dto.sterilized !== undefined) data.sterilized = dto.sterilized;
    if (dto.chipNo !== undefined) data.chipNo = dto.chipNo;
    if (dto.photoUrl !== undefined) data.photoUrl = dto.photoUrl;
    if (dto.photos !== undefined) data.photos = dto.photos ?? null;
    if (dto.remark !== undefined) data.remark = dto.remark;

    let tagIds: string[] | null = null;
    if (dto.behaviorTagIds !== undefined) {
      tagIds = await this.resolveBehaviorTagIds(dto.behaviorTagIds);
    }

    // 完整度评分重算：以「更新后的行状态」为输入（先 update 再回读评分所需字段），
    // 标签数取替换后的确定值（tagIds ?? 既有关联数）
    try {
      await this.prisma.scoped.pet.update({
        where: { id, version: dto.version, deletedAt: null },
        data: { ...data, version: { increment: 1 } },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "P2025") {
        // 版本不匹配 vs 记录不存在：回查区分，给出精确业务码
        const exists = await this.prisma.scoped.pet.findFirst({
          where: { id, deletedAt: null },
          select: { id: true },
        });
        if (!exists) {
          throw new BusinessException(ErrorCode.PET_NOT_FOUND);
        }
        throw new BusinessException(ErrorCode.PET_VERSION_CONFLICT);
      }
      throw error;
    }

    if (tagIds !== null) {
      await this.replaceBehaviorTags(id, tagIds);
    }

    const updated = await this.prisma.scoped.pet.findFirstOrThrow({
      where: { id, deletedAt: null },
    });
    const behaviorTagCount = tagIds !== null ? tagIds.length : await this.countBehaviorTags(id);
    await this.prisma.scoped.pet.update({
      where: { id },
      data: {
        profileCompleteness: calcProfileCompleteness({
          ...updated,
          weightKg: updated.weightKg === null ? null : String(updated.weightKg),
          behaviorTagCount,
        }),
        updatedBy: toBigInt(userId),
      },
    });

    const result = await this.prisma.scoped.pet.findFirstOrThrow({
      where: { id, deletedAt: null },
    });
    return this.attachBehaviorTags(result);
  }

  /**
   * 删除宠物档案（FR-1，软删）：deletedAt = now；同步物理清除行为标签关联行
   * （关联无历史语义，软删后重建档案不应携带旧标签）。
   * 健康档案 / 体重 / 时间线等 append-only 记录保留（历史数据不随档案软删消失）。
   */
  async softDeletePet(id: string) {
    const userId = RequestContext.getUserId();

    const exists = await this.prisma.scoped.pet.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!exists) {
      throw new BusinessException(ErrorCode.PET_NOT_FOUND);
    }

    await this.prisma.scoped.pet.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: toBigInt(userId) },
    });
    await this.prisma.scoped.petBehaviorTag.deleteMany({ where: { petId: id } });
    return true;
  }

  /** 主人客户存在性校验（scoped：租户内 + 未软删），不通过抛 A0603 */
  private async assertCustomerExists(customerId: string): Promise<void> {
    const customer = await this.prisma.scoped.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true },
    });
    if (!customer) {
      throw new BusinessException(ErrorCode.PET_OWNER_INVALID);
    }
  }

  /** 归属门店存在性校验（scoped：租户内 + 未软删），不通过抛 A0604 */
  private async assertStoreExists(storeId: string): Promise<void> {
    const store = await this.prisma.scoped.store.findFirst({
      where: { id: storeId, deletedAt: null },
      select: { id: true },
    });
    if (!store) {
      throw new BusinessException(ErrorCode.PET_STORE_INVALID);
    }
  }

  /**
   * 行为标签 id 归属校验（scoped：租户内 + 未软删 + 启用态放行停用存量），
   * 任一缺失/跨租户抛 A0605；返回入参顺序去重后的合法 id 列表。
   */
  private async resolveBehaviorTagIds(tagIds: string[]): Promise<string[]> {
    const unique = Array.from(new Set(tagIds));
    if (unique.length === 0) return [];
    const found = await this.prisma.scoped.behaviorTag.findMany({
      where: { id: { in: unique }, deletedAt: null },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new BusinessException(ErrorCode.PET_BEHAVIOR_TAG_INVALID);
    }
    return unique;
  }

  /** 全量替换宠物-标签关联（先清后建；并发撞 uk 由调用方兜底语义覆盖） */
  private async replaceBehaviorTags(petId: string, tagIds: string[]): Promise<void> {
    await this.prisma.scoped.petBehaviorTag.deleteMany({ where: { petId } });
    if (tagIds.length === 0) return;
    const userId = toBigInt(RequestContext.getUserId());
    await this.prisma.scoped.petBehaviorTag.createMany({
      data: tagIds.map((tagId) => ({
        tenantId: BigInt(RequestContext.getTenantId() ?? "0"),
        petId,
        tagId,
        createdBy: userId,
        updatedBy: userId,
      })),
    });
  }

  /** 统计宠物既有标签关联数（更新未传 behaviorTagIds 时评分用） */
  private async countBehaviorTags(petId: string): Promise<number> {
    return this.prisma.scoped.petBehaviorTag.count({ where: { petId } });
  }

  /** 附加行为标签摘要（详情/创建/更新统一返回形态） */
  private async attachBehaviorTags(pet: PetRow): Promise<PetWithTags> {
    const rows = await this.prisma.scoped.petBehaviorTag.findMany({
      where: { petId: pet.id },
      select: { tagId: true },
    });
    const tagIds = rows.map((r) => r.tagId);
    const tags =
      tagIds.length > 0
        ? await this.prisma.scoped.behaviorTag.findMany({
            where: { id: { in: tagIds }, deletedAt: null },
            select: { id: true, name: true },
            orderBy: [{ sort: "asc" }, { name: "asc" }],
          })
        : [];
    return { ...pet, behaviorTags: tags };
  }

  /**
   * 批量补齐主人 / 门店展示名（MVP-WEB-05-01）
   *
   * 两次 `in` 批量回查（**非 N+1**，与行数无关）；**不过滤 `deletedAt`** —— 主人可能
   * 已被合并归档、门店可能停用，此时仍应展示名称而非空值；关联缺失回退 `null`。
   * 空入参直接短路（不产生无意义查询）。
   */
  private async attachDisplayFields<T extends { ownerCustomerId: string; storeId: string | null }>(
    rows: T[]
  ): Promise<Array<T & PetDisplayFields>> {
    if (rows.length === 0) return [];

    const customerIds = Array.from(
      new Set(rows.map((row) => row.ownerCustomerId).filter((id): id is string => Boolean(id)))
    );
    const storeIds = Array.from(
      new Set(rows.map((row) => row.storeId).filter((id): id is string => Boolean(id)))
    );

    const [customers, stores] = await Promise.all([
      customerIds.length > 0
        ? this.prisma.scoped.customer.findMany({
            where: { id: { in: customerIds } },
            select: { id: true, name: true, mobile: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string; mobile: string }>),
      storeIds.length > 0
        ? this.prisma.scoped.store.findMany({
            where: { id: { in: storeIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
    ]);

    const customerMap = new Map(customers.map((row) => [row.id, row]));
    const storeMap = new Map(stores.map((row) => [row.id, row]));

    return rows.map((row) => {
      const customer = customerMap.get(row.ownerCustomerId) ?? null;
      const store = row.storeId ? (storeMap.get(row.storeId) ?? null) : null;
      return {
        ...row,
        ownerName: customer?.name ?? null,
        ownerMobile: customer?.mobile ?? null,
        storeName: store?.name ?? null,
      };
    });
  }

  /**
   * 统一时间线写入（P0-06-10 · 最佳努力）：写入失败仅告警，绝不阻断主流程业务。
   * 未注入 SDK（单测直构）时整体短路。
   */
  private async recordTimelineBestEffort(input: TimelineWriteInput): Promise<void> {
    if (!this.timelineWrite) return;
    try {
      await this.timelineWrite.recordSync(input);
    } catch (error) {
      this.logger.warn(
        `时间线写入失败（不阻断主流程）event=${input.eventName} pet=${input.petId}: ${
          (error as Error).message
        }`
      );
    }
  }

  /** 排序字段白名单解析，非法值回落 createdAt */
  private resolveSortField(sortBy?: string): SortableField {
    if (sortBy && (SORTABLE_FIELDS as readonly string[]).includes(sortBy)) {
      return sortBy as SortableField;
    }
    return "createdAt";
  }
}
