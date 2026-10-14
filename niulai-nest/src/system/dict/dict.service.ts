import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { toBigInt } from "../../common/prisma/prisma-ids";
import { auditOnCreate } from "../../common/prisma/audit.util";
import { BusinessException } from "../../common/exceptions/business.exception";
import { DictFormDto } from "./dto/create-dict.dto";
import { UpdateDictDto } from "./dto/update-dict.dto";
import { CreateDictItemDto } from "./dto/create-dict-item.dto";
import { UpdateDictItemDto } from "./dto/update-dict-item.dto";
import { SseService } from "../../message/sse.service";

/**
 * 字典服务（Prisma 版）
 *
 * 数据访问客户端的选择：字典属**系统元数据**，按 PEL-10c 移植约定第 1 条走
 * **基础客户端**（`this.prisma.sysDict` / `this.prisma.sysDictItem`），不套数据权限。
 *
 * 主键出参：保持 Prisma 的 **BigInt** 形态，由全局 `BigInt.prototype.toJSON` 垫片
 * （`src/common/prisma/bigint-json.ts`，`main.ts` 最早启用）序列化成字符串，
 * 从而保住原 `bigNumberStrings: true` 的对外契约 —— 见移植约定第 5 条。
 *
 * ⚠️ `sys_dict_item` **没有 `is_deleted` 列**（字典项按物理删除处理），
 * 因此字典项的读写**一律不带逻辑删除过滤**，与原实现一致。
 */
@Injectable()
export class DictService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sseService: SseService
  ) {}

  /**
   * 字典分页列表
   */
  async getDictPage(pageNum: number, pageSize: number, keywords: string) {
    const pageNumSafe = Number(pageNum) > 0 ? Number(pageNum) : 1;
    const pageSizeSafe = Number(pageSize) > 0 ? Number(pageSize) : 20;

    const where: Prisma.SysDictWhereInput = { isDeleted: 0 };

    if (keywords) {
      // 原实现是 MySQL 的 `name LIKE ? OR dict_code LIKE ?`，
      // MySQL 默认排序规则不区分大小写 ⇒ 显式 mode: "insensitive"
      where.OR = [
        { name: { contains: keywords, mode: "insensitive" } },
        { dictCode: { contains: keywords, mode: "insensitive" } },
      ];
    }

    const [dicts, total] = await Promise.all([
      this.prisma.sysDict.findMany({
        where,
        select: { id: true, name: true, dictCode: true, status: true },
        orderBy: { createTime: "desc" },
        skip: (pageNumSafe - 1) * pageSizeSafe,
        take: pageSizeSafe,
      }),
      this.prisma.sysDict.count({ where }),
    ]);

    return {
      data: dicts,
      page: {
        pageNum: pageNumSafe,
        pageSize: pageSizeSafe,
        total,
      },
    };
  }

  /**
   * 字典下拉选项
   */
  async getDictOptions() {
    const dicts = await this.prisma.sysDict.findMany({
      where: { status: 1, isDeleted: 0 },
      orderBy: { createTime: "desc" },
      select: { dictCode: true, name: true },
    });

    return dicts.map((d) => ({
      label: d.name,
      value: d.dictCode,
    }));
  }

  /**
   * 创建字典
   */
  async createDict(dictFormDto: DictFormDto) {
    const { dictCode, name, status, remark } = dictFormDto;

    const existDict = await this.prisma.sysDict.findFirst({
      where: { dictCode, isDeleted: 0 },
      select: { id: true },
    });

    if (existDict) {
      throw new BusinessException("字典已存在");
    }

    // 原实现走 save()，createBy/updateBy/createTime/updateTime 由 AuditSubscriber 自动填充
    const dict = await this.prisma.sysDict.create({
      data: {
        dictCode,
        name,
        status,
        remark,
        ...auditOnCreate(),
      },
    });

    this.sseService.sendDictChange(dictCode);
    return dict;
  }

  /**
   * 获取字典表单
   */
  async getDictForm(id: string | number) {
    const dictId = toBigInt(id);
    const dict =
      dictId === null
        ? null
        : await this.prisma.sysDict.findFirst({ where: { id: dictId, isDeleted: 0 } });

    if (!dict) {
      throw new BusinessException("字典不存在");
    }

    return {
      id: dict.id,
      name: dict.name,
      dictCode: dict.dictCode,
      status: dict.status,
      remark: dict.remark,
    };
  }

  /**
   * 更新字典
   */
  async updateDict(id: string | number, updateDictDto: UpdateDictDto) {
    const dictId = toBigInt(id);
    const dict =
      dictId === null
        ? null
        : await this.prisma.sysDict.findFirst({ where: { id: dictId, isDeleted: 0 } });

    if (!dict) {
      throw new BusinessException("字典不存在");
    }

    // 原实现走 `repository.update(id, {...dto, updateBy})`：
    //  · TypeORM 的 update 会**跳过值为 undefined 的属性**
    //    （源码注释原话：it doesn't make sense to update undefined properties, so just skip them），
    //    故这里也只赋「显式传入」的字段；
    //  · 且 `repository.update()` **不触发 AuditSubscriber** ⇒ 原实现**从不刷新 updateTime**。
    //    本次刻意保持该行为（已登记为已知缺陷：更新字典后 updateTime 不变；
    //    与之相对的 deleteDict 才是显式赋 updateTime 的那个）。
    const data: Prisma.SysDictUpdateInput = {};
    if (updateDictDto.dictCode !== undefined) data.dictCode = updateDictDto.dictCode;
    if (updateDictDto.name !== undefined) data.name = updateDictDto.name;
    if (updateDictDto.status !== undefined) data.status = updateDictDto.status;
    if (updateDictDto.remark !== undefined) data.remark = updateDictDto.remark;
    const updateBy = toBigInt(updateDictDto.updateBy);
    if (updateBy !== null) data.updateBy = updateBy;

    await this.prisma.sysDict.update({ where: { id: dictId }, data });
    this.sseService.sendDictChange(dict.dictCode);
    return true;
  }

  /**
   * 删除字典（逻辑删除）
   */
  async deleteDict(id: string | number, updateBy: string | number) {
    const dictId = toBigInt(id);
    const dict =
      dictId === null
        ? null
        : await this.prisma.sysDict.findFirst({ where: { id: dictId, isDeleted: 0 } });

    if (!dict) {
      throw new BusinessException("字典不存在");
    }

    // 这里原实现是**显式**赋 updateTime 的（与 updateDict 刻意不同，保持原样）
    await this.prisma.sysDict.update({
      where: { id: dictId },
      data: {
        isDeleted: 1,
        updateBy: toBigInt(updateBy),
        updateTime: new Date(),
      },
    });

    this.sseService.sendDictChange(dict.dictCode);
    return true;
  }

  //---------------------------------------------------
  // 字典项相关接口
  //---------------------------------------------------

  /**
   * 字典数据分页列表
   */
  async getDictItemPage(pageNum: number, pageSize: number, dictCode: string, keywords?: string) {
    const pageNumSafe = Number(pageNum) > 0 ? Number(pageNum) : 1;
    const pageSizeSafe = Number(pageSize) > 0 ? Number(pageSize) : 20;

    // 字典项无 is_deleted 列，故原实现也没有逻辑删除过滤 —— 保持一致
    const where: Prisma.SysDictItemWhereInput = { dictCode };

    if (keywords) {
      where.OR = [
        { label: { contains: keywords, mode: "insensitive" } },
        { value: { contains: keywords, mode: "insensitive" } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.sysDictItem.findMany({
        where,
        select: {
          id: true,
          dictCode: true,
          label: true,
          value: true,
          sort: true,
          status: true,
          tagType: true,
        },
        orderBy: { sort: "asc" },
        skip: (pageNumSafe - 1) * pageSizeSafe,
        take: pageSizeSafe,
      }),
      this.prisma.sysDictItem.count({ where }),
    ]);

    return {
      data: items,
      page: {
        pageNum: pageNumSafe,
        pageSize: pageSizeSafe,
        total,
      },
    };
  }

  /**
   * 字典项列表
   */
  async getDictItems(dictCode: string) {
    return await this.prisma.sysDictItem.findMany({
      where: {
        dictCode,
      },
      orderBy: {
        sort: "asc",
      },
      select: { label: true, value: true, tagType: true },
    });
  }

  /**
   * 创建字典项
   */
  async createDictItem(createDictItemDto: CreateDictItemDto) {
    const { dictCode, label, value, sort, status, tagType } = createDictItemDto;

    // 检查字典是否存在
    const dict = await this.prisma.sysDict.findFirst({
      where: { dictCode, isDeleted: 0 },
      select: { id: true },
    });

    if (!dict) {
      throw new BusinessException("字典不存在");
    }

    // 检查值是否已存在（字典项无 is_deleted，故不做逻辑删除过滤 —— 与原实现一致）
    const existItem = await this.prisma.sysDictItem.findFirst({
      where: { dictCode, value },
      select: { id: true },
    });

    if (existItem) {
      throw new BusinessException(`字典项值 "${value}" 已存在`);
    }

    // ⚠️ 原实现的 create() 只传了这 6 个字段，**从不下发 remark**
    //    （尽管 CreateDictItemDto 里有 remark）⇒ 保持原样（已登记为已知缺陷）。
    const savedItem = await this.prisma.sysDictItem.create({
      data: {
        dictCode,
        label,
        value,
        ...(sort !== undefined ? { sort } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(tagType !== undefined ? { tagType } : {}),
        // 原实现走 save()，审计字段由 AuditSubscriber 填充
        // （DTO 的 createBy 会被上下文用户覆盖，与订阅器语义一致）
        ...auditOnCreate(toBigInt(createDictItemDto.createBy)),
      },
    });

    this.sseService.sendDictChange(dictCode);

    return {
      id: savedItem.id,
      dictCode,
      label: savedItem.label,
      value: savedItem.value,
      sort: savedItem.sort,
      status: savedItem.status,
      tagType: savedItem.tagType,
    };
  }

  /**
   * 字典项表单数据
   */
  async getDictItemForm(id: string | number) {
    const itemId = toBigInt(id);
    const dictItem =
      itemId === null ? null : await this.prisma.sysDictItem.findFirst({ where: { id: itemId } });

    if (!dictItem) {
      throw new BusinessException("字典项不存在");
    }

    return {
      id: dictItem.id,
      dictCode: dictItem.dictCode,
      label: dictItem.label,
      value: dictItem.value,
      sort: dictItem.sort,
      status: dictItem.status,
      tagType: dictItem.tagType,
      remark: dictItem.remark,
    };
  }

  /**
   * 更新字典项
   */
  async updateDictItem(id: string | number, updateData: UpdateDictItemDto) {
    const itemId = toBigInt(id);
    const dictItem =
      itemId === null ? null : await this.prisma.sysDictItem.findFirst({ where: { id: itemId } });

    if (!dictItem) {
      throw new BusinessException("字典项不存在");
    }

    // 检查值是否已存在（排除自身）
    if (updateData.value) {
      const existItem = await this.prisma.sysDictItem.findFirst({
        where: {
          dictCode: dictItem.dictCode,
          value: updateData.value,
          id: { not: itemId },
        },
        select: { id: true },
      });

      if (existItem) {
        throw new BusinessException(`字典项值 "${updateData.value}" 已存在`);
      }
    }

    // 同 updateDict：只写显式传入的字段，且**不刷新 updateTime**（原实现走 update()，不触发订阅器）
    const data: Prisma.SysDictItemUpdateInput = {};
    if (updateData.dictCode !== undefined) data.dictCode = updateData.dictCode;
    if (updateData.label !== undefined) data.label = updateData.label;
    if (updateData.value !== undefined) data.value = updateData.value;
    if (updateData.sort !== undefined) data.sort = updateData.sort;
    if (updateData.status !== undefined) data.status = updateData.status;
    if (updateData.tagType !== undefined) data.tagType = updateData.tagType;
    if (updateData.remark !== undefined) data.remark = updateData.remark;
    const updateBy = toBigInt(updateData.updateBy);
    if (updateBy !== null) data.updateBy = updateBy;

    await this.prisma.sysDictItem.update({ where: { id: itemId }, data });
    this.sseService.sendDictChange(dictItem.dictCode);
    return true;
  }

  /**
   * 删除字典项（**物理删除**）
   */
  async deleteDictItems(id: string | number) {
    const itemId = toBigInt(id);
    const dictItem =
      itemId === null ? null : await this.prisma.sysDictItem.findFirst({ where: { id: itemId } });

    if (!dictItem) {
      throw new BusinessException("字典项不存在");
    }

    // 字典项属系统元数据，原实现用 repository.delete() 物理删除，此处保持一致。
    // 用 deleteMany 而非 delete：前者不存在时不抛 P2025，语义与 TypeORM 的 delete 一致。
    await this.prisma.sysDictItem.deleteMany({ where: { id: itemId } });
    this.sseService.sendDictChange(dictItem.dictCode);
    return true;
  }
}
