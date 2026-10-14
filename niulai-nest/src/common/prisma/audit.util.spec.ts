import { RequestContext } from "../context/request-context";
import { auditOnCreate, auditOnUpdate, currentAuditUserId } from "./audit.util";

/**
 * 这些用例在 `RequestContext.run()` 内外分别执行，因此**不依赖真实请求**，
 * 也不依赖数据库。
 */
const FIXED_NOW = new Date("2025-01-01T00:00:00.000Z");

function withUser<T>(userId: string, fn: () => T): T {
  return RequestContext.run(() => {
    RequestContext.initUserContext({
      userId,
      deptId: "3",
      deptTreePath: "0/1/3",
      dataScopes: [],
      roles: [],
    });
    return fn();
  });
}

describe("audit.util（审计字段填充）", () => {
  describe("currentAuditUserId", () => {
    it("无请求上下文时返回 null", () => {
      expect(currentAuditUserId()).toBeNull();
    });

    it("有上下文时返回 BigInt 形态的用户 ID", () => {
      withUser("9001", () => {
        expect(currentAuditUserId()).toBe(9001n);
      });
    });

    it("上下文用户 ID 为空串时视为无用户", () => {
      withUser("", () => {
        expect(currentAuditUserId()).toBeNull();
      });
    });
  });

  describe("auditOnCreate", () => {
    it("无上下文且无显式创建人时，只填两个时间，不写入操作人字段", () => {
      const fields = auditOnCreate(undefined, FIXED_NOW);
      expect(fields).toEqual({ createTime: FIXED_NOW, updateTime: FIXED_NOW });
      expect("createBy" in fields).toBe(false);
      expect("updateBy" in fields).toBe(false);
    });

    it("无上下文但显式给出创建人时，采用显式值并同时写入 updateBy", () => {
      const fields = auditOnCreate(77n, FIXED_NOW);
      expect(fields.createBy).toBe(77n);
      expect(fields.updateBy).toBe(77n);
      expect(fields.createTime).toBe(FIXED_NOW);
      expect(fields.updateTime).toBe(FIXED_NOW);
    });

    it("有上下文时上下文的用户优先于显式值（对齐原订阅器覆盖语义）", () => {
      withUser("9001", () => {
        const fields = auditOnCreate(77n, FIXED_NOW);
        expect(fields.createBy).toBe(9001n);
        expect(fields.updateBy).toBe(9001n);
      });
    });

    it("createTime 与 updateTime 为同一时刻（新建时两者相等）", () => {
      const fields = auditOnCreate(undefined, FIXED_NOW);
      expect(fields.createTime.getTime()).toBe(fields.updateTime.getTime());
    });
  });

  describe("auditOnUpdate", () => {
    it("无上下文且无显式修改人时，只填 updateTime", () => {
      const fields = auditOnUpdate(undefined, FIXED_NOW);
      expect(fields).toEqual({ updateTime: FIXED_NOW });
      expect("updateBy" in fields).toBe(false);
    });

    it("无上下文但显式给出修改人时采用显式值", () => {
      const fields = auditOnUpdate(88n, FIXED_NOW);
      expect(fields.updateBy).toBe(88n);
      expect(fields.updateTime).toBe(FIXED_NOW);
    });

    it("有上下文时上下文的用户优先", () => {
      withUser("9002", () => {
        const fields = auditOnUpdate(88n, FIXED_NOW);
        expect(fields.updateBy).toBe(9002n);
      });
    });

    it("不会写入 createBy / createTime（更新不得改动创建信息）", () => {
      withUser("9002", () => {
        const fields = auditOnUpdate(undefined, FIXED_NOW) as unknown as Record<string, unknown>;
        expect("createBy" in fields).toBe(false);
        expect("createTime" in fields).toBe(false);
      });
    });
  });
});
