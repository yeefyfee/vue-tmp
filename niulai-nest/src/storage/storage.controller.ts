import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { StorageService } from "./storage.service";
import { CurrentUser } from "@/common/decorators/current-user.decorator";
import { CreateStorageItemDto } from "./dto/create-storage-item.dto";
import { UpdateStorageItemDto } from "./dto/update-storage-item.dto";
import { StorageItemQueryDto } from "./dto/storage-item-query.dto";
import {
  StorageCategoryFormDto,
  StorageCategoryQueryDto,
  UpdateStorageCategoryDto,
} from "./dto/storage-category.dto";
import { StorageTagFormDto, UpdateStorageTagDto } from "./dto/storage-tag.dto";
import { StorageItemQuantityDto } from "./dto/storage-overview.dto";

/**
 * 个人物品收纳接口
 *
 * 所有接口均以当前登录用户为数据边界，无需额外权限标识即可访问。
 */
@ApiTags("20.物品收纳")
@Controller("storage")
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  // --------------------------------------------------------------------------
  // 概览
  // --------------------------------------------------------------------------

  @ApiOperation({ summary: "收纳概览统计" })
  @Get("overview")
  async overview(@CurrentUser("userId") userId: string) {
    return await this.storageService.getOverview(userId);
  }

  // --------------------------------------------------------------------------
  // 物品
  // --------------------------------------------------------------------------

  @ApiOperation({ summary: "物品分页列表" })
  @Get("items")
  async getItemPage(@CurrentUser("userId") userId: string, @Query() query: StorageItemQueryDto) {
    return await this.storageService.getItemPage(userId, query);
  }

  @ApiOperation({ summary: "物品详情" })
  @Get("items/:id")
  async getItemDetail(@CurrentUser("userId") userId: string, @Param("id") id: string) {
    return await this.storageService.getItemDetail(userId, id);
  }

  @ApiOperation({ summary: "新增物品" })
  @Post("items")
  async createItem(@CurrentUser("userId") userId: string, @Body() dto: CreateStorageItemDto) {
    return await this.storageService.createItem(userId, dto);
  }

  @ApiOperation({ summary: "修改物品" })
  @Put("items/:id")
  async updateItem(
    @CurrentUser("userId") userId: string,
    @Param("id") id: string,
    @Body() dto: UpdateStorageItemDto
  ) {
    return await this.storageService.updateItem(userId, id, dto);
  }

  @ApiOperation({ summary: "删除物品（支持逗号分隔批量）" })
  @Delete("items/:ids")
  async deleteItems(@CurrentUser("userId") userId: string, @Param("ids") ids: string) {
    return await this.storageService.deleteItems(userId, ids);
  }

  @ApiOperation({ summary: "调整物品数量" })
  @Patch("items/:id/quantity")
  async changeQuantity(
    @CurrentUser("userId") userId: string,
    @Param("id") id: string,
    @Body() dto: StorageItemQuantityDto
  ) {
    return await this.storageService.changeItemQuantity(userId, id, dto.delta);
  }

  @ApiOperation({ summary: "归档/恢复物品" })
  @Patch("items/:id/status")
  async toggleStatus(
    @CurrentUser("userId") userId: string,
    @Param("id") id: string,
    @Query("status") status: number
  ) {
    return await this.storageService.toggleItemStatus(userId, id, Number(status));
  }

  // --------------------------------------------------------------------------
  // 分类
  // --------------------------------------------------------------------------

  @ApiOperation({ summary: "分类分页列表" })
  @Get("categories")
  async getCategoryPage(
    @CurrentUser("userId") userId: string,
    @Query() query: StorageCategoryQueryDto
  ) {
    return await this.storageService.getCategoryPage(userId, query);
  }

  @ApiOperation({ summary: "分类下拉选项（含物品数量）" })
  @Get("categories/options")
  async getCategoryOptions(@CurrentUser("userId") userId: string) {
    return await this.storageService.getCategoryOptions(userId);
  }

  @ApiOperation({ summary: "新增分类" })
  @Post("categories")
  async createCategory(
    @CurrentUser("userId") userId: string,
    @Body() dto: StorageCategoryFormDto
  ) {
    return await this.storageService.createCategory(userId, dto);
  }

  @ApiOperation({ summary: "修改分类" })
  @Put("categories/:id")
  async updateCategory(
    @CurrentUser("userId") userId: string,
    @Param("id") id: string,
    @Body() dto: UpdateStorageCategoryDto
  ) {
    return await this.storageService.updateCategory(userId, id, dto);
  }

  @ApiOperation({ summary: "删除分类（支持逗号分隔批量）" })
  @Delete("categories/:ids")
  async deleteCategory(@CurrentUser("userId") userId: string, @Param("ids") ids: string) {
    return await this.storageService.deleteCategory(userId, ids);
  }

  // --------------------------------------------------------------------------
  // 标签
  // --------------------------------------------------------------------------

  @ApiOperation({ summary: "标签列表（含物品数量）" })
  @Get("tags")
  async getTagList(@CurrentUser("userId") userId: string) {
    return await this.storageService.getTagList(userId);
  }

  @ApiOperation({ summary: "新增标签" })
  @Post("tags")
  async createTag(@CurrentUser("userId") userId: string, @Body() dto: StorageTagFormDto) {
    return await this.storageService.createTag(userId, dto);
  }

  @ApiOperation({ summary: "修改标签" })
  @Put("tags/:id")
  async updateTag(
    @CurrentUser("userId") userId: string,
    @Param("id") id: string,
    @Body() dto: UpdateStorageTagDto
  ) {
    return await this.storageService.updateTag(userId, id, dto);
  }

  @ApiOperation({ summary: "删除标签（支持逗号分隔批量）" })
  @Delete("tags/:ids")
  async deleteTag(@CurrentUser("userId") userId: string, @Param("ids") ids: string) {
    return await this.storageService.deleteTag(userId, ids);
  }
}
