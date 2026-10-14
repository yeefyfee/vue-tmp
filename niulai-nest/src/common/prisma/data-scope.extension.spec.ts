import { DataScopeEnum } from "../enums/data-scope.enum";
import { RoleDataScope } from "../models/role-data-scope.model";
import {
  buildDataScopeWhere,
  needsSubtreeDeptIds,
  type DataScopeSubject,
} from "./data-scope.extension";

/**
 * 数据权限编译器单测（PEL-10c）
 *
 * `buildDataScopeWhere` 是纯函数（不读上下文、不碰数据库），
 * 因此这里可以穷举边界，不需要起 PG / Redis。
 */

const CFG_USER = { deptField: "deptId", ownerField: "createBy" };

function subject(over: Partial<DataScopeSubject> = {}): DataScopeSubject {
  return {
    userId: "7",
    deptId: "3",
    isRoot: false,
    dataScopes: [],
    ...over,
  };
}

const ALL_FALSE_KEYS = (where: any) => Object.keys(where ?? {});

describe("buildDataScopeWhere（数据权限 → Prisma where 编译）", () => {
  describe("短路：不施加任何限制", () => {
    it("超级管理员直接放行", () => {
      expect(buildDataScopeWhere(CFG_USER, subject({ isRoot: true }))).toBeNull();
    });

    it("未登录（无 userId）放行 —— 与原实现一致", () => {
      expect(buildDataScopeWhere(CFG_USER, subject({ userId: null }))).toBeNull();
    });

    it("任一角色为「全部数据」即放行", () => {
      const where = buildDataScopeWhere(
        CFG_USER,
        subject({ dataScopes: [RoleDataScope.self("EMP"), RoleDataScope.all("ROOT")] })
      );
      expect(where).toBeNull();
    });

    it("两个维度都没声明时放行（无从表达限制，交由权限守卫处理）", () => {
      expect(
        buildDataScopeWhere({}, subject({ dataScopes: [RoleDataScope.self("EMP")] }))
      ).toBeNull();
    });
  });

  describe("fail-closed：编译不出条件时拒绝而非放行", () => {
    it("无任何角色数据范围 → 恒假", () => {
      const where = buildDataScopeWhere(CFG_USER, subject({ dataScopes: [] }));
      expect(where).toEqual({ deptId: { in: [] } });
    });

    it("仅有「本部门」范围但用户 deptId 缺失 → 恒假", () => {
      const where = buildDataScopeWhere(
        CFG_USER,
        subject({ deptId: null, dataScopes: [RoleDataScope.dept("MGR")] })
      );
      expect(where).toEqual({ deptId: { in: [] } });
    });

    it("仅有「本人」范围但 ownerField 未声明 → 恒假", () => {
      const where = buildDataScopeWhere(
        { deptField: "deptId" },
        subject({ dataScopes: [RoleDataScope.self("EMP")] })
      );
      expect(where).toEqual({ deptId: { in: [] } });
    });

    it("自定义范围但一个部门都没勾 → 恒假", () => {
      const where = buildDataScopeWhere(
        CFG_USER,
        subject({ dataScopes: [RoleDataScope.custom("CU", [])] })
      );
      expect(where).toEqual({ deptId: { in: [] } });
    });
  });

  describe("单角色：各数据范围的条件形态", () => {
    it("本部门 → 部门字段等值（BigInt）", () => {
      const where = buildDataScopeWhere(
        CFG_USER,
        subject({ deptId: "3", dataScopes: [RoleDataScope.dept("MGR")] })
      );
      expect(where).toEqual({ deptId: 3n });
    });

    it("仅本人 → 归属人字段等值（BigInt）", () => {
      const where = buildDataScopeWhere(
        CFG_USER,
        subject({ userId: "7", dataScopes: [RoleDataScope.self("EMP")] })
      );
      expect(where).toEqual({ createBy: 7n });
    });

    it("自定义部门 → 部门字段 IN 列表", () => {
      const where = buildDataScopeWhere(
        CFG_USER,
        subject({ dataScopes: [RoleDataScope.custom("CU", [1, 2, 3])] })
      );
      expect(where).toEqual({ deptId: { in: [1n, 2n, 3n] } });
    });

    it("本部门及子部门 → 部门字段 IN 预解析子树", () => {
      const where = buildDataScopeWhere(
        CFG_USER,
        subject({
          dataScopes: [RoleDataScope.deptAndSub("MGR")],
          subtreeDeptIds: ["1", "2", "9"],
        })
      );
      expect(where).toEqual({ deptId: { in: [1n, 2n, 9n] } });
    });

    it("单分支时直接返回该分支，不额外包一层 OR", () => {
      const where = buildDataScopeWhere(
        CFG_USER,
        subject({ dataScopes: [RoleDataScope.dept("MGR")] })
      );
      expect(ALL_FALSE_KEYS(where)).not.toContain("OR");
    });
  });

  describe("多角色：并集（OR）语义", () => {
    it("「本部门」+「仅本人」→ OR 两支", () => {
      const where = buildDataScopeWhere(
        CFG_USER,
        subject({
          userId: "7",
          deptId: "3",
          dataScopes: [RoleDataScope.dept("MGR"), RoleDataScope.self("EMP")],
        })
      );
      expect(where).toEqual({ OR: [{ deptId: 3n }, { createBy: 7n }] });
    });

    it("部分角色不产生条件时，只保留有效分支（不因此放行）", () => {
      const where = buildDataScopeWhere(
        CFG_USER,
        subject({
          deptId: null, // 让 DEPT 分支失效
          dataScopes: [RoleDataScope.dept("MGR"), RoleDataScope.self("EMP")],
        })
      );
      expect(where).toEqual({ createBy: 7n });
    });

    it("两支都失效 → 恒假（不能因为「都没条件」而放行）", () => {
      const where = buildDataScopeWhere(
        CFG_USER,
        subject({
          userId: "7",
          deptId: null,
          dataScopes: [RoleDataScope.dept("MGR"), RoleDataScope.deptAndSub("MGR2")],
        })
      );
      expect(where).toEqual({ deptId: { in: [] } });
    });
  });

  describe("取值健壮性", () => {
    it("userId / deptId 非数字时视为缺失（不抛错）", () => {
      const where = buildDataScopeWhere(
        CFG_USER,
        subject({
          userId: "abc",
          deptId: "not-a-number",
          dataScopes: [RoleDataScope.self("EMP"), RoleDataScope.dept("MGR")],
        })
      );
      expect(where).toEqual({ deptId: { in: [] } });
    });

    it("自定义部门 ID 里混入非法值时只保留合法项", () => {
      const where = buildDataScopeWhere(
        CFG_USER,
        subject({ dataScopes: [RoleDataScope.custom("CU", [1, "x" as unknown as number, 2])] })
      );
      expect(where).toEqual({ deptId: { in: [1n, 2n] } });
    });

    it("子树 id 为空数组时该分支失效", () => {
      const where = buildDataScopeWhere(
        CFG_USER,
        subject({ dataScopes: [RoleDataScope.deptAndSub("MGR")], subtreeDeptIds: [] })
      );
      expect(where).toEqual({ deptId: { in: [] } });
    });
  });

  describe("枚举口径一致性（防与 shared 包漂移）", () => {
    it("DataScopeEnum 的取值与 product 约定一致", () => {
      expect(DataScopeEnum.ALL).toBe(1);
      expect(DataScopeEnum.DEPT_AND_SUB).toBe(2);
      expect(DataScopeEnum.DEPT).toBe(3);
      expect(DataScopeEnum.SELF).toBe(4);
      expect(DataScopeEnum.CUSTOM).toBe(5);
    });

    it("needsSubtreeDeptIds 只为 DEPT_AND_SUB 返回 true", () => {
      expect(needsSubtreeDeptIds([])).toBe(false);
      expect(needsSubtreeDeptIds([RoleDataScope.all("R")])).toBe(false);
      expect(needsSubtreeDeptIds([RoleDataScope.dept("R")])).toBe(false);
      expect(needsSubtreeDeptIds([RoleDataScope.self("R")])).toBe(false);
      expect(needsSubtreeDeptIds([RoleDataScope.custom("R", [1])])).toBe(false);
      expect(needsSubtreeDeptIds([RoleDataScope.deptAndSub("R")])).toBe(true);
      expect(needsSubtreeDeptIds([RoleDataScope.all("R"), RoleDataScope.deptAndSub("R2")])).toBe(
        true
      );
    });
  });
});
