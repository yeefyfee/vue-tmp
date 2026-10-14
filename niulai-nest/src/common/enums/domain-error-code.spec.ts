import { HttpStatus } from "@nestjs/common";
import {
  DOMAIN_ERROR_SEGMENTS,
  DomainErrorCode,
  getDomainError,
  registerDomainError,
} from "./domain-error-code.enum";

/** 段基线锚点：分段规则与文档一致（CROSS-13） */
describe("DOMAIN_ERROR_SEGMENTS", () => {
  it("五段基线落位正确", () => {
    expect(DOMAIN_ERROR_SEGMENTS.COMMON).toEqual([10000, 19999]);
    expect(DOMAIN_ERROR_SEGMENTS.CUSTOMER_PET).toEqual([20000, 29999]);
    expect(DOMAIN_ERROR_SEGMENTS.BOOKING_ORDER).toEqual([30000, 39999]);
    expect(DOMAIN_ERROR_SEGMENTS.PAYMENT).toEqual([40000, 49999]);
    expect(DOMAIN_ERROR_SEGMENTS.STAY_CARE).toEqual([50000, 59999]);
  });

  it("各段代表条目落在对应段内，命名符合 域_对象_原因", () => {
    const cases: Array<[number, string, keyof typeof DOMAIN_ERROR_SEGMENTS]> = [
      [DomainErrorCode.CUSTOMER_NOT_FOUND.code, "CUSTOMER_NOT_FOUND", "CUSTOMER_PET"],
      [DomainErrorCode.BOOKING_SLOT_CONFLICT.code, "BOOKING_SLOT_CONFLICT", "BOOKING_ORDER"],
      [DomainErrorCode.PAYMENT_CHANNEL_ERROR.code, "PAYMENT_CHANNEL_ERROR", "PAYMENT"],
      [DomainErrorCode.STAY_ROOM_UNAVAILABLE.code, "STAY_ROOM_UNAVAILABLE", "STAY_CARE"],
    ];
    for (const [code, name, segment] of cases) {
      const [min, max] = DOMAIN_ERROR_SEGMENTS[segment];
      expect(code).toBeGreaterThanOrEqual(min);
      expect(code).toBeLessThanOrEqual(max);
      expect(name).toMatch(/^[A-Z]+(_[A-Z0-9]+)+$/);
    }
  });
});

describe("registerDomainError 守卫", () => {
  it("重复命名抛错", () => {
    expect(() =>
      registerDomainError("BOOKING_ORDER", {
        code: 30002,
        name: "BOOKING_SLOT_CONFLICT",
        msg: "x",
        httpStatus: HttpStatus.BAD_REQUEST,
      })
    ).toThrow(/命名冲突/);
  });

  it("数字码冲突抛错", () => {
    // 40001 已被 PAYMENT_CHANNEL_ERROR 占用，且落在 PAYMENT 段内（先过段检查再撞数字码）
    expect(() =>
      registerDomainError("PAYMENT", {
        code: 40001,
        name: "PAYMENT_DUPLICATE_CODE",
        msg: "x",
        httpStatus: HttpStatus.BAD_REQUEST,
      })
    ).toThrow(/数字码冲突/);
  });

  it("段越界抛错", () => {
    expect(() =>
      registerDomainError("STAY_CARE", {
        code: 40002,
        name: "STAY_OUT_OF_SEGMENT",
        msg: "x",
        httpStatus: HttpStatus.BAD_REQUEST,
      })
    ).toThrow(/不在 STAY_CARE 段/);
  });

  it("合法条目可登记并可按名取回", () => {
    const entry = registerDomainError("COMMON", {
      code: 10001,
      name: "COMMON_DEMO_ENTRY",
      msg: "演示条目",
      httpStatus: HttpStatus.BAD_REQUEST,
    });
    expect(getDomainError("COMMON_DEMO_ENTRY")).toEqual(entry);
    expect(getDomainError("NOT_REGISTERED")).toBeUndefined();
  });
});
