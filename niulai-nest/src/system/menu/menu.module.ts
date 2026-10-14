import { Module, forwardRef } from "@nestjs/common";
import { MenuService } from "./menu.service";
import { MenuController } from "./menu.controller";
import { UserModule } from "../user/user.module";
import { RoleModule } from "../role/role.module";

/**
 * 菜单模块（Prisma 版）
 *
 * 已切到 Prisma：移除 `TypeOrmModule.forFeature([SysMenu])`
 * （`PrismaModule` 是 `@Global`，无需 import）。
 *
 * 与 `role` 模块不同，这里**不需要**任何「过渡期实体注册」：
 * `SysMenu` 自身没有关系装饰器，也没有任何未迁移实体以 `@ManyToMany` / `@ManyToOne`
 * 指向它（全仓 grep 确认：`SysMenu` 的引用只剩本模块 + 两处文档注释），
 * 因此 `entities/sys-menu.entity.ts` 已直接归档为
 * `port-to-prisma__menu__sys-menu.entity.ts`。
 *
 * 两个 `forwardRef` 的用途不对称，保留原样：
 *  · `UserModule` —— `MenuService` 要注入 `UserService.getUserMenuIds()`（真实依赖，必须留着）；
 *  · `RoleModule` —— `MenuService` 要注入 `RolePermService.refreshAllRolePermsCache()`（真实依赖）。
 * 反向地，`UserModule` 里那句 `forwardRef(() => MenuModule)` 其实是**多余的**
 * （`UserService` 并不注入 `MenuService`），但属既有代码、与本次移植无关，故不动。
 */
@Module({
  imports: [forwardRef(() => UserModule), forwardRef(() => RoleModule)],
  controllers: [MenuController],
  providers: [MenuService],
  exports: [MenuService],
})
export class MenuModule {}
