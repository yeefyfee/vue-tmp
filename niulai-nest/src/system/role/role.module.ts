import { Module } from "@nestjs/common";
import { RoleService } from "./role.service";
import { RolePermService } from "./role-permission.service";
import { RoleController } from "./role.controller";
import { RedisSharedModule } from "../../common/redis/redis.module";

/**
 * 角色模块
 *
 * 已切到 Prisma：移除 `TypeOrmModule.forFeature([SysRole, SysRoleMenu, SysRoleDept, SysUserRole, SysMenu])`
 * （`PrismaModule` 是 `@Global`，无需 import）。
 *
 * ✅ 过渡期已了结（PEL-10c · `user` 移植完成）：当初 `SysRole` 的 TypeORM 实体元数据
 * 之所以必须继续注册，是因为未迁移的 `SysUser` 声明着 `@ManyToMany(() => SysRole)` +
 * `@JoinTable`，而本项目 TypeORM 配置是 `autoLoadEntities: true` ⇒ 实体元数据**只能**
 * 通过 `forFeature` 注册，否则 bootstrap 抛 `Entity metadata for SysUser#roles was not found`。
 * 该注册当时被就近放到消费方 `UserModule`（自删除式 hack）；现在 `UserModule` 已切 Prisma、
 * `SysUser` 实体已归档，这条注册与 `entities/sys-role.entity.ts` **一并消失**。
 * ⇒ `src/system/role/entities/` 目录现已整个移除。
 */
@Module({
  imports: [RedisSharedModule],
  controllers: [RoleController],
  providers: [RoleService, RolePermService],
  exports: [RoleService, RolePermService],
})
export class RoleModule {}
