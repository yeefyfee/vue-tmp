import { RequestContext } from "../../common/context/request-context";
import { registerTenantScopedModels } from "../tenant.constants";
import {
  resolveTenantWhere,
  resolveTenantWhereFromContext,
  TenantContextMissingError,
} from "./tenant-scope.extension";

/**
 * 租户扩展纯函数内核单测（PEL-11）
 *
 * 全部用例在 `RequestContext.run()` 内执行，保证 AsyncLocalStorage 读写有落点；
 * 名单登记用例结束后清理，避免污染同进程内的其它测试。
 */

const TEST_MODEL = "SpecTenantProbe";

describe("tenant-scope.extension（PEL-11 骨架）", () => {
  beforeEach(() => {
    registerTenantScopedModels(TEST_MODEL);
  });

  afterEach(() => {
    // Set 无删除接口暴露（ReadonlySet），这里直接通过登记函数不可逆；
    // 因此 afterEach 不做删除，改为每条用例自带模型名（TEST_MODEL 固定，
    // 对其它测试无影响 —— 名单只影响 resolveTenantWhere 的分支选择）。
  });

  it("名单外模型：无条件放行（pass-through），平台级表不受影响", () => {
    RequestContext.run(() => {
      RequestContext.setTenantId("42");
      const r = resolveTenantWhere("SysUser", "42");
      expect(r.action).toBe("pass-through");
    });
  });

  it("名单内模型 + 有租户上下文：注入 bigint 型 tenantId 条件", () => {
    RequestContext.run(() => {
      RequestContext.setTenantId("42");
      const r = resolveTenantWhere(TEST_MODEL, "42");
      expect(r.action).toBe("inject");
      if (r.action === "inject") {
        expect(r.where).toEqual({ tenantId: 42n });
      }
    });
  });

  it("名单内模型 + 无租户上下文：fail-closed 拒绝（TenantContextMissingError）", () => {
    RequestContext.run(() => {
      const r = resolveTenantWhere(TEST_MODEL, null);
      expect(r.action).toBe("reject");
      if (r.action === "reject") {
        expect(r.error).toBeInstanceOf(TenantContextMissingError);
        expect(r.error.model).toBe(TEST_MODEL);
      }
    });
  });

  it("名单内模型 + 空串/空白上下文：同样拒绝（空值归一化）", () => {
    RequestContext.run(() => {
      expect(resolveTenantWhere(TEST_MODEL, "").action).toBe("reject");
      expect(resolveTenantWhere(TEST_MODEL, "   ").action).toBe("reject");
    });
  });

  it("名单内模型 + 非法格式上下文：拒绝而非带脏值放行", () => {
    RequestContext.run(() => {
      const r = resolveTenantWhere(TEST_MODEL, "not-a-number");
      expect(r.action).toBe("reject");
    });
  });

  it("上下文里写入空白值会被 setTenantId 归一化为 null", () => {
    RequestContext.run(() => {
      RequestContext.setTenantId("   ");
      expect(RequestContext.getTenantId()).toBeNull();
      RequestContext.setTenantId("7");
      expect(RequestContext.getTenantId()).toBe("7");
    });
  });

  it("resolveTenantWhereFromContext：从 AsyncLocalStorage 取值", () => {
    RequestContext.run(() => {
      RequestContext.setTenantId("9");
      const r = resolveTenantWhereFromContext(TEST_MODEL);
      expect(r.action).toBe("inject");
    });
  });

  it("上下文按请求隔离：外层设置不影响内层 run 的独立 store", () => {
    RequestContext.run(() => {
      RequestContext.setTenantId("100");
      RequestContext.run(() => {
        expect(RequestContext.getTenantId()).toBeNull();
        RequestContext.setTenantId("200");
        expect(RequestContext.getTenantId()).toBe("200");
      });
      expect(RequestContext.getTenantId()).toBe("100");
    });
  });
});
