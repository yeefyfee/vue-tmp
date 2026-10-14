import { Injectable } from "@nestjs/common";
import { Prisma, SysDept as SysDeptModel } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { toBigInt } from "../../common/prisma/prisma-ids";
import { auditOnCreate, auditOnUpdate } from "../../common/prisma/audit.util";
import { CreateDeptDto } from "./dto/create-dept.dto";
import { UpdateDeptDto } from "./dto/update-dept.dto";
import { BusinessException } from "../../common/exceptions/business.exception";

/**
 * 部门对外视图。
 *
 * 关键：主键与父节点 ID 一律转成**字符串**。
 * 原因有二：
 *  1. 原 TypeORM 配置 `bigNumberStrings: true`，主键本就以字符串出入，前端全程按 string 处理；
 *  2. 本模块的 `findByIds` 仍被尚未迁移的 `user.service` 消费，它需要 `dept.id` 能与
 *     `user.deptId.toString()` 直接比对，也必须能回填给 TypeORM 的 `userRepository.create({ deptId })`。
 */
export interface DeptView {
  id: string;
  name: string;
  code: string;
  parentId: string;
  treePath: string;
  sort: number;
  status: number;
  createBy: string | null;
  createTime: Date | null;
  updateBy: string | null;
  updateTime: Date | null;
  isDeleted: number;
}

/** 部门树节点（列表用） */
export type DeptTreeNode = DeptView & { children: DeptTreeNode[] };

/** 部门下拉树节点 */
export interface DeptOptionNode {
  label: string;
  value: string;
  children: DeptOptionNode[];
}

function toDeptView(dept: SysDeptModel): DeptView {
  return {
    id: dept.id.toString(),
    name: dept.name,
    code: dept.code,
    // 父节点为空或 0 均表示顶层；统一成字符串，供树构建做键比较
    parentId: dept.parentId === null ? "0" : dept.parentId.toString(),
    treePath: dept.treePath,
    sort: dept.sort,
    status: dept.status,
    createBy: dept.createBy === null ? null : dept.createBy.toString(),
    createTime: dept.createTime,
    updateBy: dept.updateBy === null ? null : dept.updateBy.toString(),
    updateTime: dept.updateTime,
    isDeleted: dept.isDeleted,
  };
}

/** 顶层判定：空、0 都算根 */
function isRootDept(view: DeptView): boolean {
  return !view.parentId || view.parentId === "0";
}

/**
 * 部门服务
 */
@Injectable()
export class DeptService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 查询部门列表（树形）
   */
  async findAll(keyword?: string, status?: string | number): Promise<DeptTreeNode[]> {
    const where: Prisma.SysDeptWhereInput = { isDeleted: 0 };

    if (keyword) {
      // MySQL 默认排序规则不区分大小写，PG 的 LIKE 区分 ⇒ 显式 insensitive
      where.name = { contains: keyword, mode: "insensitive" };
    }

    if (status !== undefined && status !== null && status !== "") {
      where.status = Number(status);
    }

    const deptList = await this.prisma.scoped.sysDept.findMany({
      where,
      orderBy: { sort: "asc" },
    });

    return this.buildDeptTree(deptList.map(toDeptView));
  }

  /**
   * 查询部门下拉树形列表
   */
  async findAllOptions(): Promise<DeptOptionNode[]> {
    const depts = await this.prisma.scoped.sysDept.findMany({
      where: { isDeleted: 0 },
      orderBy: { sort: "asc" },
    });
    return this.buildOptionsTree(depts.map(toDeptView));
  }

  /**
   * 根据 ID 列表查询部门
   *
   * 走**基础客户端**：这是内部引用查询（用于回填部门名 / 树路径），
   * 必须总能查到，不能被数据权限过滤掉 —— 对齐原实现里
   * `RequestContext.setDataPermissionConfig(null)` 的意图。
   */
  async findByIds(ids: (number | string)[]): Promise<DeptView[]> {
    if (!ids || ids.length === 0) return [];
    const idList = ids.map((id) => toBigInt(id)).filter((id): id is bigint => id !== null);
    if (!idList.length) return [];

    const depts = await this.prisma.sysDept.findMany({ where: { id: { in: idList } } });
    return depts.map(toDeptView);
  }

  async findByCode(code: string): Promise<DeptView | null> {
    if (!code?.trim()) return null;
    const dept = await this.prisma.sysDept.findFirst({
      where: { code: code.trim(), isDeleted: 0 },
    });
    return dept ? toDeptView(dept) : null;
  }

  /**
   * 根据部门编码或名称查找部门（导入时使用，支持编码或名称匹配）
   */
  async findByCodeOrName(codeOrName: string): Promise<DeptView | null> {
    const value = codeOrName?.trim();
    if (!value) return null;

    // 先按编码查
    const deptByCode = await this.prisma.sysDept.findFirst({
      where: { code: value, isDeleted: 0 },
    });
    if (deptByCode) return toDeptView(deptByCode);

    // 再按名称查
    const deptByName = await this.prisma.sysDept.findFirst({
      where: { name: value, isDeleted: 0 },
    });
    return deptByName ? toDeptView(deptByName) : null;
  }

  /**
   * 创建部门
   */
  async create(createDeptDto: CreateDeptDto): Promise<DeptView> {
    // 检查部门编码是否已存在
    if (createDeptDto.code) {
      const existDept = await this.prisma.sysDept.findFirst({
        where: { code: createDeptDto.code, isDeleted: 0 },
        select: { id: true },
      });
      if (existDept) {
        throw new BusinessException(`部门编码【${createDeptDto.code}】已存在`);
      }
    }

    // 检查部门名称是否已存在
    if (createDeptDto.name) {
      const existName = await this.prisma.sysDept.findFirst({
        where: { name: createDeptDto.name, isDeleted: 0 },
        select: { id: true },
      });
      if (existName) {
        throw new BusinessException(`部门名称【${createDeptDto.name}】已存在`);
      }
    }

    const parentId = this.parseId(createDeptDto.parentId, "父节点ID") ?? 0n;
    const treePath = await this.buildTreePath(createDeptDto.parentId);

    const created = await this.prisma.sysDept.create({
      data: {
        name: createDeptDto.name,
        code: createDeptDto.code,
        parentId,
        treePath,
        ...(createDeptDto.sort !== undefined ? { sort: createDeptDto.sort } : {}),
        ...(createDeptDto.status !== undefined ? { status: createDeptDto.status } : {}),
        // 原实现走 save()，审计字段由 AuditSubscriber 自动填充；此处显式补齐
        ...auditOnCreate(toBigInt(createDeptDto.createBy)),
        // DTO 允许显式传 createTime（原实现会覆盖订阅器的值）；
        // 仅在确为 Date 时才采纳 —— 未加 @Type 转换时 JSON 字符串不是 Date，硬传会让 Prisma 报错
        ...(createDeptDto.createTime instanceof Date
          ? { createTime: createDeptDto.createTime }
          : {}),
      },
    });

    return toDeptView(created);
  }

  /**
   * 获取部门表单
   */
  async getDeptForm(id: string | number): Promise<DeptView | null> {
    const deptId = toBigInt(id);
    if (deptId === null) return null;

    const dept = await this.prisma.scoped.sysDept.findFirst({
      where: { id: deptId, isDeleted: 0 },
    });
    return dept ? toDeptView(dept) : null;
  }

  /**
   * 编辑部门
   */
  async updateDept(id: string | number, updateDeptDto: UpdateDeptDto): Promise<DeptView | null> {
    const deptId = toBigInt(id);
    if (deptId === null) return null;

    const dept = await this.prisma.sysDept.findFirst({
      where: { id: deptId, isDeleted: 0 },
    });
    if (!dept) return null;

    // 检查部门编码是否已存在（排除当前部门）
    if (updateDeptDto.code) {
      const existCode = await this.prisma.sysDept.findFirst({
        where: { code: updateDeptDto.code, isDeleted: 0 },
        select: { id: true },
      });
      if (existCode && existCode.id.toString() !== deptId.toString()) {
        throw new BusinessException(`部门编码【${updateDeptDto.code}】已存在`);
      }
    }

    // 检查部门名称是否已存在（排除当前部门）
    if (updateDeptDto.name) {
      const existName = await this.prisma.sysDept.findFirst({
        where: { name: updateDeptDto.name, isDeleted: 0 },
        select: { id: true },
      });
      if (existName && existName.id.toString() !== deptId.toString()) {
        throw new BusinessException(`部门名称【${updateDeptDto.name}】已存在`);
      }
    }

    // 只写入显式传入的字段（对齐原实现「过滤 undefined」的语义）
    // 原实现走 repository.update()，不触发订阅器，updateTime/updateBy 本就是显式赋值的
    const data: Prisma.SysDeptUpdateInput = {
      ...auditOnUpdate(this.parseId(updateDeptDto.updateBy, "修改人ID")),
    };
    if (updateDeptDto.name !== undefined) data.name = updateDeptDto.name;
    if (updateDeptDto.code !== undefined) data.code = updateDeptDto.code;
    if (updateDeptDto.sort !== undefined) data.sort = updateDeptDto.sort;
    if (updateDeptDto.status !== undefined) data.status = updateDeptDto.status;
    if (updateDeptDto.parentId !== undefined) {
      data.parentId = this.parseId(updateDeptDto.parentId, "父节点ID") ?? 0n;
      // 变更父节点后必须重算 treePath，否则子树的数据权限筛选会失准
      data.treePath = await this.buildTreePath(updateDeptDto.parentId);
    }

    await this.prisma.sysDept.update({ where: { id: deptId }, data });

    const updated = await this.prisma.sysDept.findFirst({ where: { id: deptId } });
    return updated ? toDeptView(updated) : null;
  }

  /**
   * 删除部门
   */
  async deleteDept(id: string | number): Promise<boolean> {
    const deptId = toBigInt(id);
    if (deptId === null) return false;

    // 检查是否有子部门
    const hasChildren = await this.prisma.sysDept.findFirst({
      where: { parentId: deptId, isDeleted: 0 },
      select: { id: true },
    });
    if (hasChildren) {
      throw new BusinessException("该部门下有子部门，禁止删除");
    }

    // 检查是否有用户关联
    const hasUsers = await this.prisma.sysUser.findFirst({
      where: { deptId, isDeleted: 0 },
      select: { id: true },
    });
    if (hasUsers) {
      throw new BusinessException("该部门下有用户关联，禁止删除");
    }

    // 原实现为直接 UPDATE（不触发订阅器），故此处同样只改 isDeleted
    const result = await this.prisma.sysDept.updateMany({
      where: { id: deptId },
      data: { isDeleted: 1 },
    });
    return result.count > 0;
  }

  /**
   * 构建部门树结构
   *
   * ⚠️ 保留原实现的「孤儿丢弃」语义：父节点不在结果集里（被关键字/状态过滤掉，
   * 或父节点已逻辑删除）时，该部门既不入根也不挂树，直接从结果中消失。
   * 这是既有行为，本次移植不做变更（已在清单登记为已知缺陷）。
   */
  private buildDeptTree(deptList: DeptView[]): DeptTreeNode[] {
    const map = new Map<string, DeptTreeNode>();
    const roots: DeptTreeNode[] = [];

    for (const dept of deptList) {
      map.set(dept.id, { ...dept, children: [] });
    }

    for (const dept of deptList) {
      const node = map.get(dept.id);
      if (!node) continue;
      if (isRootDept(dept)) {
        roots.push(node);
        continue;
      }
      const parent = map.get(dept.parentId);
      if (parent) {
        parent.children.push(node);
      }
      // 父节点缺失 ⇒ 丢弃（对齐原实现）
    }

    return roots;
  }

  /**
   * 构建部门选项树（同样保留原实现的孤儿丢弃语义）
   */
  private buildOptionsTree(depts: DeptView[]): DeptOptionNode[] {
    const map = new Map<string, DeptOptionNode>();
    const roots: DeptOptionNode[] = [];

    for (const dept of depts) {
      map.set(dept.id, { label: dept.name, value: dept.id, children: [] });
    }

    for (const dept of depts) {
      const node = map.get(dept.id);
      if (!node) continue;
      if (isRootDept(dept)) {
        roots.push(node);
        continue;
      }
      const parent = map.get(dept.parentId);
      if (parent) {
        parent.children.push(node);
      }
    }

    return roots;
  }

  /**
   * 构建部门 treePath
   */
  private async buildTreePath(parentId?: string | number | null): Promise<string> {
    if (parentId === undefined || parentId === null || parentId === "") {
      return "0";
    }
    const pid = toBigInt(parentId);
    if (pid === null || pid === 0n) {
      return "0";
    }

    const parentDept = await this.prisma.sysDept.findFirst({
      where: { id: pid, isDeleted: 0 },
    });
    return parentDept ? `${parentDept.treePath}/${parentDept.id.toString()}` : "0";
  }

  /**
   * 解析可空 ID：空值返回 null；非空但格式非法则抛业务异常。
   * 比原实现「直接把字符串塞进 bigint 列」更早失败，避免静默变成顶部部门。
   */
  private parseId(value: string | number | null | undefined, label: string): bigint | null {
    if (value === null || value === undefined || value === "") return null;
    const parsed = toBigInt(value);
    if (parsed === null) {
      throw new BusinessException(`${label}格式不正确`);
    }
    return parsed;
  }
}
