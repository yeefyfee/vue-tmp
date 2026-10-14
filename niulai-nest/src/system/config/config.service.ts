import { Injectable, NotFoundException, BadRequestException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../common/prisma/prisma.service";
import { requireBigInt, toBigInt } from "../../common/prisma/prisma-ids";
import { ConfigQueryDto } from "./dto/config-query.dto";
import { CreateConfigDto, UpdateConfigDto } from "./dto/config-form.dto";
import { RedisService } from "../../common/redis/redis.service";

/**
 * 系统配置服务（PostgreSQL 16 + Prisma）
 *
 * 迁移自 TypeORM Repository 实现，**对外契约保持不变**：
 *  - 分页仍返回 `{ data, page: { pageNum, pageSize, total } }`，
 *    由全局 ResponseInterceptor 改写成 `list/total/page/page_size`（见 PEL-08）；
 *  - 逻辑删除仍走 `is_deleted = 1`；
 *  - 主键在出参里仍是**字符串**（Prisma 返回 BigInt，由 BigInt.toJSON 垫片序列化为字符串，
 *    对齐原 TypeORM 的 `bigNumberStrings: true`）。
 */
@Injectable()
export class ConfigService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    private redisService?: RedisService
  ) {}

  /**
   * 系统配置分页列表
   */
  async getConfigPage(query: ConfigQueryDto) {
    const { keywords, pageNum, pageSize } = query;

    const pageNumSafe = Number(pageNum) > 0 ? Number(pageNum) : 1;
    const pageSizeSafe = Number(pageSize) > 0 ? Number(pageSize) : 20;

    const where: Prisma.SysConfigWhereInput = { isDeleted: 0 };
    if (keywords) {
      where.OR = [{ configName: { contains: keywords } }, { configKey: { contains: keywords } }];
    }

    const [list, total] = await Promise.all([
      this.prisma.scoped.sysConfig.findMany({
        where,
        orderBy: { createTime: "desc" },
        skip: (pageNumSafe - 1) * pageSizeSafe,
        take: pageSizeSafe,
      }),
      this.prisma.scoped.sysConfig.count({ where }),
    ]);

    return {
      data: list,
      page: {
        pageNum: pageNumSafe,
        pageSize: pageSizeSafe,
        total,
      },
    };
  }

  /**
   * 新增系统配置
   */
  async saveConfig(formData: CreateConfigDto) {
    // 检查配置键是否已存在
    const existingConfig = await this.prisma.scoped.sysConfig.findFirst({
      where: { configKey: formData.configKey, isDeleted: 0 },
      select: { id: true },
    });

    if (existingConfig) {
      throw new BadRequestException("配置键已存在");
    }

    await this.prisma.sysConfig.create({
      data: {
        configName: formData.configName,
        configKey: formData.configKey,
        configValue: formData.configValue,
        remark: formData.remark ?? null,
        createBy: toBigInt(formData.createBy),
        createTime: new Date(),
        isDeleted: 0,
      },
    });

    // 刷新缓存
    await this.refreshCache();

    return true;
  }

  /**
   * 获取系统配置表单数据
   */
  async getConfigFormData(id: string | number) {
    const config = await this.prisma.scoped.sysConfig.findFirst({
      where: { id: requireBigInt(id, "配置ID"), isDeleted: 0 },
    });

    if (!config) {
      throw new NotFoundException("配置不存在");
    }

    return config;
  }

  /**
   * 修改系统配置
   */
  async updateConfig(id: string | number, formData: UpdateConfigDto) {
    const configId = requireBigInt(id, "配置ID");
    const config = await this.prisma.scoped.sysConfig.findFirst({
      where: { id: configId, isDeleted: 0 },
      select: { id: true, configKey: true },
    });

    if (!config) {
      throw new NotFoundException("配置不存在");
    }

    // 如果修改了配置键，检查是否与其他配置冲突
    if (formData.configKey && formData.configKey !== config.configKey) {
      const conflict = await this.prisma.scoped.sysConfig.findFirst({
        where: { configKey: formData.configKey, isDeleted: 0 },
        select: { id: true },
      });

      if (conflict && conflict.id !== configId) {
        throw new BadRequestException("配置键已存在");
      }
    }

    // 只更新显式传入的字段（与原实现「展开 formData 后覆盖」的语义一致）
    const data: Prisma.SysConfigUpdateInput = { updateTime: new Date() };
    if (formData.configName !== undefined) data.configName = formData.configName;
    if (formData.configKey !== undefined) data.configKey = formData.configKey;
    if (formData.configValue !== undefined) data.configValue = formData.configValue;
    if (formData.remark !== undefined) data.remark = formData.remark;
    if (formData.updateBy !== undefined) data.updateBy = toBigInt(formData.updateBy);

    await this.prisma.sysConfig.update({ where: { id: configId }, data });

    // 刷新缓存
    await this.refreshCache();

    return true;
  }

  /**
   * 删除系统配置（逻辑删除）
   */
  async deleteConfig(id: string | number) {
    const configId = requireBigInt(id, "配置ID");
    const config = await this.prisma.scoped.sysConfig.findFirst({
      where: { id: configId, isDeleted: 0 },
      select: { id: true },
    });

    if (!config) {
      throw new NotFoundException("配置不存在");
    }

    await this.prisma.sysConfig.update({
      where: { id: configId },
      data: { isDeleted: 1 },
    });

    // 刷新缓存
    await this.refreshCache();

    return true;
  }

  /**
   * 刷新系统配置缓存
   */
  async refreshCache() {
    // 系统配置是全站基础数据，刻意走**基础客户端**不走数据权限，避免被当前请求上下文影响
    const configs = await this.prisma.sysConfig.findMany({
      where: { isDeleted: 0 },
      select: { configKey: true, configValue: true },
    });

    const configMap: Record<string, string> = {};
    configs.forEach((config) => {
      if (config.configKey !== null) {
        configMap[config.configKey] = config.configValue;
      }
    });

    // 存储到 Redis（RedisService 为 @Optional 注入，缺失时不应让整条链路失败）
    await this.redisService?.set("sys:config:all", JSON.stringify(configMap), 3600);

    return true;
  }

  /**
   * 根据配置键获取配置值
   */
  async getConfigValue(configKey: string): Promise<string | null> {
    // 先从缓存获取
    const cacheData = await this.redisService?.get("sys:config:all");
    if (cacheData) {
      const configMap = JSON.parse(cacheData) as Record<string, string>;
      return configMap[configKey] || null;
    }

    // 缓存不存在，从数据库获取
    const config = await this.prisma.sysConfig.findFirst({
      where: { configKey, isDeleted: 0 },
      select: { configValue: true },
    });

    return config ? config.configValue : null;
  }
}
