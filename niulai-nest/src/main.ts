import { NestFactory, Reflector } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ValidationPipe, HttpStatus } from "@nestjs/common";
import { ResponseInterceptor } from "./common/interceptors/response.interceptor";
import { ConfigService } from "@nestjs/config";
import * as session from "express-session";
import type { ValidationError } from "class-validator";
import { BusinessException } from "./common/exceptions/business.exception";
import { ErrorCode } from "./common/enums/error-code.enum";
import { Logger } from "@nestjs/common";
import { enableBigIntJsonSerialization } from "./common/prisma/bigint-json";

async function bootstrap() {
  const logger = new Logger("Bootstrap");

  // 必须在任何响应序列化之前完成：把 BigInt 的 JSON 形态定义为字符串，
  // 与 TypeORM 时代 `bigNumberStrings: true` 的接口契约保持一致。
  enableBigIntJsonSerialization();

  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // 全局前缀
  app.setGlobalPrefix("/api/v1");

  // 跨域设置
  app.enableCors({
    origin: true,
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
    credentials: true,
  });

  // 全局拦截器
  // 传入 ConfigService 以支持日期格式化配置
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector), configService));

  // 全局验证管道
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      whitelist: true,
      forbidNonWhitelisted: false,
      exceptionFactory: (errors: ValidationError[]) => {
        const collect = (es: ValidationError[]): string[] => {
          const out: string[] = [];
          for (const e of es) {
            if (e.constraints) {
              out.push(...Object.values(e.constraints));
            }
            if (e.children && e.children.length > 0) {
              out.push(...collect(e.children));
            }
          }
          return out;
        };

        const messages = collect(errors)
          .map((m) => String(m).trim())
          .filter(Boolean);
        const msg = messages[0] || ErrorCode.USER_REQUEST_PARAMETER_ERROR.msg;
        return new BusinessException({
          code: ErrorCode.USER_REQUEST_PARAMETER_ERROR.code,
          msg,
          httpStatus: HttpStatus.BAD_REQUEST,
        });
      },
    })
  );

  // Swagger 配置
  const config = new DocumentBuilder()
    .setTitle("PeluVida OS")
    .setDescription(`PeluVida OS —— 宠物门店数字化经营系统 · 管理端接口文档`)
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  // 使用 alpha 排序
  SwaggerModule.setup("api-docs", app, document, {
    swaggerOptions: {
      tagsSorter: "alpha",
    },
  });

  // Session 配置
  app.use(
    session({
      secret: configService.getOrThrow<string>("jwt.secretKey"),
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 1000 * 60 * 60 * 24 * 7, // 7天
      },
    })
  );

  // 端口通过环境变量 SERVER_PORT 配置（默认 8000）
  const portRaw = configService.get("APP_PORT") ?? configService.get("SERVER_PORT") ?? 8000;
  const port = Number(portRaw) || 8000;
  await app.listen(port);
  logger.log(`应用已启动: http://localhost:${port}`);
  logger.log(`接口文档: http://localhost:${port}/api-docs`);

  // 优雅关闭（P0-01-03）：SIGTERM/SIGINT 时先停接新请求，再走 onModuleDestroy 链
  // （PrismaService 断开连接池、RedisService 优雅退出），避免容器滚动时连接泄漏。
  app.enableShutdownHooks();
}

void bootstrap();
