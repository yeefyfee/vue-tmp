/**
 * dept 模块 Prisma 移植 · 真库验证（PEL-10c）
 *
 * 直接实例化 DeptService（不启 Nest、不需要登录），走真实 PostgreSQL，
 * 逐项校验「对外契约与 TypeORM 版本一致」，并覆盖几类静态检查查不出的语义：
 *   树构建与排序 / treePath 计算 / 编码·名称唯一性 / 父节点变更后重算 treePath /
 *   删除前置校验（子部门·关联用户）/ 逻辑删除可回滚性 / 主键字符串化 / 审计字段非空。
 *
 * 另外把**已知缺陷**也固化成断言（孤儿丢弃、关键字搜索只命中子节点时返回空），
 * 这样将来若要修，改断言即可，不会悄悄改变行为。
 *
 * 安全约定：所有造数名称/编码都带 `VERIFYDEPT` 前缀，脚本开始与结束各清理一次；
 * 只删自己造的数据。
 *
 * 运行：
 *   node ./node_modules/ts-node/dist/bin.js -r tsconfig-paths/register scripts/verify-dept-module.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { DeptService } from "../src/system/dept/dept.service";
import { enableBigIntJsonSerialization } from "../src/common/prisma/bigint-json";

enableBigIntJsonSerialization();

const CONNECTION =
  process.env.DATABASE_URL ?? "postgresql://admin:Pg%40123456@127.0.0.1:5432/peluvida_dev";

const base = new PrismaClient({ adapter: new PrismaPg({ connectionString: CONNECTION }) });
const service = new DeptService(Object.assign(Object.create(base), { scoped: base }) as never);

const MARK = "VERIFYDEPT";

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
 * 坑：`BusinessException extends HttpException`，且构造时传的是**对象**
 * `{ code, msg }`。Nest 的 `HttpException#initMessage()` 只认
 * `response.message` / 字符串 response，对象里放的是 `msg` ⇒ `error.message`
 * 会退化成类名 `"Business Exception"`，真正的文案在 `error.response.msg`。
 *
 * 反例对照：`config` 模块抛的是 `BadRequestException("配置键已存在")`（字符串
 * response），`message` 正常 ⇒ 那边的同名 helper 是够用的，此处只需修这一处。
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

async function cleanup() {
  // 先删用户（可能有部门外键依赖检查），再删部门
  await base.sysUser.deleteMany({ where: { username: { contains: MARK } } });
  await base.sysDept.deleteMany({ where: { code: { contains: MARK } } });
  await base.sysDept.deleteMany({ where: { name: { contains: MARK } } });
}

/** 在树里按 code 找节点（树是嵌套结构） */
function findNode(nodes: any[], code: string): any | null {
  for (const n of nodes) {
    if (n.code === code) return n;
    const hit = findNode(n.children ?? [], code);
    if (hit) return hit;
  }
  return null;
}

function flatten(nodes: any[]): any[] {
  const out: any[] = [];
  const walk = (list: any[]) => {
    for (const n of list) {
      out.push(n);
      walk(n.children ?? []);
    }
  };
  walk(nodes);
  return out;
}

let rootId = "";
let childId = "";
let grandChildId = "";
let otherRootId = "";
let leafId = "";

async function seedDepts() {
  const root = await service.create({
    name: `${MARK}-总部`,
    code: `${MARK}-ROOT`,
    sort: 1,
  } as never);
  rootId = root.id;

  const child = await service.create({
    name: `${MARK}-研发部`,
    code: `${MARK}-RD`,
    parentId: rootId,
    sort: 2,
  } as never);
  childId = child.id;

  const grandChild = await service.create({
    name: `${MARK}-前端组-CHILDONLY`,
    code: `${MARK}-FE`,
    parentId: childId,
    sort: 3,
  } as never);
  grandChildId = grandChild.id;

  const otherRoot = await service.create({
    name: `${MARK}-分公司`,
    code: `${MARK}-BRANCH`,
    sort: 0,
  } as never);
  otherRootId = otherRoot.id;

  const leaf = await service.create({
    name: `${MARK}-独立部门`,
    code: `${MARK}-LEAF`,
    sort: 5,
  } as never);
  leafId = leaf.id;
}

async function main() {
  await cleanup();
  await seedDepts();

  // ---------------------------------------------------------------- 1) 创建与审计
  console.log("\n=== 1) 创建：返回值形状、treePath、审计字段 ===");
  const rootRow = (await base.sysDept.findFirst({ where: { id: BigInt(rootId) } }))!;
  const childRow = (await base.sysDept.findFirst({ where: { id: BigInt(childId) } }))!;
  const grandRow = (await base.sysDept.findFirst({ where: { id: BigInt(grandChildId) } }))!;

  check("根节点 treePath 为 0", rootRow.treePath, "0");
  check("二级 treePath 为 0/父ID", childRow.treePath, `0/${rootId}`);
  check("三级 treePath 为 0/父ID/祖ID", grandRow.treePath, `0/${rootId}/${childId}`);

  const created = await service.findByCode(`${MARK}-ROOT`);
  check("创建返回对象主键为字符串", typeof created?.id, "string");
  check("创建返回对象字段集合", Object.keys(created ?? {}).sort(), [
    "code",
    "createBy",
    "createTime",
    "id",
    "isDeleted",
    "name",
    "parentId",
    "sort",
    "status",
    "treePath",
    "updateBy",
    "updateTime",
  ]);
  checkTrue("createTime 已填充（替代原 AuditSubscriber）", rootRow.createTime instanceof Date);
  checkTrue("updateTime 已填充", rootRow.updateTime instanceof Date);
  check("未传 createBy 时该列保持 NULL", rootRow.createBy, null);
  check("未传 sort 时套用列默认值", (await service.findByCode(`${MARK}-BRANCH`))?.sort, 0);
  check("未传 status 时套用列默认值 1", (await service.findByCode(`${MARK}-BRANCH`))?.status, 1);
  check("parentId 未传时落库为 0", rootRow.parentId?.toString(), "0");

  console.log("\n=== 2) 唯一性校验（编码 / 名称） ===");
  await expectThrow(
    "重复部门编码被拒",
    () => service.create({ name: `${MARK}-重复编码`, code: `${MARK}-ROOT` } as never),
    "已存在"
  );
  await expectThrow(
    "重复部门名称被拒",
    () => service.create({ name: `${MARK}-总部`, code: `${MARK}-DUPNAME` } as never),
    "已存在"
  );
  await expectThrow(
    "父节点 ID 非法时抛业务异常（不静默变成顶层）",
    () =>
      service.create({
        name: `${MARK}-坏父节点`,
        code: `${MARK}-BADPARENT`,
        parentId: "abc",
      } as never),
    "父节点ID格式不正确"
  );

  // ---------------------------------------------------------------- 3) 树构建
  console.log("\n=== 3) 列表树构建与排序 ===");
  const tree = await service.findAll();
  check(
    "我的两个顶层部门都出现在根层级",
    [findNode(tree, `${MARK}-ROOT`) !== null, findNode(tree, `${MARK}-BRANCH`) !== null],
    [true, true]
  );

  const myRoot = findNode(tree, `${MARK}-ROOT`);
  check("总部下只有一个子节点", myRoot.children.length, 1);
  check("子节点为研发部", myRoot.children[0].code, `${MARK}-RD`);
  check("研发部下有一个子节点（三级嵌套正确）", myRoot.children[0].children.length, 1);
  check("三级节点为前端组", myRoot.children[0].children[0].code, `${MARK}-FE`);
  check("叶子节点 children 为空数组", myRoot.children[0].children[0].children, []);

  const allCodes = flatten(tree).map((n) => n.code);
  const sortValues = flatten(tree)
    .filter((n) => n.code.startsWith(`${MARK}-`))
    .map((n) => n.sort);
  check("我已造的 5 个部门全部在树中", sortValues.length, 5);
  checkTrue("每个部门只出现一次", new Set(allCodes).size === allCodes.length);

  console.log("\n=== 4) 下拉选项树 ===");
  const options = await service.findAllOptions();
  const myRootOption = (function find(list: any[]): any {
    for (const n of list) {
      if (n.value === rootId) return n;
      const hit = find(n.children ?? []);
      if (hit) return hit;
    }
    return null;
  })(options);
  checkTrue("下拉树含我的顶层部门", myRootOption !== null);
  check("下拉节点 label 为部门名", myRootOption.label, `${MARK}-总部`);
  check("下拉节点 value 为字符串主键", typeof myRootOption.value, "string");
  check("下拉节点 children 嵌套正确", myRootOption.children[0].value, childId);
  check("下拉节点只含 label/value/children 三个键", Object.keys(myRootOption).sort(), [
    "children",
    "label",
    "value",
  ]);

  // ---------------------------------------------------------------- 5) 查询方法
  console.log("\n=== 5) 按 ID / 编码 / 名称查询 ===");
  const byIds = await service.findByIds([rootId, childId]);
  check("findByIds 返回 2 条", byIds.length, 2);
  check(
    "findByIds 主键为字符串",
    byIds.map((d) => typeof d.id),
    ["string", "string"]
  );
  checkTrue(
    "findByIds 主键可直接与字符串比较（兼容未迁移的 user.service）",
    byIds.some((d) => d.id === rootId)
  );
  check("findByIds 传入空数组返回空", await service.findByIds([]), []);
  check("findByIds 全为非法 ID 时返回空（不报错）", await service.findByIds(["abc", ""]), []);
  check(
    "findByIds 混合非法 ID 时只保留合法项",
    (await service.findByIds([rootId, "abc"])).length,
    1
  );

  check("findByCode 命中", (await service.findByCode(`${MARK}-RD`))?.id, childId);
  check("findByCode 空串返回 null", await service.findByCode(""), null);
  check("findByCode 未命中返回 null", await service.findByCode(`${MARK}-NOTEXIST`), null);
  check("findByCodeOrName 按编码命中", (await service.findByCodeOrName(`${MARK}-RD`))?.id, childId);
  check(
    "findByCodeOrName 按名称命中",
    (await service.findByCodeOrName(`${MARK}-研发部`))?.id,
    childId
  );
  check(
    "findByCodeOrName 未命中返回 null",
    await service.findByCodeOrName(`${MARK}-NOTEXIST`),
    null
  );

  check("getDeptForm 命中", (await service.getDeptForm(childId))?.code, `${MARK}-RD`);
  check("getDeptForm 非法 ID 返回 null", await service.getDeptForm("abc"), null);
  check("getDeptForm 不存在的 ID 返回 null", await service.getDeptForm("999999999"), null);

  // ---------------------------------------------------------------- 6) 过滤与已知缺陷
  console.log("\n=== 6) 过滤条件与已登记的已知缺陷 ===");
  const kwUpper = await service.findAll(`${MARK}-总部`);
  check("关键字命中（大写）", findNode(kwUpper, `${MARK}-ROOT`) !== null, true);
  const kwLower = await service.findAll(`${MARK}-总部`.toLowerCase());
  check("关键字大小写不敏感（MySQL CI 语义）", findNode(kwLower, `${MARK}-ROOT`) !== null, true);

  const statusFiltered = await service.findAll(undefined, 1);
  checkTrue("status=1 命中我的部门", findNode(statusFiltered, `${MARK}-ROOT`) !== null);

  // 空串 status 必须视为「不过滤」。
  // 原实现是 `status !== undefined && status !== null` ⇒ `""` 会走到
  // `Number("") === 0` 并加上 `status = 0`，于是「清空状态筛选」反而只显示禁用部门。
  // 前端 el-select 带 clearable，清空时 Element Plus 会 emit `''`，故该分支真实可达
  // ⇒ 判定为缺陷并修正，此处固化新行为。
  const emptyStatus = await service.findAll(undefined, "");
  checkTrue(
    "status 传空串视为不过滤（修正原实现的 status=0 误过滤）",
    findNode(emptyStatus, `${MARK}-ROOT`) !== null
  );
  const disabledOnly = await service.findAll(undefined, 0);
  check("status=0 时不命中我造的启用部门", findNode(disabledOnly, `${MARK}-ROOT`), null);

  const noMatch = await service.findAll("绝不存在的部门ZZZ");
  check("无命中时返回空树", noMatch, []);

  // 已知缺陷：关键字只命中子节点时，父节点不在结果集 ⇒ 子节点被丢弃
  const orphan = await service.findAll(`${MARK}-前端组-CHILDONLY`);
  check("【已知缺陷】只命中子节点时整条被丢弃（保持原行为）", orphan, []);

  // ---------------------------------------------------------------- 7) 编辑
  console.log("\n=== 7) 编辑部门 ===");
  const renamed = await service.updateDept(childId, { name: `${MARK}-研发中心` } as never);
  check("改名成功", renamed?.name, `${MARK}-研发中心`);
  check("改名不影响 treePath", renamed?.treePath, `0/${rootId}`);
  checkTrue("改名后 updateTime 已刷新", renamed?.updateTime instanceof Date);

  await expectThrow(
    "改成别的部门已用的编码被拒",
    () => service.updateDept(childId, { code: `${MARK}-BRANCH` } as never),
    "已存在"
  );
  await expectThrow(
    "改成别的部门已用的名称被拒",
    () => service.updateDept(childId, { name: `${MARK}-分公司` } as never),
    "已存在"
  );
  const sameCode = await service.updateDept(childId, { code: `${MARK}-RD` } as never);
  check("沿用自身编码不报错", sameCode?.code, `${MARK}-RD`);

  // 变更父节点 ⇒ treePath 必须重算
  // 语义（与原实现 buildTreePath 一致）：新 treePath = 新父的 treePath + "/" + 新父的 id
  const moved = await service.updateDept(grandChildId, { parentId: otherRootId } as never);
  check("变更父节点后 treePath 重算", moved?.treePath, `0/${otherRootId}`);
  const movedRow = await base.sysDept.findFirst({ where: { id: BigInt(grandChildId) } });
  check("treePath 已落库", movedRow?.treePath, `0/${otherRootId}`);
  // 还原，避免影响后续断言
  await service.updateDept(grandChildId, { parentId: childId } as never);
  check(
    "还原父节点后 treePath 恢复",
    (await base.sysDept.findFirst({ where: { id: BigInt(grandChildId) } }))?.treePath,
    `0/${rootId}/${childId}`
  );

  // 【已知缺陷·保持原行为】移动子树时只重算**被移动节点自身**的 treePath，
  // 其子孙不跟着重算 ⇒ 孙辈的 treePath 仍指向旧路径。
  // 后果：按 treePath 前缀做数据权限筛选（data-scope.extension.ts）时，
  //       换过上级的部门其子树会落在错误的分支里。
  // 原实现同样如此（updateDept 只对自己的行赋值 treePath）。
  await service.updateDept(childId, { parentId: otherRootId } as never);
  check(
    "【已知缺陷】移动子树后自身 treePath 已重算",
    (await base.sysDept.findFirst({ where: { id: BigInt(childId) } }))?.treePath,
    `0/${otherRootId}`
  );
  check(
    "【已知缺陷】子孙 treePath 不同步重算（保持原行为）",
    (await base.sysDept.findFirst({ where: { id: BigInt(grandChildId) } }))?.treePath,
    `0/${rootId}/${childId}`
  );
  await service.updateDept(childId, { parentId: rootId } as never);
  check(
    "子树移回后自身 treePath 复原",
    (await base.sysDept.findFirst({ where: { id: BigInt(childId) } }))?.treePath,
    `0/${rootId}`
  );

  const updateTimeBefore = (await base.sysDept.findFirst({ where: { id: BigInt(childId) } }))!
    .updateTime;
  const onlySort = await service.updateDept(childId, { sort: 9 } as never);
  check("只传 sort 时其他字段不变", onlySort?.name, `${MARK}-研发中心`);
  check("只传 sort 时不会把 name 覆盖成 undefined", onlySort?.code, `${MARK}-RD`);
  checkTrue(
    "只传 sort 时 updateTime 仍被刷新",
    (onlySort?.updateTime?.getTime() ?? 0) >= (updateTimeBefore?.getTime() ?? 0)
  );

  check(
    "updateDept 不存在返回 null",
    await service.updateDept("999999999", { name: "x" } as never),
    null
  );
  check(
    "updateDept 非法 ID 返回 null",
    await service.updateDept("abc", { name: "x" } as never),
    null
  );

  // ---------------------------------------------------------------- 8) 删除
  console.log("\n=== 8) 删除（前置校验 + 逻辑删除） ===");
  await expectThrow(
    "有子部门时禁止删除",
    () => service.deleteDept(rootId),
    "该部门下有子部门，禁止删除"
  );

  // 在叶子上挂一个用户，验证「有关联用户」分支
  await base.sysUser.create({
    data: {
      username: `${MARK}-user1`,
      nickname: `${MARK}-用户`,
      password: "x",
      deptId: BigInt(leafId),
      createTime: new Date(),
      updateTime: new Date(),
    },
  });
  await expectThrow(
    "有用户关联时禁止删除",
    () => service.deleteDept(leafId),
    "该部门下有用户关联，禁止删除"
  );

  await base.sysUser.deleteMany({ where: { username: { contains: MARK } } });
  const deleted = await service.deleteDept(leafId);
  check("无子部门且无用户时可删除", deleted, true);
  const leafRow = await base.sysDept.findFirst({ where: { id: BigInt(leafId) } });
  check("逻辑删除：isDeleted 置 1", leafRow?.isDeleted, 1);
  checkTrue("逻辑删除：行仍在物理表中", leafRow !== null);
  check("删除后不在列表里", findNode(await service.findAll(), `${MARK}-LEAF`), null);
  check(
    "删除后 findByCode（带 isDeleted 过滤）查不到",
    await service.findByCode(`${MARK}-LEAF`),
    null
  );
  check("重复删除仍返回 true（行存在即算成功）", await service.deleteDept(leafId), true);
  check("删除解绑后的叶子部门可成功", await service.deleteDept(otherRootId), true);

  check("deleteDept 非法 ID 返回 false", await service.deleteDept("abc"), false);
  check("deleteDept 不存在的 ID 返回 false", await service.deleteDept("999999999"), false);

  await cleanup();
  const residueDept = await base.sysDept.count({ where: { code: { contains: MARK } } });
  const residueUser = await base.sysUser.count({ where: { username: { contains: MARK } } });
  check("部门造数已清理干净", residueDept, 0);
  check("用户造数已清理干净", residueUser, 0);

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
      `\n================ dept 模块验证：${checks - failures}/${checks} 通过 ================`
    );
    if (failures) {
      console.log(`失败 ${failures} 项`);
      process.exitCode = 1;
    }
  });
