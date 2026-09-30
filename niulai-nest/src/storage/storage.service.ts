import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, In, Repository } from "typeorm";

import { StorageItem } from "./entities/storage-item.entity";
import { StorageCategory } from "./entities/storage-category.entity";
import { StorageTag } from "./entities/storage-tag.entity";
import { StorageItemTag } from "./entities/storage-item-tag.entity";

import { BusinessException } from "@/common/exceptions/business.exception";
import { CreateStorageItemDto } from "./dto/create-storage-item.dto";
import { UpdateStorageItemDto } from "./dto/update-storage-item.dto";
import { StorageItemQueryDto } from "./dto/storage-item-query.dto";
import { StorageCategoryFormDto, StorageCategoryQueryDto } from "./dto/storage-category.dto";
import { StorageTagFormDto } from "./dto/storage-tag.dto";

/**
 * 个人物品收纳服务
 *
 * 数据隔离策略：所有查询强制按 ownerId 过滤，用户只能操作自己的数据。
 * 分类/标签的 ownerId 为 NULL 时视为公共数据，所有用户可见但不可改。
 */
@Injectable()
export class StorageService {
  constructor(
    @InjectRepository(StorageItem)
    private readonly itemRepo: Repository<StorageItem>,
    @InjectRepository(StorageCategory)
    private readonly categoryRepo: Repository<StorageCategory>,
    @InjectRepository(StorageTag)
    private readonly tagRepo: Repository<StorageTag>,
    @InjectRepository(StorageItemTag)
    private readonly itemTagRepo: Repository<StorageItemTag>,
    private readonly dataSource: DataSource
  ) {}

  // ==========================================================================
  // 物品
  // ==========================================================================

  /**
   * 物品分页列表
   */
  async getItemPage(ownerId: string, query: StorageItemQueryDto) {
    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 10;

    const qb = this.itemRepo
      .createQueryBuilder("item")
      .leftJoin(StorageCategory, "category", "category.id = item.categoryId")
      .addSelect(["category.name", "category.icon", "category.color"])
      .where("item.isDeleted = :isDeleted", { isDeleted: 0 })
      .andWhere("item.ownerId = :ownerId", { ownerId });

    if (query.keywords) {
      qb.andWhere(
        "(item.name LIKE :kw OR item.remark LIKE :kw OR item.location LIKE :kw)",
        { kw: `%${query.keywords}%` }
      );
    }

    if (query.categoryId) {
      qb.andWhere("item.categoryId = :categoryId", { categoryId: query.categoryId });
    }

    if (query.status !== undefined && query.status !== null) {
      qb.andWhere("item.status = :status", { status: query.status });
    }

    // 标签筛选：命中任一标签即可
    if (query.tagId) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM storage_item_tag sit
          WHERE sit.item_id = item.id
            AND sit.tag_id = :tagId
            AND sit.is_deleted = 0
        )`,
        { tagId: query.tagId }
      );
    }

    const sortFieldMap: Record<string, string> = {
      createTime: "item.createTime",
      name: "item.name",
      quantity: "item.quantity",
      expireDate: "item.expireDate",
    };
    const orderColumn = sortFieldMap[query.sortBy] ?? "item.createTime";
    const orderDirection = String(query.order).toUpperCase() === "ASC" ? "ASC" : "DESC";

    const [rows, total] = await qb
      .orderBy(orderColumn, orderDirection as "ASC" | "DESC")
      .skip((pageNum - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const list = await this.attachTags(rows, ownerId);

    return {
      data: list,
      page: { pageNum, pageSize, total },
    };
  }

  /**
   * 物品详情
   */
  async getItemDetail(ownerId: string, id: string) {
    const item = await this.itemRepo.findOne({
      where: { id: id.toString(), ownerId, isDeleted: 0 },
    });
    if (!item) {
      throw new BusinessException("物品不存在或无权访问");
    }

    const [withTags] = await this.attachTags([item], ownerId);
    return withTags;
  }

  /**
   * 新增物品
   */
  async createItem(ownerId: string, dto: CreateStorageItemDto) {
    await this.assertCategoryAccessible(ownerId, dto.categoryId);
    const tagIds = await this.filterValidTagIds(ownerId, dto.tagIds);

    const item = this.itemRepo.create({
      ...this.normalizeItemPayload(dto),
      ownerId,
      quantity: dto.quantity ?? 1,
      status: dto.status ?? 1,
    });

    const saved = await this.itemRepo.save(item);
    await this.replaceItemTags(saved.id, tagIds);

    return this.getItemDetail(ownerId, saved.id);
  }

  /**
   * 修改物品
   */
  async updateItem(ownerId: string, id: string, dto: UpdateStorageItemDto) {
    const item = await this.itemRepo.findOne({
      where: { id: id.toString(), ownerId, isDeleted: 0 },
    });
    if (!item) {
      throw new BusinessException("物品不存在或无权访问");
    }

    if (dto.categoryId !== undefined) {
      await this.assertCategoryAccessible(ownerId, dto.categoryId);
    }

    Object.assign(item, this.normalizeItemPayload(dto, true));

    await this.itemRepo.save(item);

    if (dto.tagIds !== undefined) {
      const tagIds = await this.filterValidTagIds(ownerId, dto.tagIds);
      await this.replaceItemTags(item.id, tagIds);
    }

    return this.getItemDetail(ownerId, item.id);
  }

  /**
   * 删除物品（支持逗号分隔批量，逻辑删除）
   */
  async deleteItems(ownerId: string, ids: string) {
    const idArray = String(ids)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    if (!idArray.length) {
      throw new BusinessException("请选择要删除的物品");
    }

    const targets = await this.itemRepo.find({
      where: { id: In(idArray), ownerId, isDeleted: 0 },
    });
    if (targets.length !== idArray.length) {
      throw new BusinessException("部分物品不存在或无权删除");
    }

    await this.itemRepo.softDelete?.(idArray).catch(() => undefined);

    // 统一走逻辑删除，保持与项目其它模块一致的语义
    await this.itemRepo.update(idArray, { isDeleted: 1 });
    await this.itemTagRepo.update({ itemId: In(idArray) }, { isDeleted: 1 });

    return { success: true, message: `成功删除 ${idArray.length} 个物品` };
  }

  /**
   * 调整物品数量
   */
  async changeItemQuantity(ownerId: string, id: string, delta: number) {
    const item = await this.itemRepo.findOne({
      where: { id: id.toString(), ownerId, isDeleted: 0 },
    });
    if (!item) {
      throw new BusinessException("物品不存在或无权访问");
    }

    const next = Number(item.quantity || 0) + Number(delta);
    if (next < 0) {
      throw new BusinessException("数量不能小于 0");
    }

    item.quantity = next;
    await this.itemRepo.save(item);
    return { id: item.id, quantity: item.quantity };
  }

  /**
   * 归档 / 取消归档（切换 status）
   */
  async toggleItemStatus(ownerId: string, id: string, status: number) {
    const item = await this.itemRepo.findOne({
      where: { id: id.toString(), ownerId, isDeleted: 0 },
    });
    if (!item) {
      throw new BusinessException("物品不存在或无权访问");
    }

    item.status = status;
    await this.itemRepo.save(item);
    return { id: item.id, status: item.status };
  }

  // ==========================================================================
  // 统计
  // ==========================================================================

  /**
   * 收纳概览统计
   */
  async getOverview(ownerId: string) {
    const [itemCount, inStockCount, archivedCount, categoryCount, tagCount] = await Promise.all([
      this.itemRepo.count({ where: { ownerId, isDeleted: 0 } }),
      this.itemRepo.count({ where: { ownerId, isDeleted: 0, status: 1 } }),
      this.itemRepo.count({ where: { ownerId, isDeleted: 0, status: 0 } }),
      this.categoryRepo.count({
        where: [{ ownerId, isDeleted: 0 }, { ownerId: null, isDeleted: 0 }] as never,
      }),
      this.tagRepo.count({
        where: [{ ownerId, isDeleted: 0 }, { ownerId: null, isDeleted: 0 }] as never,
      }),
    ]);

    const aggregate = await this.itemRepo
      .createQueryBuilder("item")
      .select("COALESCE(SUM(item.quantity), 0)", "totalQuantity")
      .addSelect("COALESCE(SUM(item.quantity * item.price), 0)", "totalValue")
      .where("item.isDeleted = :isDeleted", { isDeleted: 0 })
      .andWhere("item.ownerId = :ownerId", { ownerId })
      .getRawOne<{ totalQuantity: string; totalValue: string }>();

    const now = new Date();
    const deadline = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const expiringSoonCount = await this.itemRepo
      .createQueryBuilder("item")
      .where("item.isDeleted = :isDeleted", { isDeleted: 0 })
      .andWhere("item.ownerId = :ownerId", { ownerId })
      .andWhere("item.expireDate IS NOT NULL")
      .andWhere("item.expireDate BETWEEN :now AND :deadline", { now, deadline })
      .getCount();

    return {
      itemCount,
      inStockCount,
      archivedCount,
      categoryCount,
      tagCount,
      totalQuantity: Number(aggregate?.totalQuantity ?? 0),
      totalValue: Number(aggregate?.totalValue ?? 0),
      expiringSoonCount,
    };
  }

  // ==========================================================================
  // 分类
  // ==========================================================================

  async getCategoryPage(ownerId: string, query: StorageCategoryQueryDto) {
    const pageNum = Number(query.pageNum) > 0 ? Number(query.pageNum) : 1;
    const pageSize = Number(query.pageSize) > 0 ? Number(query.pageSize) : 10;

    const qb = this.categoryRepo
      .createQueryBuilder("category")
      .where("category.isDeleted = :isDeleted", { isDeleted: 0 })
      .andWhere("(category.ownerId = :ownerId OR category.ownerId IS NULL)", { ownerId });

    if (query.keywords) {
      qb.andWhere("category.name LIKE :kw", { kw: `%${query.keywords}%` });
    }

    const [rows, total] = await qb
      .orderBy("category.sort", "ASC")
      .addOrderBy("category.id", "ASC")
      .skip((pageNum - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    const counts = await this.countItemsByCategory(ownerId);

    return {
      data: rows.map((c) => ({ ...c, itemCount: counts.get(c.id) ?? 0 })),
      page: { pageNum, pageSize, total },
    };
  }

  /**
   * 分类下拉列表（不分页，供移动端选择器使用）
   */
  async getCategoryOptions(ownerId: string) {
    const rows = await this.categoryRepo.find({
      where: [
        { ownerId, isDeleted: 0, status: 1 },
        { ownerId: null, isDeleted: 0, status: 1 },
      ] as never,
      order: { sort: "ASC", id: "ASC" },
    });

    const counts = await this.countItemsByCategory(ownerId);
    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      icon: c.icon,
      color: c.color,
      isPublic: c.ownerId === null,
      itemCount: counts.get(c.id) ?? 0,
    }));
  }

  async createCategory(ownerId: string, dto: StorageCategoryFormDto) {
    const exists = await this.categoryRepo.findOne({
      where: { ownerId, name: dto.name, isDeleted: 0 },
    });
    if (exists) {
      throw new BusinessException("同名分类已存在");
    }

    const entity = this.categoryRepo.create({
      ...dto,
      ownerId,
      sort: dto.sort ?? 0,
      status: dto.status ?? 1,
    });
    return await this.categoryRepo.save(entity);
  }

  async updateCategory(ownerId: string, id: string, dto: Partial<StorageCategoryFormDto>) {
    const entity = await this.findOwnedCategory(ownerId, id);

    if (dto.name && dto.name !== entity.name) {
      const dup = await this.categoryRepo.findOne({
        where: { ownerId, name: dto.name, isDeleted: 0 },
      });
      if (dup) {
        throw new BusinessException("同名分类已存在");
      }
    }

    Object.assign(entity, dto);
    return await this.categoryRepo.save(entity);
  }

  async deleteCategory(ownerId: string, ids: string) {
    const idArray = String(ids)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    if (!idArray.length) {
      throw new BusinessException("请选择要删除的分类");
    }

    for (const id of idArray) {
      await this.findOwnedCategory(ownerId, id);

      const used = await this.itemRepo.count({
        where: { ownerId, categoryId: id, isDeleted: 0 },
      });
      if (used > 0) {
        throw new BusinessException(`该分类下还有 ${used} 个物品，请先移动或删除后再试`);
      }
    }

    await this.categoryRepo.update(idArray, { isDeleted: 1 });
    return { success: true, message: `成功删除 ${idArray.length} 个分类` };
  }

  // ==========================================================================
  // 标签
  // ==========================================================================

  async getTagList(ownerId: string) {
    const rows = await this.tagRepo.find({
      where: [{ ownerId, isDeleted: 0 }, { ownerId: null, isDeleted: 0 }] as never,
      order: { id: "ASC" },
    });

    const counts = await this.countItemsByTag(ownerId);
    return rows.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color,
      isPublic: t.ownerId === null,
      itemCount: counts.get(t.id) ?? 0,
    }));
  }

  async createTag(ownerId: string, dto: StorageTagFormDto) {
    const exists = await this.tagRepo.findOne({
      where: { ownerId, name: dto.name, isDeleted: 0 },
    });
    if (exists) {
      throw new BusinessException("同名标签已存在");
    }

    const entity = this.tagRepo.create({ ...dto, ownerId });
    return await this.tagRepo.save(entity);
  }

  async updateTag(ownerId: string, id: string, dto: Partial<StorageTagFormDto>) {
    const entity = await this.findOwnedTag(ownerId, id);

    if (dto.name && dto.name !== entity.name) {
      const dup = await this.tagRepo.findOne({
        where: { ownerId, name: dto.name, isDeleted: 0 },
      });
      if (dup) {
        throw new BusinessException("同名标签已存在");
      }
    }

    Object.assign(entity, dto);
    return await this.tagRepo.save(entity);
  }

  async deleteTag(ownerId: string, ids: string) {
    const idArray = String(ids)
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    if (!idArray.length) {
      throw new BusinessException("请选择要删除的标签");
    }

    for (const id of idArray) {
      await this.findOwnedTag(ownerId, id);
    }

    await this.tagRepo.update(idArray, { isDeleted: 1 });
    await this.itemTagRepo.update({ tagId: In(idArray) }, { isDeleted: 1 });

    return { success: true, message: `成功删除 ${idArray.length} 个标签` };
  }

  // ==========================================================================
  // 内部工具
  // ==========================================================================

  /**
   * 为物品列表附加标签信息，避免 N+1 查询
   */
  private async attachTags(items: StorageItem[], ownerId: string) {
    if (!items.length) return [];

    const itemIds = items.map((i) => i.id);
    const relations = await this.itemTagRepo.find({
      where: { itemId: In(itemIds), isDeleted: 0 },
    });

    const tagIds = [...new Set(relations.map((r) => r.tagId))];
    const tags = tagIds.length
      ? await this.tagRepo.find({ where: { id: In(tagIds), isDeleted: 0 } })
      : [];
    const tagMap = new Map(tags.map((t) => [t.id, t]));

    const grouped = new Map<string, StorageTag[]>();
    for (const rel of relations) {
      const tag = tagMap.get(rel.tagId);
      if (!tag) continue;
      const bucket = grouped.get(rel.itemId) ?? [];
      bucket.push(tag);
      grouped.set(rel.itemId, bucket);
    }

    return items.map((item) => ({
      ...item,
      tags: (grouped.get(item.id) ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
      })),
    }));
  }

  /**
   * 重建物品的标签关联
   */
  private async replaceItemTags(itemId: string, tagIds: string[]) {
    await this.itemTagRepo.update({ itemId }, { isDeleted: 1 });
    if (!tagIds.length) return;

    const rows = tagIds.map((tagId) => this.itemTagRepo.create({ itemId, tagId }));
    await this.itemTagRepo.save(rows);
  }

  /**
   * 过滤出当前用户可用的标签ID（自己的 + 公共的）
   */
  private async filterValidTagIds(ownerId: string, tagIds?: string[]) {
    if (!tagIds?.length) return [];

    const unique = [...new Set(tagIds.filter(Boolean))];
    const valid = await this.tagRepo.find({
      where: { id: In(unique), isDeleted: 0 },
    });

    return valid
      .filter((t) => t.ownerId === ownerId || t.ownerId === null)
      .map((t) => t.id);
  }

  /**
   * 校验分类存在且可被当前用户使用
   */
  private async assertCategoryAccessible(ownerId: string, categoryId?: string) {
    if (!categoryId) return;

    const category = await this.categoryRepo.findOne({
      where: { id: categoryId.toString(), isDeleted: 0 },
    });
    if (!category) {
      throw new BusinessException("所选分类不存在");
    }
    if (category.ownerId !== null && category.ownerId !== ownerId) {
      throw new BusinessException("无权使用该分类");
    }
  }

  private async findOwnedCategory(ownerId: string, id: string) {
    const entity = await this.categoryRepo.findOne({
      where: { id: id.toString(), ownerId, isDeleted: 0 },
    });
    if (!entity) {
      throw new BusinessException("分类不存在或为公共分类，无法修改");
    }
    return entity;
  }

  private async findOwnedTag(ownerId: string, id: string) {
    const entity = await this.tagRepo.findOne({
      where: { id: id.toString(), ownerId, isDeleted: 0 },
    });
    if (!entity) {
      throw new BusinessException("标签不存在或为公共标签，无法修改");
    }
    return entity;
  }

  /**
   * 归一化物品入参：空字符串统一转 null，日期字符串转 Date
   */
  private normalizeItemPayload(dto: CreateStorageItemDto | UpdateStorageItemDto, partial = false) {
    const payload: Record<string, unknown> = {};

    const assign = (key: string, value: unknown, transform?: (v: never) => unknown) => {
      if (value === undefined) return;
      if (value === "" || value === null) {
        payload[key] = null;
        return;
      }
      payload[key] = transform ? transform(value as never) : value;
    };

    assign("name", dto.name);
    assign("categoryId", dto.categoryId);
    assign("coverUrl", dto.coverUrl);
    assign("imageUrls", dto.imageUrls);
    assign("unit", dto.unit);
    assign("price", dto.price);
    assign("location", dto.location);
    assign("remark", dto.remark);
    assign("quantity", dto.quantity);
    assign("status", dto.status);

    // 日期字段：仅接受 yyyy-MM-dd 或 ISO 字符串
    assign("purchaseDate", dto.purchaseDate, (v: string) => (v ? new Date(v) : null));
    assign("expireDate", dto.expireDate, (v: string) => (v ? new Date(v) : null));

    if (partial && Object.keys(payload).length === 0) {
      return payload;
    }
    return payload;
  }

  private async countItemsByCategory(ownerId: string) {
    const rows = await this.itemRepo
      .createQueryBuilder("item")
      .select("item.categoryId", "categoryId")
      .addSelect("COUNT(1)", "count")
      .where("item.isDeleted = :isDeleted", { isDeleted: 0 })
      .andWhere("item.ownerId = :ownerId", { ownerId })
      .andWhere("item.categoryId IS NOT NULL")
      .groupBy("item.categoryId")
      .getRawMany<{ categoryId: string; count: string }>();

    return new Map(rows.map((r) => [String(r.categoryId), Number(r.count)]));
  }

  private async countItemsByTag(ownerId: string) {
    const rows = await this.dataSource
      .createQueryBuilder()
      .select("sit.tag_id", "tagId")
      .addSelect("COUNT(DISTINCT sit.item_id)", "count")
      .from("storage_item_tag", "sit")
      .innerJoin("storage_item", "item", "item.id = sit.item_id AND item.is_deleted = 0")
      .where("sit.is_deleted = 0")
      .andWhere("item.owner_id = :ownerId", { ownerId })
      .groupBy("sit.tag_id")
      .getRawMany<{ tagId: string; count: string }>();

    return new Map(rows.map((r) => [String(r.tagId), Number(r.count)]));
  }
}
