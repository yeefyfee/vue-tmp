import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { AuditEntityType, AuditAction } from "@peluvida/shared";
import { Audit } from "../common/audit/audit.decorator";
import { Idempotent } from "../common/idempotency/idempotency.decorator";
import { Permissions } from "../common/decorators/auth.decorator";
import { RequireTenant } from "../tenant/decorators/require-tenant.decorator";
import { TenantContextGuard } from "../tenant/guards/tenant-context.guard";
import { StoreService } from "./store.service";
import { CreateStoreDto } from "./dto/create-store.dto";
import { UpdateStoreDto } from "./dto/update-store.dto";
import { QueryStoreDto } from "./dto/query-store.dto";

/**
 * 门店档案接口（P0-04-02 · FR-1）
 *
 * 权限点：`store:list / store:create / store:update / store:delete`
 * （PermissionGuard 校验；ROOT 角色直放——tenant_admin/admin 均为 ROOT，
 * 无需权限种子即可访问，非 ROOT 角色的授权走角色-权限配置）。
 *
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`（成对使用）——
 * 无租户上下文（平台 admin 等）一律 403 + A0302，fail-closed。
 * 路由顺序注意：`GET /stores` 分页必须先于 `GET /stores/:id` 注册语义由 Nest 保证，无静态段冲突。
 */
@ApiTags("10.门店档案")
@Controller("stores")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class StoreController {
  constructor(private readonly storeService: StoreService) {}

  @ApiOperation({ summary: "创建门店" })
  @Post()
  @Permissions("store:create")
  @Audit({ entityType: AuditEntityType.STORE, action: AuditAction.CREATE })
  // 幂等试点（P0-07-01）：携带 Idempotency-Key 时同 key 重复提交回放首次结果；
  // 未携带则跳过幂等（required 默认 false），不影响存量调用方
  @Idempotent()
  async createStore(@Body() formData: CreateStoreDto) {
    return await this.storeService.createStore(formData);
  }

  @ApiOperation({ summary: "门店分页列表（code/name/status/createdAt 区间筛选）" })
  @Get()
  @Permissions("store:list")
  async getStorePage(@Query() query: QueryStoreDto) {
    return await this.storeService.getStorePage(query);
  }

  @ApiOperation({ summary: "门店详情" })
  @Get(":id")
  @Permissions("store:list")
  async getStoreDetail(@Param("id", ParseUUIDPipe) id: string) {
    return await this.storeService.getStoreDetail(id);
  }

  @ApiOperation({ summary: "更新门店（version 乐观锁）" })
  @Put(":id")
  @Permissions("store:update")
  @Audit({ entityType: AuditEntityType.STORE, action: AuditAction.UPDATE })
  async updateStore(@Param("id", ParseUUIDPipe) id: string, @Body() formData: UpdateStoreDto) {
    return await this.storeService.updateStore(id, formData);
  }

  @ApiOperation({ summary: "删除门店（软删）" })
  @Delete(":id")
  @Permissions("store:delete")
  @Audit({ entityType: AuditEntityType.STORE, action: AuditAction.DELETE })
  async deleteStore(@Param("id", ParseUUIDPipe) id: string) {
    await this.storeService.softDeleteStore(id);
    return { success: true };
  }
}
