import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { normalizePageQuery, type PageResult, type PageQuery } from "@peluvida/shared";
import { ErrorCode } from "../../common/enums/error-code.enum";
import { Response } from "../../common/interfaces/response.interface";
import { transformDatesInObject, DateFormatOptions } from "../../common/utils/serialize.util";
import { ConfigService } from "@nestjs/config";

/**
 * 业务层分页载荷：统一返回 `{ data, page }`
 * - `data` 为当前页数据
 * - `page` 为分页元信息，历史命名为 `pageNum / pageSize / total`
 */
interface PaginatedPayload<T = unknown> {
  data: T;
  page: {
    pageNum?: number;
    pageSize?: number;
    page?: number;
    page_size?: number;
    total?: number;
  };
}

/**
 * 判定 `page` 是否为分页元信息。
 *
 * 需要同时满足两点：既要**排除**「恰好也叫 page 的普通业务字段」
 * （否则 `{ data: xxx, page: { theme: "dark" } }` 会被误改写并丢失内容），
 * 又要**兼容**业务层的历史命名 `{ pageNum, pageSize, total }`。
 *
 * 判定规则：`total` 为数字，**或** 同时存在数字型页码与每页条数。
 *
 * ⚠️ 分页元信息必须是「数字」：字符串型（如 `{ pageNum: "1", pageSize: "20" }`）
 * 会被判为非分页而不做改写。当前业务层的分页 service 均返回数字，
 * 新增分页接口时请勿改成字符串，否则列表会静默失去 `list/total/page/page_size` 信封。
 */
function isPageMeta(value: unknown): value is PaginatedPayload["page"] {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  const hasNumericTotal = typeof candidate.total === "number";
  const hasPageNum = typeof candidate.pageNum === "number" || typeof candidate.page === "number";
  const hasPageSize =
    typeof candidate.pageSize === "number" || typeof candidate.page_size === "number";

  return hasNumericTotal || (hasPageNum && hasPageSize);
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, Response<T>> {
  private readonly dateFormatOptions: DateFormatOptions;
  constructor(
    private readonly reflector: Reflector,
    configService?: ConfigService
  ) {
    this.dateFormatOptions = {
      format: configService?.get<string>("DATE_FORMAT") || "yyyy-MM-dd HH:mm:ss",
      timeZone: configService?.get<string>("TIME_ZONE") || "Asia/Shanghai",
    };
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<Response<T>> {
    const skip = this.reflector.getAllAndOverride<boolean>("skipResponseTransform", [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) {
      return next.handle() as any;
    }

    return next.handle().pipe(
      map((data) => {
        // 分页接口：业务层统一返回 { data, page }
        // ⚠️ 判定需同时满足「含 data」+「page 是分页元信息（含数字 total）」，
        //    避免普通业务对象因恰好有 page 字段而被误改写。
        if (
          data &&
          typeof data === "object" &&
          Object.prototype.hasOwnProperty.call(data as any, "data") &&
          isPageMeta((data as any).page)
        ) {
          const payload = data as PaginatedPayload;
          const page = payload.page ?? {};
          const formattedData = transformDatesInObject(payload.data, this.dateFormatOptions);
          const query = this.resolvePageQuery(page, ctx);

          // 列表信封统一为 list / total / page / page_size
          // ⚠️ 决策 A4 / PEL-08：在既有 { list, total } 上「纯增量」补 page / page_size，
          //    不改变外层 code / msg / data 结构，存量前端读取 res.list / res.total 不受影响。
          const result: PageResult<unknown> = {
            list: Array.isArray(formattedData) ? formattedData : [],
            total: typeof page.total === "number" ? page.total : 0,
            page: query.page,
            page_size: query.page_size,
          };

          return {
            code: ErrorCode.SUCCESS.code,
            msg: ErrorCode.SUCCESS.msg,
            data: result as any,
          };
        }

        const formatted = transformDatesInObject(data, this.dateFormatOptions);
        return {
          code: ErrorCode.SUCCESS.code,
          msg: ErrorCode.SUCCESS.msg,
          data: formatted,
        };
      })
    );
  }

  /**
   * 解析分页参数：优先取业务层 page 元信息，其次回落到请求 query，最后用共享包默认值。
   * 复用 @peluvida/shared 的 normalizePageQuery，天然兼容 pageNum / pageSize 历史命名与 100 条上限。
   */
  private resolvePageQuery(page: PaginatedPayload["page"], ctx: ExecutionContext): PageQuery {
    const request = ctx.switchToHttp().getRequest?.();
    const query = request?.query ?? {};

    return normalizePageQuery({
      page: page?.page ?? page?.pageNum ?? query.page ?? query.pageNum,
      page_size: page?.page_size ?? page?.pageSize ?? query.page_size ?? query.pageSize,
    });
  }
}
