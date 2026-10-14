/**
 * dict 模块 Prisma 移植 · 真库验证（PEL-10c）
 *
 * 直接实例化 DictService（不启 Nest、不需要登录），走真实 PostgreSQL，
 * 逐项校验「对外契约与 TypeORM 版本一致」，并覆盖静态检查查不出的语义：
 *   分页信封 / 关键字大小写不敏感（name·dictCode 两支）/ 排序 / 下拉选项过滤 /
 *   唯一性校验 / 逻辑删除 / 字典项的物理删除 / 审计字段补齐 / 主键 BigInt→字符串序列化。
 *
 * 另外把**已知缺陷**固化成断言（改断言即可知行为被改动了）：
 *   ① `updateDict` / `updateDictItem` **从不刷新 `updateTime`**（原实现走 `repository.update()`，
 *      不触发 AuditSubscriber；而 `deleteDict` 是显式赋 updateTime 的那个 —— 两者刻意不同）；
 *   ② `createDictItem` 的 DTO 里有 `remark`，但原实现 `create()` **从不下发该字段** ⇒ remark 丢；
 *   ③ `createDict` **只校验 dictCode 唯一、不校验 name**（同名可重复建）。
 *
 * 安全约定：所有造数名称/编码都带 `VERIFYDICT` 前缀，脚本开始与结束各清理一次；
 * 只删自己造的数据。
 *
 * 运行：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/verify-dict-module.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { DictService } from "../src/system/dict/dict.service";
import { enableBigIntJsonSerialization } from "../src/common/prisma/bigint-json";

enableBigIntJsonSerialization();

const CONNECTION =
  process.env.DATABASE_URL ?? "postgresql://admin:Pg%40123456@127.0.0.1:5432/peluvida_dev";

const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: CONNECTION }) });

/** SseService 打桩：记录被通知的 dictCode，用于校验「写操作都广播了字典变更」 */
const sseCalls: string[] = [];
const sseStub = {
  sendDictChange(dictCode: string) {
    sseCalls.push(dictCode);
  },
} as never;

const service = new DictService(
  Object.assign(Object.create(base), { scoped: base }) as never,
  sseStub
);

const MARK = "VERIFYDICT";

let failures = 0;
let checks = 0;

function check(label: string, actual: unknown, expected: unknown) {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "√" : "✗"} ${label}  → 实际 ${JSON.stringify(actual)}${
      ok ? "" : `（期望 ${JSON.stringify(expected)}）`
    }`
  );
}

function checkTrue(label: string, actual: unknown) {
  checks += 1;
  const ok = Boolean(actual);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "√" : "✗"} ${label}  → 实际 ${JSON.stringify(actual)}`);
}

/**
 * 取异常里**真正的业务文案**。
 *
 * 坑：`BusinessException extends HttpException`，且构造时传的是**对象** `{ code, msg }`。
 * Nest 的 `HttpException#initMessage()` 只认字符串 response 或 `response.message`，
 * 对象里放的是 `msg` ⇒ `error.message` 退化成类名 `"Business Exception"`，真文案在
 * `error.response.msg`。（`config` 模块抛的是 `BadRequestException("…")`，字符串 response，不受影响。）
 */
function exceptionMessage(e: unknown): string {
  const err = e as { response?: unknown; message?: string; getResponse?: () => unknown };
  const resp = typeof err.getResponse === "function" ? err.getResponse() : err.response;
  if (typeof resp === "string") return resp;
  if (resp && typeof resp === "object") {
    const msg = (resp as { msg?: unknown }).msg;
    if (typeof msg === "string") return msg;
  }
  return err.message ?? "";
}

async function expectThrow(label: string, fn: () => Promise<unknown>, messagePart: string) {
  checks += 1;
  try {
    await fn();
    failures += 1;
    console.log(`  ✗ ${label}  → 未抛错（期望「${messagePart}」）`);
  } catch (e) {
    const msg = exceptionMessage(e);
    const ok = msg.includes(messagePart);
    if (!ok) failures += 1;
    console.log(`  ${ok ? "√" : "✗"} ${label}  → 抛出「${msg}」`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toId(value: unknown): bigint {
  return BigInt(String(value));
}

async function cleanup() {
  await base.sysDictItem.deleteMany({ where: { dictCode: { contains: MARK } } });
  await base.sysDict.deleteMany({
    where: { OR: [{ dictCode: { contains: MARK } }, { name: { contains: MARK } }] },
  });
}

// ------------------------------------------------------------------ 夹具

let dictAId = 0n; // 启用，name/code 都带 MARK
let dictBId = 0n; // 停用，用于验证下拉选项过滤 + 删除
let dictCId = 0n; // name **不含** MARK，仅 dictCode 带 MARK（验证 dictCode 命中分支）

async function seedDicts() {
  const a = await service.createDict({
    dictCode: `${MARK}-A`,
    name: `${MARK}-甲字典`,
    status: 1,
    remark: "甲备注",
  } as never);
  dictAId = toId(a.id);

  const b = await service.createDict({
    dictCode: `${MARK}-B`,
    name: `${MARK}-乙字典`,
    status: 0,
    remark: "乙备注",
  } as never);
  dictBId = toId(b.id);

  const c = await service.createDict({
    dictCode: `${MARK}-C`,
    name: `丙字典`, // 刻意不含 MARK，仅靠 dictCode 命中
    status: 1,
  } as never);
  dictCId = toId(c.id);

  // createTime 由 auditOnCreate 写成「现在」，同一毫秒内无法拉开顺序 ⇒
  // 手工改成三个互不相同的确定值，让「按 createTime DESC」可精确断言。
  // 年份避开 1986–1991（中国夏令时，Intl 会按历史 tzdata 还原成 UTC+9）。
  await base.sysDict.update({
    where: { id: dictAId },
    data: { createTime: new Date("1998-03-01T02:00:00Z") },
  });
  await base.sysDict.update({
    where: { id: dictBId },
    data: { createTime: new Date("1999-03-01T02:00:00Z") },
  });
  await base.sysDict.update({
    where: { id: dictCId },
    data: { createTime: new Date("2000-03-01T02:00:00Z") },
  });
}

async function main() {
  await cleanup();
  sseCalls.length = 0;
  await seedDicts();

  // ---------------------------------------------------------------- 1) 创建与审计
  console.log("\n=== 1) 创建字典：返回值形状与审计字段 ===");
  const rowA = (await base.sysDict.findFirst({ where: { id: dictAId } }))!;
  check("dictCode 已落库", rowA.dictCode, `${MARK}-A`);
  check("name 已落库", rowA.name, `${MARK}-甲字典`);
  check("status 已落库", rowA.status, 1);
  check("remark 已落库", rowA.remark, "甲备注");
  check("未传 createBy 时该列保持 NULL", rowA.createBy, null);
  check("isDeleted 默认 0", rowA.isDeleted, 0);
  checkTrue("createTime 已填充（替代原 AuditSubscriber）", rowA.createTime instanceof Date);
  checkTrue("updateTime 已填充（新建时也写）", rowA.updateTime instanceof Date);

  check("createDict 广播了字典变更", sseCalls, [`${MARK}-A`, `${MARK}-B`, `${MARK}-C`]);

  console.log("\n=== 2) 唯一性校验（只校验 dictCode） ===");
  sseCalls.length = 0;
  await expectThrow(
    "重复 dictCode 被拒",
    () => service.createDict({ dictCode: `${MARK}-A`, name: "另一个名字", status: 1 } as never),
    "字典已存在"
  );
  check("被拒时不广播 SSE", sseCalls, []);

  // 【已知缺陷】原实现只查 dictCode，不查 name ⇒ 同名可重复建
  const dupName = await service.createDict({
    dictCode: `${MARK}-D`,
    name: `${MARK}-甲字典`,
    status: 1,
  } as never);
  check(
    "【已知缺陷】同名不同编码允许重复创建（原实现只校验 dictCode）",
    dupName.name,
    `${MARK}-甲字典`
  );

  // ---------------------------------------------------------------- 3) 分页
  console.log("\n=== 3) 字典分页：信封 / 关键字 / 排序 ===");
  const page1 = await service.getDictPage(1, 10, MARK);
  check("分页信封形状", Object.keys(page1).sort(), ["data", "page"]);
  check("page 子对象形状", Object.keys(page1.page).sort(), ["pageNum", "pageSize", "total"]);
  check("关键字命中我造的 4 条", page1.page.total, 4);
  check("pageNum/pageSize 回显", [page1.page.pageNum, page1.page.pageSize], [1, 10]);
  check("每行只返回 4 个字段", Object.keys(page1.data[0] as object).sort(), [
    "dictCode",
    "id",
    "name",
    "status",
  ]);
  check(
    "按 createTime DESC 排序（后建的排前）",
    page1.data.map((d) => d.dictCode),
    [`${MARK}-D`, `${MARK}-C`, `${MARK}-B`, `${MARK}-A`]
  );

  const kwLower = await service.getDictPage(1, 10, MARK.toLowerCase());
  check("关键字大小写不敏感（MySQL CI 语义）", kwLower.page.total, 4);

  const onlyByCode = await service.getDictPage(1, 10, `${MARK}-C`);
  check("仅 dictCode 命中也能搜到（name 不含关键字）", onlyByCode.page.total, 1);
  check("且命中的正是丙字典", onlyByCode.data[0].name, "丙字典");

  const pageSize2 = await service.getDictPage(2, 2, MARK);
  check("翻页：第 2 页 2 条", pageSize2.data.length, 2);
  check("翻页：total 不受分页影响", pageSize2.page.total, 4);
  check("翻页：pageNum 回显", pageSize2.page.pageNum, 2);

  check(
    "非法 pageNum/pageSize 回落为 1/10",
    (await service.getDictPage(0, -3, MARK)).page.pageSize,
    10
  );
  check(
    "无命中时返回空列表",
    (await service.getDictPage(1, 10, "绝不存在的字典ZZZ")).page.total,
    0
  );

  // ---------------------------------------------------------------- 4) 下拉选项
  console.log("\n=== 4) 字典下拉选项（仅 status=1） ===");
  const options = await service.getDictOptions();
  const optionCodes = options.map((o) => o.value);
  checkTrue("含启用的甲字典", optionCodes.includes(`${MARK}-A`));
  checkTrue("含启用的丙字典", optionCodes.includes(`${MARK}-C`));
  checkTrue("不含停用的乙字典", !optionCodes.includes(`${MARK}-B`));
  const optionA = options.find((o) => o.value === `${MARK}-A`)!;
  check("选项 label 取字典名", optionA.label, `${MARK}-甲字典`);
  check("选项只含 label/value 两个键", Object.keys(optionA).sort(), ["label", "value"]);

  // ---------------------------------------------------------------- 5) 表单查询
  console.log("\n=== 5) 字典表单 ===");
  const form = await service.getDictForm(dictAId.toString());
  check("表单只返回 5 个字段", Object.keys(form).sort(), [
    "dictCode",
    "id",
    "name",
    "remark",
    "status",
  ]);
  // 主键在**进程内**仍是 BigInt（按移植约定第 5 条，走全局 toJSON 垫片序列化），
  // 所以这里断言的是「上线后真正出网的形态」= JSON 序列化结果，而不是 typeof()。
  check(
    "表单 id 经 JSON 序列化后为字符串（大整数不丢精度）",
    typeof JSON.parse(JSON.stringify(form)).id,
    "string"
  );
  check("表单 id 值正确", form.id, dictAId.toString());
  await expectThrow(
    "不存在的 ID 抛「字典不存在」",
    () => service.getDictForm("999999999"),
    "字典不存在"
  );
  await expectThrow(
    "非法 ID 抛「字典不存在」（不落成 SQL 错误）",
    () => service.getDictForm("abc"),
    "字典不存在"
  );

  // ---------------------------------------------------------------- 6) 更新
  console.log("\n=== 6) 更新字典 ===");
  const beforeUpdate = (await base.sysDict.findFirst({ where: { id: dictAId } }))!;
  await sleep(30);
  const updated = await service.updateDict(dictAId.toString(), {
    name: `${MARK}-甲字典改`,
  } as never);
  check("updateDict 返回 true", updated, true);

  const afterUpdate = (await base.sysDict.findFirst({ where: { id: dictAId } }))!;
  check("name 已更新", afterUpdate.name, `${MARK}-甲字典改`);
  check("未传的 dictCode 保持不变（undefined 被跳过）", afterUpdate.dictCode, `${MARK}-A`);
  check("未传的 status 保持不变（undefined 被跳过）", afterUpdate.status, 1);
  check("未传的 remark 保持不变（不会被写成 NULL）", afterUpdate.remark, "甲备注");
  check(
    "【已知缺陷】updateDict 不刷新 updateTime（原实现走 update()，不触发订阅器）",
    afterUpdate.updateTime?.getTime(),
    beforeUpdate.updateTime?.getTime()
  );
  checkTrue("更新也广播了 SSE", sseCalls.includes(`${MARK}-A`));

  const statusOff = await service.updateDict(dictCId.toString(), { status: 0 } as never);
  check("只传 status 也能更新", statusOff, true);
  check(
    "只传 status 时 name 不被覆盖成 undefined",
    (await base.sysDict.findFirst({ where: { id: dictCId } }))!.name,
    "丙字典"
  );
  await service.updateDict(dictCId.toString(), { status: 1 } as never);

  await expectThrow(
    "更新不存在的字典抛「字典不存在」",
    () => service.updateDict("999999999", { name: "x" } as never),
    "字典不存在"
  );

  // ---------------------------------------------------------------- 7) 删除字典
  console.log("\n=== 7) 删除字典（逻辑删除） ===");
  const beforeDelete = (await base.sysDict.findFirst({ where: { id: dictBId } }))!;
  await sleep(30);
  check("deleteDict 返回 true", await service.deleteDict(dictBId.toString(), 1), true);

  const deletedRow = await base.sysDict.findFirst({ where: { id: dictBId } });
  checkTrue("逻辑删除：行仍在物理表中", deletedRow !== null);
  check("逻辑删除：isDeleted 置 1", deletedRow?.isDeleted, 1);
  check("删除时写入了 updateBy", deletedRow?.updateBy?.toString(), "1");
  checkTrue(
    "deleteDict 刷新了 updateTime（与 updateDict 刻意不同）",
    (deletedRow?.updateTime?.getTime() ?? 0) > (beforeDelete.updateTime?.getTime() ?? 0)
  );
  check("删除后不出现在分页里", (await service.getDictPage(1, 10, `${MARK}-B`)).page.total, 0);
  await expectThrow(
    "重复删除已逻辑删除的字典抛「字典不存在」",
    () => service.deleteDict(dictBId.toString(), 1),
    "字典不存在"
  );

  // ---------------------------------------------------------------- 8) 字典项：创建
  console.log("\n=== 8) 字典项：创建 ===");
  sseCalls.length = 0;
  await expectThrow(
    "字典不存在时禁止建项",
    () =>
      service.createDictItem({
        dictCode: `${MARK}-NOSUCH`,
        label: "x",
        value: "1",
        sort: 1,
        status: 1,
      } as never),
    "字典不存在"
  );

  const item1 = await service.createDictItem({
    dictCode: `${MARK}-A`,
    label: "选项甲",
    value: "opt-a",
    sort: 2,
    status: 1,
    tagType: "primary",
    remark: "这个备注应当被忽略",
  } as never);
  check("创建字典项只返回 7 个字段", Object.keys(item1).sort(), [
    "dictCode",
    "id",
    "label",
    "sort",
    "status",
    "tagType",
    "value",
  ]);

  const item1Row = (await base.sysDictItem.findFirst({ where: { id: toId(item1.id) } }))!;
  check("字典项 createTime 已填充", item1Row.createTime instanceof Date, true);
  check("字典项 updateTime 已填充", item1Row.updateTime instanceof Date, true);
  check("字典项 createBy 未传时为 NULL", item1Row.createBy, null);
  check(
    "【已知缺陷】createDictItem 丢弃 DTO 里的 remark（原实现 create() 未下发该字段）",
    item1Row.remark,
    null
  );

  const item2 = await service.createDictItem({
    dictCode: `${MARK}-A`,
    label: "选项乙",
    value: "opt-b",
    sort: 1,
    status: 1,
    tagType: "success",
  } as never);
  const item3 = await service.createDictItem({
    dictCode: `${MARK}-A`,
    label: "选项丙",
    value: "opt-c",
    sort: 3,
    status: 0,
  } as never);
  const item1IdStr = toId(item1.id).toString();
  const item2IdStr = toId(item2.id).toString();
  const item3IdStr = toId(item3.id).toString();

  check("三次创建都广播了 SSE", sseCalls, [`${MARK}-A`, `${MARK}-A`, `${MARK}-A`]);

  await expectThrow(
    "同字典内重复 value 被拒",
    () =>
      service.createDictItem({
        dictCode: `${MARK}-A`,
        label: "重复值",
        value: "opt-a",
        sort: 9,
        status: 1,
      } as never),
    `字典项值 "opt-a" 已存在`
  );

  // 不同字典下允许同 value（唯一性只在 dictCode 内）
  const crossDict = await service.createDictItem({
    dictCode: `${MARK}-C`,
    label: "跨字典同值",
    value: "opt-a",
    sort: 1,
    status: 1,
  } as never);
  checkTrue("不同字典下允许同 value", Boolean(crossDict.id));

  const item3Row = (await base.sysDictItem.findFirst({ where: { id: toId(item3.id) } }))!;
  check("未传 tagType 时落库为 NULL", item3Row.tagType, null);
  check("未传 tagType 不影响其它列", item3Row.value, "opt-c");

  // ---------------------------------------------------------------- 9) 字典项：查询与排序
  console.log("\n=== 9) 字典项：分页 / 列表 / 排序 ===");
  const itemPage = await service.getDictItemPage(1, 10, `${MARK}-A`);
  check("字典项分页信封形状", Object.keys(itemPage).sort(), ["data", "page"]);
  check("字典项分页只返回 7 个字段", Object.keys(itemPage.data[0] as object).sort(), [
    "dictCode",
    "id",
    "label",
    "sort",
    "status",
    "tagType",
    "value",
  ]);
  check("字典项 total 为 3", itemPage.page.total, 3);
  check(
    "按 sort ASC 排序",
    itemPage.data.map((i) => i.value),
    ["opt-b", "opt-a", "opt-c"]
  );
  check(
    "字典项分页不串字典",
    (await service.getDictItemPage(1, 10, `${MARK}-A`)).data.every(
      (i) => i.dictCode === `${MARK}-A`
    ),
    true
  );

  const itemKw = await service.getDictItemPage(1, 10, `${MARK}-A`, "选项乙");
  check("字典项按 label 关键字命中", itemKw.page.total, 1);
  const itemKwValue = await service.getDictItemPage(1, 10, `${MARK}-A`, "OPT-A");
  check("字典项按 value 关键字命中且大小写不敏感", itemKwValue.page.total, 1);
  check("非法分页回落", (await service.getDictItemPage(0, 0, `${MARK}-A`)).page.pageSize, 10);

  const items = await service.getDictItems(`${MARK}-A`);
  check("列表接口只返回 label/value/tagType", Object.keys(items[0] as object).sort(), [
    "label",
    "tagType",
    "value",
  ]);
  check(
    "列表接口同样按 sort ASC",
    items.map((i) => i.value),
    ["opt-b", "opt-a", "opt-c"]
  );
  check("列表接口不含字典项 id（原实现如此）", "id" in (items[0] as object), false);

  // ---------------------------------------------------------------- 10) 字典项：表单 / 更新 / 删除
  console.log("\n=== 10) 字典项：表单 / 更新 / 物理删除 ===");
  const itemForm = await service.getDictItemForm(item1IdStr);
  check("字典项表单返回 8 个字段（含 remark）", Object.keys(itemForm).sort(), [
    "dictCode",
    "id",
    "label",
    "remark",
    "sort",
    "status",
    "tagType",
    "value",
  ]);
  await expectThrow(
    "字典项不存在时抛「字典项不存在」",
    () => service.getDictItemForm("999999999"),
    "字典项不存在"
  );
  await expectThrow(
    "字典项非法 ID 抛「字典项不存在」",
    () => service.getDictItemForm("abc"),
    "字典项不存在"
  );

  await expectThrow(
    "改成同字典内已用的 value 被拒",
    () => service.updateDictItem(item1IdStr, { value: "opt-b" } as never),
    `字典项值 "opt-b" 已存在`
  );

  const beforeItemUpdate = (await base.sysDictItem.findFirst({ where: { id: toId(item1.id) } }))!;
  await sleep(30);
  check(
    "沿用自身 value 不报错",
    await service.updateDictItem(item1IdStr, { value: "opt-a", label: "选项甲改" } as never),
    true
  );
  const afterItemUpdate = (await base.sysDictItem.findFirst({ where: { id: toId(item1.id) } }))!;
  check("label 已更新", afterItemUpdate.label, "选项甲改");
  check("sort 未被覆盖", afterItemUpdate.sort, 2);
  check("status 未被覆盖", afterItemUpdate.status, 1);
  check(
    "【已知缺陷】updateDictItem 不刷新 updateTime（同 updateDict）",
    afterItemUpdate.updateTime?.getTime(),
    beforeItemUpdate.updateTime?.getTime()
  );

  // 与 create 相反：update **会**下发 remark
  await service.updateDictItem(item2IdStr, { remark: "更新时写入的备注" } as never);
  check(
    "update 路径可以写入 remark（与 create 丢弃 remark 形成对照）",
    (await base.sysDictItem.findFirst({ where: { id: toId(item2.id) } }))!.remark,
    "更新时写入的备注"
  );

  await expectThrow(
    "更新不存在的字典项抛「字典项不存在」",
    () => service.updateDictItem("999999999", { label: "x" } as never),
    "字典项不存在"
  );

  check("deleteDictItems 返回 true", await service.deleteDictItems(item3IdStr), true);
  check(
    "字典项是**物理删除**：行已从表中消失",
    await base.sysDictItem.findFirst({ where: { id: toId(item3.id) } }),
    null
  );
  await expectThrow(
    "重复删除字典项抛「字典项不存在」",
    () => service.deleteDictItems(item3IdStr),
    "字典项不存在"
  );
  await expectThrow(
    "删除非法 ID 抛「字典项不存在」",
    () => service.deleteDictItems("abc"),
    "字典项不存在"
  );

  // ---------------------------------------------------------------- 11) 收尾
  console.log("\n=== 11) 清理与残留检查 ===");
  await cleanup();
  check(
    "字典项造数已清理干净",
    await base.sysDictItem.count({ where: { dictCode: { contains: MARK } } }),
    0
  );
  check(
    "字典造数已清理干净",
    await base.sysDict.count({
      where: { OR: [{ dictCode: { contains: MARK } }, { name: { contains: MARK } }] },
    }),
    0
  );

  await base.$disconnect();
}

main()
  .catch(async (e) => {
    console.error("VERIFY_FAILED", e);
    await cleanup().catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => {
    console.log(
      `\n================ dict 模块验证：${checks - failures}/${checks} 通过 ================`
    );
    if (failures) {
      console.log(`失败 ${failures} 项`);
      process.exitCode = 1;
    }
  });
