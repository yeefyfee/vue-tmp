import { Module } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthContextService } from "./auth-context.service";
import { AuthController } from "./auth.controller";
import { UserModule } from "../system/user/user.module";
import { RoleModule } from "../system/role/role.module";
import { LogModule } from "../system/log/log.module";
import { PassportModule } from "@nestjs/passport";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { RedisSharedModule } from "../common/redis/redis.module";
import { RedisService } from "../common/redis/redis.service";
import { ToolsService } from "../common/utils/captcha.util";

/**
 * 认证模块
 *
 * PEL-10c：已摘除 `TypeOrmModule.forFeature([SysUser, SysUserSocial])`。
 * 那一行是**死注册** —— `AuthService` 从不 `@InjectRepository(...)`，
 * 两个实体的 TypeORM 元数据没有任何消费者（`auth.service.ts` 只用
 * `UserService.getAuthCredentialsByUsername()` / `findByMobile()` 拿数据）。
 * 随着 `user` 模块移植到 Prisma，这两个实体文件已归档，此处的 import 也随之删除。
 */
@Module({
  imports: [
    UserModule,
    RoleModule,
    LogModule,
    RedisSharedModule,
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (config: ConfigService) => ({
        secret: config.getOrThrow<string>("jwt.secretKey"),
        signOptions: {
          expiresIn: config.get<number>("jwt.expiresIn"),
          issuer: config.get<string>("jwt.issuer"),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  // AuthContextService（P0-02-06）：门店上下文接口的 prisma 读取 + 复用 AuthService 签发；
  // PrismaService 来自全局 PrismaModule，TenantContextGuard 来自全局 TenantModule
  providers: [AuthService, AuthContextService, JwtStrategy, RedisService, ToolsService],
  exports: [AuthService],
})
export class AuthModule {}
