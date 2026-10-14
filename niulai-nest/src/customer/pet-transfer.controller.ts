import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { AuditEntityType, AuditAction } from "@peluvida/shared";
import { Audit } from "../common/audit/audit.decorator";
import { Permissions } from "../common/decorators/auth.decorator";
import { RequireTenant } from "../tenant/decorators/require-tenant.decorator";
import { TenantContextGuard } from "../tenant/guards/tenant-context.guard";
import { PetTransferService } from "./pet-transfer.service";
import { CustomerPermissions } from "./customer-permissions.constants";
import { CreateTransferDto } from "./dto/create-transfer.dto";
import { RejectTransferDto } from "./dto/reject-transfer.dto";
import { QueryTransferDto } from "./dto/query-transfer.dto";

/**
 * 审计 entityType 暂用字符串字面量 "pet_transfer"（对齐宠物域 "pet" 先例）：
 * @peluvida/shared 的 AuditEntityType 由并行任务增量登记（禁改 shared 包），
 * 此处仅做类型断言满足装饰器签名；落库值 "pet_transfer" 与下轮 shared 登记对齐。
 */
const AUDIT_ENTITY_PET_TRANSFER = "pet_transfer" as AuditEntityType;

/**
 * 宠物转移申请接口（P0-05-03 · FR-2 多宠物归属，转移需审批）
 *
 * 路由形态说明：
 *  - `POST /pets/:id/transfer`：**发起**转移申请（不改归属，落一行待审批）；
 *  - `POST /pet-transfers/:id/approve|reject|cancel`：审批 / 拒绝 / 撤销；
 *  - `GET  /pet-transfers`：分页列表（status / petId 筛选）。
 *  为什么挂在「无前缀控制器」：宠物域 `src/pet/**` 由并行任务占用（禁改），
 *  故转移接口以独立控制器（@Controller() + 全路径）落于客户域模块内，
 *  避免与 PetController（@Controller("pets")）路由冲突。
 *
 * 权限点：`customer:transfer:create`（发起，宠物归属变更）/ `customer:transfer:approve`
 * （审批）/ `customer:transfer:reject`（拒绝）/ `customer:transfer:cancel`（撤销）/
 * `customer:transfer:list`（列表）；ROOT 直放。租户上下文类级 @RequireTenant + Guard（fail-closed）。
 */
@ApiTags("11.萌主档案")
@Controller()
@UseGuards(TenantContextGuard)
@RequireTenant()
export class PetTransferController {
  constructor(private readonly petTransferService: PetTransferService) {}

  @ApiOperation({ summary: "发起宠物转移申请（生成待审批，未审批不变更归属）" })
  @Post("pets/:id/transfer")
  @Permissions(CustomerPermissions.CUSTOMER_TRANSFER_CREATE)
  @Audit({ entityType: AUDIT_ENTITY_PET_TRANSFER, action: AuditAction.CREATE })
  async createTransfer(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() formData: CreateTransferDto
  ) {
    return await this.petTransferService.createTransfer(id, formData);
  }

  @ApiOperation({ summary: "转移申请分页列表（status / petId 筛选）" })
  @Get("pet-transfers")
  @Permissions(CustomerPermissions.CUSTOMER_TRANSFER_LIST)
  async getTransferPage(@Query() query: QueryTransferDto) {
    return await this.petTransferService.getTransferPage(query);
  }

  @ApiOperation({ summary: "审批通过转移申请（事务内改归属 + 更新关联）" })
  @Post("pet-transfers/:id/approve")
  @Permissions(CustomerPermissions.CUSTOMER_TRANSFER_APPROVE)
  @Audit({ entityType: AUDIT_ENTITY_PET_TRANSFER, action: AuditAction.UPDATE })
  async approveTransfer(@Param("id", ParseUUIDPipe) id: string) {
    return await this.petTransferService.approveTransfer(id);
  }

  @ApiOperation({ summary: "拒绝转移申请（记录拒绝理由）" })
  @Post("pet-transfers/:id/reject")
  @Permissions(CustomerPermissions.CUSTOMER_TRANSFER_REJECT)
  @Audit({ entityType: AUDIT_ENTITY_PET_TRANSFER, action: AuditAction.UPDATE })
  async rejectTransfer(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() formData: RejectTransferDto
  ) {
    return await this.petTransferService.rejectTransfer(id, formData);
  }

  @ApiOperation({ summary: "撤销转移申请（申请人自助）" })
  @Post("pet-transfers/:id/cancel")
  @Permissions(CustomerPermissions.CUSTOMER_TRANSFER_CANCEL)
  @Audit({ entityType: AUDIT_ENTITY_PET_TRANSFER, action: AuditAction.UPDATE })
  async cancelTransfer(@Param("id", ParseUUIDPipe) id: string) {
    return await this.petTransferService.cancelTransfer(id);
  }
}
