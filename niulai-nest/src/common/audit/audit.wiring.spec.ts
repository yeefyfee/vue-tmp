import "reflect-metadata"; // 装饰器元数据 polyfill：jest 环境需显式加载（main.ts 的 import 链不生效）
import { Body, Controller, Delete, Get, Param, Post, Put } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { APP_INTERCEPTOR } from "@nestjs/core";
import * as request from "supertest";
import { Prisma } from "@prisma/client";
import { AuditEntityType, AuditAction, AUDIT_TENANT_ID_PLATFORM } from "@peluvida/shared";

import { AuditModule } from "./audit.module";
import { AuditInterceptor } from "./audit.interceptor";
import { Audit } from "./audit.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { PrismaModule } from "../prisma/prisma.module";
import { StoreController } from "../../store/store.controller";
import { StoreService } from "../../store/store.service";
import { RoleController } from "../../system/role/role.controller";
import { RoleService } from "../../system/role/role.service";
import { TenantContextGuard } from "../../tenant/guards/tenant-context.guard";

/**
 * 审计打点接线集成测试（P0-02-08 · 子任务 3）
 *
 * 与 audit.interceptor.spec.ts（单测：手工 ExecutionContext）互补，这里用
 * Test.createTestingModule 组真实链路：
 *   真实 controller（store/role 的真实 @Audit 打点路由）
 *   + AuditModule + APP_INTERCEPTOR 全局注册（与 .workbuddy/tmp/audit-wiring.md 同款）
 *   + supertest 发真实 HTTP 请求
 * 验证：请求经过全局拦截器后 AuditLogService.record 落库链路被触发，
 * entityType/action/entityId 与打点清单一致；无 @Audit 元数据的路由直通不记录。
 *
 *ALS 说明：测试模块不含 RequestContextMiddleware，请求处理在 ALS 无上下文下执行
 * （真实部署中中间件先行）——恰好验证自动轨缺省回退：operatorName=null、
 * tenantId=平台哨兵 0n。ALS 锚点解析链由 audit-log.service.spec.ts 单测覆盖。
 */

/** 探针 controller：补 USER 实体与 :userId 提取链（真实 UserController 依赖 winston 过重） */
@Controller("audit-probe")
class AuditProbeController {
  @Put("users/:userId/password/reset")
  @Audit({ entityType: AuditEntityType.USER, action: AuditAction.UPDATE })
  resetPassword(@Param("userId") userId: string) {
    return { userId };
  }

  @Get("plain")
  plain() {
    return { ok: true };
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("审计打点接线（真实 controller + APP_INTERCEPTOR 全局注册）", () => {
  let app: INestApplication;
  // 自动轨写入链 mock：$transaction(fn) 直接执行 fn(trx)，trx 内先 GUC 后 create
  let auditCreate: jest.Mock;
  let executeRaw: jest.Mock;

  beforeEach(async () => {
    auditCreate = jest.fn().mockResolvedValue({});
    executeRaw = jest.fn().mockResolvedValue(0);
    const prismaMock = {
      $transaction: jest.fn(async (fn: (trx: Prisma.TransactionClient) => Promise<unknown>) =>
        fn({
          $executeRaw: executeRaw,
          auditLog: { create: auditCreate },
        } as unknown as Prisma.TransactionClient)
      ),
    } as unknown as PrismaService;

    const storeServiceMock = {
      createStore: jest.fn().mockResolvedValue({ id: 1 }),
      getStorePage: jest.fn().mockResolvedValue({ list: [], total: 0 }),
      getStoreDetail: jest.fn().mockResolvedValue({ id: 1 }),
      updateStore: jest.fn().mockResolvedValue({ id: 1 }),
      softDeleteStore: jest.fn().mockResolvedValue(undefined),
    } as unknown as StoreService;

    const roleServiceMock = {
      updateRoleStatus: jest.fn().mockResolvedValue(true),
      deleteRoles: jest.fn().mockResolvedValue(undefined),
    } as unknown as RoleService;

    const moduleRef = await Test.createTestingModule({
      // PrismaModule 虽 @Global，但仅在宿主模块树中生效——测试模块需显式 import；
      // 真 PrismaService 依赖 ConfigService/DB，用 overrideProvider 容器级替换为 mock
      imports: [PrismaModule, AuditModule],
      controllers: [StoreController, RoleController, AuditProbeController],
      providers: [
        { provide: StoreService, useValue: storeServiceMock },
        { provide: RoleService, useValue: roleServiceMock },
        // 与 wiring 文档同款全局注册：无 @Audit 元数据的路由应零开销直通
        { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      // TenantContextGuard 类级挂在 StoreController 上，依赖租户上下文中间件产物，
      // 集成测试无该中间件 → override 放行（守卫语义本身由 tenant 域测试覆盖）
      .overrideGuard(TenantContextGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  /** 断言最近一次落库行的关键字段 */
  function lastRow(): Record<string, any> {
    expect(auditCreate).toHaveBeenCalled();
    return auditCreate.mock.calls[auditCreate.mock.calls.length - 1][0].data;
  }

  it("POST /stores（真实打点）：成功响应后自动轨落库，entityType=store/action=create，无上下文回退哨兵 0", async () => {
    const res = await request(app.getHttpServer()).post("/stores").send({ name: "旗舰店" });
    expect(res.status).toBe(201);
    await flushMicrotasks();
    expect(lastRow().entityType).toBe(AuditEntityType.STORE);
    expect(lastRow().action).toBe(AuditAction.CREATE);
    expect(lastRow().entityId).toBe(""); // POST 无 :id 路由参数
    expect(lastRow().tenantId).toBe(AUDIT_TENANT_ID_PLATFORM); // 无 ALS → 平台哨兵回退
    // 自动轨 RLS 契约：GUC 先行
    expect(executeRaw).toHaveBeenCalled();
  });

  it("PUT /stores/:id（真实打点）：entityId 取 params.id，action=update", async () => {
    const id = "f47ac10b-58cc-4372-a567-0e02b2c3d479"; // ParseUUIDPipe 要求合法 UUID
    const res = await request(app.getHttpServer()).put(`/stores/${id}`).send({ name: "新名" });
    expect(res.status).toBe(200);
    await flushMicrotasks();
    expect(lastRow().entityType).toBe(AuditEntityType.STORE);
    expect(lastRow().action).toBe(AuditAction.UPDATE);
    expect(lastRow().entityId).toBe(id);
  });

  it("DELETE /stores/:id（真实打点）：action=delete", async () => {
    const id = "c232ab00-9414-11ec-b3d3-3cdd7c8a2f7f";
    const res = await request(app.getHttpServer()).delete(`/stores/${id}`);
    expect(res.status).toBe(200);
    await flushMicrotasks();
    expect(lastRow().entityType).toBe(AuditEntityType.STORE);
    expect(lastRow().action).toBe(AuditAction.DELETE);
    expect(lastRow().entityId).toBe(id);
  });

  it("DELETE /roles/:ids（真实打点）：批量删除 entityId 逗号分隔保留", async () => {
    const res = await request(app.getHttpServer()).delete("/roles/3,7,9");
    expect(res.status).toBe(200);
    await flushMicrotasks();
    expect(lastRow().entityType).toBe(AuditEntityType.ROLE);
    expect(lastRow().action).toBe(AuditAction.DELETE);
    expect(lastRow().entityId).toBe("3,7,9");
  });

  it("PUT /roles/:roleId/status（真实打点）：开关路由 entityId 取 params.roleId", async () => {
    const res = await request(app.getHttpServer()).put("/roles/5/status").query({ status: 0 });
    expect(res.status).toBe(200);
    await flushMicrotasks();
    expect(lastRow().entityType).toBe(AuditEntityType.ROLE);
    expect(lastRow().action).toBe(AuditAction.UPDATE);
    expect(lastRow().entityId).toBe("5");
  });

  it("探针 PUT /audit-probe/users/:userId/password/reset：:userId 进提取链", async () => {
    const res = await request(app.getHttpServer()).put("/audit-probe/users/12/password/reset");
    expect(res.status).toBe(200);
    await flushMicrotasks();
    expect(lastRow().entityType).toBe(AuditEntityType.USER);
    expect(lastRow().action).toBe(AuditAction.UPDATE);
    expect(lastRow().entityId).toBe("12");
  });

  it("无 @Audit 元数据的路由直通：GET /stores 与探针 GET plain 不写审计", async () => {
    const listRes = await request(app.getHttpServer()).get("/stores");
    expect(listRes.status).toBe(200);
    const plainRes = await request(app.getHttpServer()).get("/audit-probe/plain");
    expect(plainRes.status).toBe(200);
    await flushMicrotasks();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
  });
});
