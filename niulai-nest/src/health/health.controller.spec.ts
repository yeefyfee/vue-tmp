import { HealthController } from "./health.controller";

/**
 * 健康检查单测（P0-01-03）
 *
 * 覆盖：全健康 200 / DB 不可用 503 / Redis 不可用 503 / PING 异常返回 503 /
 * 超时 503（时钟 fake 加速）。
 */

describe("HealthController", () => {
  let controller: HealthController;
  let prismaMock: { $queryRaw: jest.Mock };
  let redisMock: { getClient: jest.Mock };
  let res: { status: jest.Mock; json: jest.Mock };

  beforeEach(() => {
    prismaMock = { $queryRaw: jest.fn() };
    redisMock = {
      getClient: jest.fn().mockReturnValue({ ping: jest.fn().mockResolvedValue("PONG") }),
    };
    controller = new HealthController(prismaMock as never, redisMock as never);
    res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  });

  it("全健康 → 200 status=ok 且无 errors", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);

    await controller.check(res as never);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      status: "ok",
      checks: { db: true, redis: true },
    });
  });

  it("DB 不可用 → 503，errors.db 携带原因", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("connect ECONNREFUSED"));

    await controller.check(res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe("error");
    expect(body.checks).toEqual({ db: false, redis: true });
    expect(body.errors.db).toContain("ECONNREFUSED");
  });

  it("Redis PING 抛错 → 503，errors.redis 携带原因", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    redisMock.getClient().ping.mockRejectedValue(new Error("Connection is closed"));

    await controller.check(res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.checks).toEqual({ db: true, redis: false });
    expect(body.errors.redis).toContain("Connection is closed");
  });

  it("PING 返回非 PONG → 503（连通但语义异常）", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    redisMock.getClient().ping.mockResolvedValue("WEIRD");

    await controller.check(res as never);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.checks.redis).toBe(false);
    expect(body.errors.redis).toContain("unexpected ping result");
  });

  it("依赖挂死超时 → 503，errors 记录 timeout", async () => {
    jest.useFakeTimers();
    prismaMock.$queryRaw.mockReturnValue(new Promise(() => undefined)); // 永不 resolve
    redisMock.getClient().ping.mockReturnValue(new Promise(() => undefined));

    // 两项探活各挂一个 2s timer（串行 race），runAllTimersAsync 连续触发全部
    const pending = controller.check(res as never);
    await jest.runAllTimersAsync();
    await pending;

    expect(res.status).toHaveBeenCalledWith(503);
    const body = res.json.mock.calls[0][0];
    expect(body.checks).toEqual({ db: false, redis: false });
    expect(body.errors.db).toContain("timeout");
    expect(body.errors.redis).toContain("timeout");
    jest.useRealTimers();
  });
});
