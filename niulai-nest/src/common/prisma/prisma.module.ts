import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

/**
 * Prisma 数据访问模块（PEL-10）
 *
 * 标记为 @Global：业务模块无需逐个 import 即可注入 PrismaService。
 * 这避免了移植期间在 7 个 system 模块里重复改写 imports 数组，
 * 也让后续新增业务域零成本拿到数据访问能力。
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
