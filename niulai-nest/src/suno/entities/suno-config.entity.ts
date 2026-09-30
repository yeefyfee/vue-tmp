import { Column, Entity } from "typeorm";
import { BaseEntity } from "@/common/entities/base.entity";

/**
 * Suno 接入配置
 *
 * access_key 属敏感凭证，仅后端持有并用于代理转发，前端不可读取明文。
 */
@Entity("suno_config")
export class SunoConfig extends BaseEntity {
  @Column({ name: "config_name", length: 64, comment: "配置名称" })
  configName: string;

  @Column({ name: "config_key", length: 64, comment: "配置键" })
  configKey: string;

  @Column({ name: "config_value", length: 512, nullable: true, comment: "配置值(密钥密文)" })
  configValue?: string | null;

  @Column({ name: "base_url", length: 255, nullable: true, comment: "接口基础地址" })
  baseUrl?: string | null;

  @Column({ length: 255, nullable: true, comment: "备注" })
  remark?: string | null;

  @Column({ type: "tinyint", default: 1, comment: "状态(1-启用 0-停用)" })
  status: number;
}
