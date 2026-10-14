import { Module, forwardRef } from "@nestjs/common";
import { UserService } from "./user.service";
import { UserController } from "./user.controller";
import { RoleModule } from "../role/role.module";
import { DeptModule } from "../dept/dept.module";
import { MenuModule } from "../menu/menu.module";
import { LogModule } from "../log/log.module";
import { RedisSharedModule } from "../../common/redis/redis.module";

/**
 * 用户模块（PEL-10c：TypeORM → Prisma）
 *
 * 已切到 Prisma：移除 `TypeOrmModule.forFeature([SysUser, SysUserRole, SysRole])`。
 *
 * 三点说明：
 *  1. 其中的 `SysRole` 是 `role` 移植时临时放过来的**过渡期元数据注册** ——
 *     `autoLoadEntities: true` 意味着实体元数据**只能**来自 `TypeOrmModule.forFeature(...)`，
 *     而当时未迁移的 `SysUser` 还声明着 `@ManyToMany(() => SysRole)` + `@JoinTable`，
 *     所以 `SysRole` 的元数据必须继续注册才不至于 bootstrap 报
 *     `Entity metadata for SysUser#roles was not found`。随着本模块移植完成、
 *     `SysUser` 实体一并归档，这条「自删除式 hack」也如约消失。
 *  2. 🔴 本模块**不需要**任何过渡期实体注册（与 `role` 不同）：全仓 grep 确认
 *     `SysUser` / `SysUserRole` / `SysUserSocial` 已无 TypeORM 元数据消费者。
 *  3. `forwardRef(() => MenuModule)` 其实是**多余**的一环（`UserService` 并不注入 `MenuService`，
 *     是 `MenuService` 反过来用 `UserService.getUserMenuIds()`）；但属既有代码、与本次移植无关，
 *     为缩小改动面保持不动。
 *
 * `PrismaModule` 是 `@Global`，无需在此 import。
 */
@Module({
  imports: [
    forwardRef(() => RoleModule),
    forwardRef(() => DeptModule),
    forwardRef(() => MenuModule),
    forwardRef(() => LogModule),
    RedisSharedModule,
  ],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
