import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../common/prisma/prisma.service";
import { toBigInt } from "../common/prisma/prisma-ids";
import { RequestContext } from "../common/context/request-context";
import { ErrorCode } from "../common/enums/error-code.enum";
import { BusinessException } from "../common/exceptions/business.exception";
import { calcProfileCompleteness } from "./pet-completeness";
import { BehaviorTagError, BehaviorTagStatus } from "./behavior-tag.constants";
import { BehaviorTagLinkageService } from "./behavior-tag-linkage.service";
import { CreateBehaviorTagDto } from "./dto/create-behavior-tag.dto";
import { UpdateBehaviorTagDto } from "./dto/update-behavior-tag.dto";
import { QueryBehaviorTagDto } from "./dto/query-behavior-tag.dto";
import { ReplacePetTagsDto } from "./dto/replace-pet-tags.dto";

/**
 * 行为标签服务（P0-06-05 · FR-4）
 *
 * 职责：
 *  - 标签库 CRUD（**租户级**：GET/POST/PATCH/DELETE /behavior-tags）；
 *  - 宠物打/取消标签（**全量替换**：PUT /pets/:id/tags，与 P0-06-02 的
 *    `behaviorTagIds` 同范式）；
 *  - 标签变更后触发 {@link BehaviorTagLinkageService.onTagsChanged} 联动钩子
 *    （房间分配 / 照护任务的扩展点，本轮为最小实现）。
 *
 * 数据访问一律走 `prisma.scoped.<model>`（租户隔离扩展自动注入 tenantId 条件，
 * RLS 兜底）；**业务代码绝不从请求参数读取 tenantId**，归属以
 * `RequestContext.getTenantId()`（JWT payload）为锚点。
 *
 * 契约口径（对齐 store/pet 范式）：
 *  - 分页返回 `{ data, page: { pageNum, pageSize, total } }`，由全局
 *    ResponseInterceptor 改写成 `list/total/page/page_size` 信封；
 *  - 软删（deletedAt = now），列表/更新入口一律过滤 `deletedAt: null`；
 *  - 乐观锁：update 以 `where: { id, version }` 提交，不匹配抛 A0612。
 *
 * 排序字段白名单：sortBy 必须落在集合内，否则回落默认值（防注入 + 防全表排序）。
 */
const SORTABLE_FIELDS = ["createdAt", "name", "sort", "status"] as const;
type SortableField = (typeof SORTABLE_FIELDS)[number];

/** 宠物行类型（与 PetService.PetRow 同源） */
export type PetRow = Prisma.PetGetPayload<null>;
/** 宠物详情返回形态：pet 行 + 行为标签摘要（与 PetService.PetWithTags 同形） */
export interface PetWithTags extends PetRow {
  behaviorTags: Array<{ id: string; name: string }>;
}

@Injectable()
export class BehaviorTagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly linkage: BehaviorTagLinkageService
  ) {}

  /**
   * 创建行为标签（FR-4）
   *
   * 名称租户内唯一（uk_behavior_tag_tenant_name）。**软删同名标签复活语义**：
   * 唯一索引 `uk_behavior_tag_tenant_name` 是普通唯一约束（软删行仍占用名字），
   * 若同名标签已软删，则复用其 id 复活（清 deletedAt + 覆盖字段 + version 自增），
   * 而非硬报重名 —— 避免「删了名字就再也建不了」的死锁式体验。
   * 存活同名标签则抛 A0610；并发兜底捕获 P2002 同样映射 A0610。
   */
  async createBehaviorTag(dto: CreateBehaviorTagDto) {
    const userId = RequestContext.getUserId();
    const tenantId = this.requireTenantId();

    const name = dto.name.trim();

    // 唯一性探测（scoped：租户内；**不过滤 deletedAt**——软删行也占用唯一键）
    const existing = await this.prisma.scoped.behaviorTag.findFirst({
      where: { name },
      select: { id: true, deletedAt: true },
    });
    if (existing && existing.deletedAt === null) {
      throw new BusinessException(BehaviorTagError.NAME_DUPLICATED);
    }

    if (existing) {
      // 复活软删同名标签
      return await this.prisma.scoped.behaviorTag.update({
        where: { id: existing.id },
        data: {
          deletedAt: null,
          sort: dto.sort ?? 0,
          status: dto.status ?? BehaviorTagStatus.ENABLED,
          updatedBy: toBigInt(userId),
          version: { increment: 1 },
        },
      });
    }

    const data: Prisma.BehaviorTagUncheckedCreateInput = {
      tenantId: BigInt(tenantId),
      name,
      sort: dto.sort ?? 0,
      status: dto.status ?? BehaviorTagStatus.ENABLED,
      createdBy: toBigInt(userId),
      updatedBy: toBigInt(userId),
    };

    try {
      return await this.prisma.scoped.behaviorTag.create({ data });
    } catch (error) {
      if ((error as { code?: string })?.code === "P2002") {
        // 并发创建同名：唯一索引兜底 → 业务码
        throw new BusinessException(BehaviorTagError.NAME_DUPLICATED);
      }
      throw error;
    }
  }

  /**
   * 行为标签分页列表（FR-4）
   *
   * 筛选：name 模糊 + status 精确；排序白名单（createdAt/name/sort/status），
   * 默认按 sort 升序（标签库展示顺序）。
   */
  async getBehaviorTagPage(query: QueryBehaviorTagDto) {
    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 20;

    const where: Prisma.BehaviorTagWhereInput = { deletedAt: null };
    if (query.name) {
      where.name = { contains: query.name };
    }
    if (query.status !== undefined && query.status !== null) {
      where.status = query.status;
    }

    const hasSortBy =
      !!query.sortBy && (SORTABLE_FIELDS as readonly string[]).includes(query.sortBy);
    const order: Prisma.SortOrder = query.order?.toUpperCase() === "ASC" ? "asc" : "desc";
    const orderBy: Prisma.BehaviorTagOrderByWithRelationInput = hasSortBy
      ? { [query.sortBy as SortableField]: order }
      : { sort: "asc" };

    const [list, total] = await Promise.all([
      this.prisma.scoped.behaviorTag.findMany({
        where,
        orderBy,
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.scoped.behaviorTag.count({ where }),
    ]);

    return {
      data: list,
      page: { pageNum, pageSize, total },
    };
  }

  /**
   * 更新行为标签（FR-4，乐观锁）
   *
   * `where: { id, version }` 一步完成「存在性 + 版本」校验；P2025 时回查区分
   * 「不存在（含已软删）→ A0611」与「版本冲突 → A0612」。改名时校验目标名未被
   * 其他存活标签占用（A0610）。
   */
  async updateBehaviorTag(id: string, dto: UpdateBehaviorTagDto) {
    const userId = RequestContext.getUserId();

    const data: Prisma.BehaviorTagUpdateInput = { updatedBy: toBigInt(userId) };
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const clash = await this.prisma.scoped.behaviorTag.findFirst({
        where: { name, id: { not: id }, deletedAt: null },
        select: { id: true },
      });
      if (clash) {
        throw new BusinessException(BehaviorTagError.NAME_DUPLICATED);
      }
      data.name = name;
    }
    if (dto.sort !== undefined) data.sort = dto.sort;
    if (dto.status !== undefined) data.status = dto.status;

    try {
      return await this.prisma.scoped.behaviorTag.update({
        where: { id, version: dto.version, deletedAt: null },
        data: { ...data, version: { increment: 1 } },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "P2025") {
        const exists = await this.prisma.scoped.behaviorTag.findFirst({
          where: { id, deletedAt: null },
          select: { id: true },
        });
        if (!exists) {
          throw new BusinessException(BehaviorTagError.NOT_FOUND);
        }
        throw new BusinessException(BehaviorTagError.VERSION_CONFLICT);
      }
      if ((error as { code?: string })?.code === "P2002") {
        throw new BusinessException(BehaviorTagError.NAME_DUPLICATED);
      }
      throw error;
    }
  }

  /**
   * 删除行为标签（FR-4，软删）
   *
   * 软删标签定义（deletedAt = now）并**物理清除该标签与所有宠物的关联行**
   * （关联无历史语义，软删标签不应残留悬挂关联），随后对受影响的宠物重算
   * 完整度评分（标签权重随关联解除而回收）。
   */
  async softDeleteBehaviorTag(id: string): Promise<boolean> {
    const userId = RequestContext.getUserId();
    const userIdBig = toBigInt(userId);

    const exists = await this.prisma.scoped.behaviorTag.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!exists) {
      throw new BusinessException(BehaviorTagError.NOT_FOUND);
    }

    // 受影响宠物（用于重算完整度）
    const links = await this.prisma.scoped.petBehaviorTag.findMany({
      where: { tagId: id },
      select: { petId: true },
    });
    const affectedPetIds = Array.from(new Set(links.map((l) => l.petId)));

    await this.prisma.scoped.petBehaviorTag.deleteMany({ where: { tagId: id } });
    await this.prisma.scoped.behaviorTag.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: userIdBig },
    });

    for (const petId of affectedPetIds) {
      await this.recomputeCompleteness(petId, userIdBig);
    }
    return true;
  }

  /**
   * 宠物行为标签全量替换（FR-4）
   *
   * 语义：以 `dto.behaviorTagIds` 为该宠物最终拥有的标签集合。
   * 步骤：宠物存在性（A0601）→ 标签归属校验（A0605，租户内 + 未软删）→
   * 计算差分 added/removed → 先清后建关联 → 重算完整度 → 触发联动钩子。
   *
   * 注：标签替换**不参与 pet 乐观锁**（仅改关联与评分，不改 pet 业务字段语义），
   * 故入口不要求 version。全量替换与 P0-06-02 的 `UpdatePetDto.behaviorTagIds`
   * 口径一致（那条路径走 pet 乐观锁，二者并存但语义同源）。
   */
  async setPetTags(petId: string, dto: ReplacePetTagsDto): Promise<PetWithTags> {
    const userId = RequestContext.getUserId();
    const tenantId = this.requireTenantId();
    const userIdBig = toBigInt(userId);

    // 1. 宠物存在性（scoped：租户内 + 未软删）
    const pet = await this.prisma.scoped.pet.findFirst({
      where: { id: petId, deletedAt: null },
    });
    if (!pet) {
      throw new BusinessException(ErrorCode.PET_NOT_FOUND);
    }

    // 2. 标签归属校验（去重后逐个校验，复用 A0605）
    const tagIds = Array.from(new Set(dto.behaviorTagIds));
    if (tagIds.length > 0) {
      const found = await this.prisma.scoped.behaviorTag.findMany({
        where: { id: { in: tagIds }, deletedAt: null },
        select: { id: true },
      });
      if (found.length !== tagIds.length) {
        throw new BusinessException(ErrorCode.PET_BEHAVIOR_TAG_INVALID);
      }
    }

    // 3. 计算差分（用于联动钩子）
    const current = await this.prisma.scoped.petBehaviorTag.findMany({
      where: { petId },
      select: { tagId: true },
    });
    const currentIds = current.map((c) => c.tagId);
    const added = tagIds.filter((tagId) => !currentIds.includes(tagId));
    const removed = currentIds.filter((tagId) => !tagIds.includes(tagId));

    // 4. 全量替换（先清后建）
    await this.prisma.scoped.petBehaviorTag.deleteMany({ where: { petId } });
    if (tagIds.length > 0) {
      await this.prisma.scoped.petBehaviorTag.createMany({
        data: tagIds.map((tagId) => ({
          tenantId: BigInt(tenantId),
          petId,
          tagId,
          createdBy: userIdBig,
          updatedBy: userIdBig,
        })),
      });
    }

    // 5. 重算完整度（标签权重）
    await this.recomputeCompleteness(petId, userIdBig);

    // 6. 联动钩子（房间分配 / 照护任务扩展点；最小实现内部短路）
    await this.linkage.onTagsChanged(petId, added, removed);

    // 7. 返回最新形态（含标签摘要）
    const latest = await this.prisma.scoped.pet.findFirstOrThrow({
      where: { id: petId, deletedAt: null },
    });
    return this.attachBehaviorTags(latest);
  }

  /** 租户上下文（@RequireTenant 保证非空；缺失 fail-closed） */
  private requireTenantId(): string {
    const tenantId = RequestContext.getTenantId();
    if (!tenantId) {
      throw new BusinessException(ErrorCode.TENANT_CONTEXT_MISSING);
    }
    return tenantId;
  }

  /** 重算并回写宠物完整度评分（标签数取当前关联的真实计数） */
  private async recomputeCompleteness(petId: string, userId: bigint | null): Promise<void> {
    const pet = await this.prisma.scoped.pet.findFirst({
      where: { id: petId, deletedAt: null },
    });
    if (!pet) {
      return; // 宠物已不存在/已软删：跳过评分回写
    }
    const behaviorTagCount = await this.prisma.scoped.petBehaviorTag.count({ where: { petId } });
    await this.prisma.scoped.pet.update({
      where: { id: petId },
      data: {
        profileCompleteness: calcProfileCompleteness({
          ...pet,
          weightKg: pet.weightKg === null ? null : String(pet.weightKg),
          behaviorTagCount,
        }),
        ...(userId !== null ? { updatedBy: userId } : {}),
      },
    });
  }

  /** 附加行为标签摘要（详情/替换统一返回形态；仅返回未软删标签） */
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
}
