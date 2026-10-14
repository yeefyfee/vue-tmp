import { Module, forwardRef } from "@nestjs/common";
import { DeptService } from "./dept.service";
import { DeptController } from "./dept.controller";
import { UserModule } from "../user/user.module";

@Module({
  // PrismaService 由全局 PrismaModule 提供，无需 TypeOrmModule.forFeature；
  // 保留 forwardRef 是因为 UserModule（仍在使用中）反向依赖 DeptService，构成循环引用
  imports: [forwardRef(() => UserModule)],
  controllers: [DeptController],
  providers: [DeptService],
  exports: [DeptService],
})
export class DeptModule {}
