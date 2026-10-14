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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { AuditAction, AuditEntityType } from "@peluvida/shared";
import { Audit } from "../common/audit/audit.decorator";
import { Permissions } from "../common/decorators/auth.decorator";
import { RequireTenant } from "../tenant/decorators/require-tenant.decorator";
import { TenantContextGuard } from "../tenant/guards/tenant-context.guard";
import { MediaService } from "./media.service";
import type { UploadedMediaFile } from "./media.service";
import { MediaPermissions } from "./media-permissions.constants";
import { AUDIT_ENTITY_MEDIA, MEDIA_UPLOAD_FILE_FIELD } from "./media.constants";
import { PresignMediaDto } from "./dto/presign-media.dto";
import { DirectUploadDto } from "./dto/direct-upload.dto";
import { ConfirmMediaDto } from "./dto/confirm-media.dto";
import { MediaCallbackDto } from "./dto/media-callback.dto";
import { QueryMediaDto } from "./dto/query-media.dto";
import { UpdateMediaDto } from "./dto/update-media.dto";

/**
 * 媒体 / 附件接口（P0-08）
 *
 * 权限点：`media:list / media:upload / media:update / media:delete`
 * （PermissionGuard 校验；ROOT 角色直放——tenant_admin/admin 均为 ROOT）。
 *
 * 租户上下文：类级 `@RequireTenant()` + `TenantContextGuard`（成对使用）——
 * 无租户上下文（平台 admin 等）一律 403 + A0302，fail-closed。
 *
 * 多态挂接：媒体不属于单一业务实体，以 (refType, refId) 关联任意业务实体（见 media.ref_type）。
 *
 * ⚠️ 审计 entityType 用字符串字面量 "media"（域常量），AuditLogService.record 接受
 * `AuditEntityType | string`，运行时落库值 "media"。
 */
const AUDIT_ENTITY_MEDIA_TYPED = AUDIT_ENTITY_MEDIA as AuditEntityType;

@ApiTags("15.媒体附件")
@Controller("media")
@UseGuards(TenantContextGuard)
@RequireTenant()
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @ApiOperation({ summary: "预签名上传（返回预签名地址 / 直传模式；落 pending 记录）" })
  @Post("presign")
  @Permissions(MediaPermissions.MEDIA_UPLOAD)
  @Audit({ entityType: AUDIT_ENTITY_MEDIA_TYPED, action: AuditAction.CREATE })
  async presign(@Body() formData: PresignMediaDto) {
    return await this.mediaService.presign(formData);
  }

  @ApiOperation({ summary: "服务端直传（multipart 单文件；落盘并直接确认）" })
  @Post("upload")
  @Permissions(MediaPermissions.MEDIA_UPLOAD)
  @UseInterceptors(FileInterceptor(MEDIA_UPLOAD_FILE_FIELD))
  @Audit({ entityType: AUDIT_ENTITY_MEDIA_TYPED, action: AuditAction.CREATE })
  async directUpload(@Body() formData: DirectUploadDto, @UploadedFile() file: UploadedMediaFile) {
    return await this.mediaService.directUpload(
      {
        refType: formData.refType,
        refId: formData.refId,
        storeId: formData.storeId,
        visibleToOwner: formData.visibleToOwner,
        sort: formData.sort,
        watermark: formData.watermark,
      },
      file
    );
  }

  @ApiOperation({ summary: "上传回调（云存储回调服务端；按 mediaId 或 objectKey 确认）" })
  @Post("callback")
  @Permissions(MediaPermissions.MEDIA_UPLOAD)
  async callback(@Body() formData: MediaCallbackDto) {
    return await this.mediaService.callback(formData);
  }

  @ApiOperation({
    summary: "媒体分页（refType+refId / mediaType / uploadStatus / visibleToOwner）",
  })
  @Get()
  @Permissions(MediaPermissions.MEDIA_LIST)
  async list(@Query() query: QueryMediaDto) {
    return await this.mediaService.list(query);
  }

  @ApiOperation({ summary: "确认上传（pending → confirmed；生成缩略图 / 水印）" })
  @Post(":id/confirm")
  @Permissions(MediaPermissions.MEDIA_UPLOAD)
  @Audit({ entityType: AUDIT_ENTITY_MEDIA_TYPED, action: AuditAction.UPDATE })
  async confirm(@Param("id", ParseUUIDPipe) id: string, @Body() formData: ConfirmMediaDto) {
    return await this.mediaService.confirm(id, formData);
  }

  @ApiOperation({ summary: "媒体详情" })
  @Get(":id")
  @Permissions(MediaPermissions.MEDIA_LIST)
  async detail(@Param("id", ParseUUIDPipe) id: string) {
    return await this.mediaService.detail(id);
  }

  @ApiOperation({ summary: "更新媒体（可见性 / 排序；version 乐观锁）" })
  @Put(":id")
  @Permissions(MediaPermissions.MEDIA_UPDATE)
  @Audit({ entityType: AUDIT_ENTITY_MEDIA_TYPED, action: AuditAction.UPDATE })
  async update(@Param("id", ParseUUIDPipe) id: string, @Body() formData: UpdateMediaDto) {
    return await this.mediaService.update(id, formData);
  }

  @ApiOperation({ summary: "删除媒体（软删 + best-effort 清理存储对象）" })
  @Delete(":id")
  @Permissions(MediaPermissions.MEDIA_DELETE)
  @Audit({ entityType: AUDIT_ENTITY_MEDIA_TYPED, action: AuditAction.DELETE })
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    return await this.mediaService.remove(id);
  }
}
