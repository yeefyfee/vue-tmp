/**
 * BigInt JSON 序列化兼容层（PEL-10c 移植约定）
 *
 * 问题：Prisma 对 `bigint` 列返回 JS BigInt，而 `JSON.stringify(1n)` 直接抛
 * `TypeError: Do not know how to serialize a BigInt` —— 接口会 500。
 *
 * 原 TypeORM 通过 `bigNumberStrings: true` 把大整数**序列化成字符串**，
 * 前端与 DTO 也一直按 string 处理。因此这里把 BigInt 的 JSON 形态定义为字符串，
 * 是**保持既有接口契约不变**的最小改动（而不是让前端去适配 number，那会丢精度）。
 *
 * ⚠️ 这是全局副作用，必须在应用启动最早期调用一次（见 `main.ts`）。
 */
export function enableBigIntJsonSerialization(): void {
  const proto = BigInt.prototype as unknown as { toJSON?: () => string };
  if (typeof proto.toJSON === "function") return;

  Object.defineProperty(BigInt.prototype, "toJSON", {
    value: function toJSON(this: bigint): string {
      return this.toString();
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
