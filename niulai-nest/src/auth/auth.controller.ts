import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  Inject,
  forwardRef,
  Delete,
  UseGuards,
} from "@nestjs/common";

import { AuthService } from "./auth.service";
import { AuthContextService } from "./auth-context.service";
import { UserService } from "../system/user/user.service";
import { LoginRequestDto } from "./dto/login-request.dto";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { LoginResultDto } from "./dto/login-result.dto";
import { SwitchContextRequestDto } from "./dto/switch-context.dto";
import { Public } from "../common/decorators/auth.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import type { CurrentUserInfo } from "../common/interfaces/current-user.interface";
import { Log } from "../common/decorators/log.decorator";
import { ActionTypeValue } from "../common/enums/action-type.enum";
import { LogModuleValue } from "../common/enums/log-module.enum";
import { ToolsService } from "../common/utils/captcha.util";
import { BusinessException } from "../common/exceptions/business.exception";
import { v4 as uuidv4 } from "uuid";
import { RedisService } from "../common/redis/redis.service";
import { ErrorCode } from "../common/enums/error-code.enum";
import { RequireTenant } from "../tenant/decorators/require-tenant.decorator";
import { TenantContextGuard } from "../tenant/guards/tenant-context.guard";

/**
 * 认证接口控制器
 */
@ApiTags("01.认证中心")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authContextService: AuthContextService,
    private readonly userService: UserService,
    private readonly toolsService: ToolsService,
    @Inject(forwardRef(() => RedisService))
    private readonly RedisService: RedisService
  ) {}

  /**
   * 获取当前登录用户信息（P0-02-06）
   *
   * 等价复用 /users/me 的 UserService.findMe（不复制粘贴逻辑），
   * 消除契约偏差（packages/api-contract README 记录的 /auth/me 未实现）。
   */
  @ApiOperation({ summary: "获取当前登录用户信息（等价 /users/me）" })
  @Get("me")
  async me(@CurrentUser() currentUser: CurrentUserInfo) {
    return await this.userService.findMe(currentUser);
  }

  /**
   * 当前租户可切换门店列表（P0-02-06 · 切店 UI 数据源）
   *
   * 平台级账号（无租户上下文）由 TenantContextGuard fail-closed 拒绝（403 + A0302）。
   */
  @ApiOperation({ summary: "当前租户可切换门店列表（启用状态，供切店 UI）" })
  @Get("organizations")
  @UseGuards(TenantContextGuard)
  @RequireTenant()
  async organizations() {
    return await this.authContextService.listSwitchableStores();
  }

  /**
   * 切换门店上下文（P0-02-06）
   *
   * 校验目标门店（存在 / 属当前租户 / 启用，否则 403 + A0212）后，
   * 签发内嵌 activeStoreId 的新 access token（refresh token 沿用原值，
   * tokenVersion 语义不变）。平台级账号 403 + A0302。
   */
  @ApiOperation({ summary: "切换门店上下文（签发内嵌 activeStoreId 的新 access token）" })
  @Post("switch-context")
  @UseGuards(TenantContextGuard)
  @RequireTenant()
  async switchContext(
    @CurrentUser() currentUser: CurrentUserInfo,
    @Body() switchDto: SwitchContextRequestDto
  ) {
    return await this.authContextService.switchStoreContext(currentUser, switchDto.storeId);
  }

  @ApiOperation({ summary: "登录接口" })
  @ApiOkResponse({ type: LoginResultDto })
  @Public()
  @Post("login")
  async login(@Body() loginDto: LoginRequestDto) {
    const { captchaCode, captchaId } = loginDto;

    // 图形验证码：captcha:image:{captchaId} -> text（短 TTL）
    const cacheCaptchaCode = await this.RedisService.get(`captcha:image:${captchaId}`);

    if (!cacheCaptchaCode) {
      throw new BusinessException(ErrorCode.USER_VERIFICATION_CODE_EXPIRED);
    }

    if (captchaCode?.toUpperCase() !== cacheCaptchaCode?.toUpperCase()) {
      throw new BusinessException(ErrorCode.USER_VERIFICATION_CODE_ERROR);
    }

    return await this.authService.login(loginDto);
  }

  @ApiOperation({ summary: "短信验证码登录" })
  @Public()
  @Post("login/sms")
  async loginBySms(@Query("mobile") mobile: string, @Query("code") code: string) {
    return await this.authService.loginBySms(mobile, code);
  }

  @ApiOperation({ summary: "发送登录短信验证码" })
  @Public()
  @Post("sms/code")
  async sendLoginVerifyCode(@Query("mobile") mobile: string) {
    await this.authService.sendSmsLoginCode(mobile);
    return null;
  }

  @ApiOperation({ summary: "注销登录" })
  @Log(LogModuleValue.LOGIN, ActionTypeValue.LOGOUT)
  @Delete("logout")
  async logout(@Req() req: any) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring("Bearer ".length);
      // JWT 模式：加入黑名单；redis-token 模式：清理 Redis 中的 token 映射
      await this.authService.blacklistToken(token);
    }

    // 清除用户信息
    req["user"] = null;
    // 向客户端返回成功的响应
    return null;
  }

  @ApiOperation({ summary: "获取验证码" })
  @Public()
  @Get("captcha")
  async getCode() {
    const svgCaptcha = await this.toolsService.captche();
    const captchaId = uuidv4();
    // 与 /auth/login 配套使用，120s 过期
    await this.RedisService.set(`captcha:image:${captchaId}`, svgCaptcha.captcha.text, 120);
    return {
      captchaBase64: svgCaptcha.base64,
      captchaId,
    };
  }

  @ApiOperation({ summary: "刷新令牌" })
  @Public()
  @Post("refresh-token")
  async refreshToken(@Query("refreshToken") refreshToken: string) {
    return await this.authService.refreshToken(refreshToken);
  }
}
