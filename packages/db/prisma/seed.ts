/**
 * PeluVida OS 种子数据（CROSS-19 系统域 + P0-03-01 演示租户）
 *
 * 范围：系统域最小可登录集（部门 / ROOT 角色 / admin / 关联）
 * + 演示租户（demo，plan=professional）+ 租户管理员账号（tenant_admin，
 * sys_user.tenant_id 已回填——验证 JWT tenantId 端到端链路）
 * + 业务域演示数据（步骤 8：门店 / 服务类目 / 房间 / 员工，P0-04，归属演示租户）。
 *
 * 幂等策略：
 *  - 均按业务唯一键（code / username / 租户内业务键）查在先、缺则建；
 *  - **admin / tenant_admin 已存在时跳过（不覆盖密码 / 昵称等），保护真实环境已改密账号**；
 *  - 业务域四表 id 为 uuid 库层生成，查重只用业务唯一键（store (tenant,code)、
 *    category (tenant,store,parent,name)、room (tenant,store,room_no)、
 *    staff (tenant,store,mobile)），含 NULL 列的组合唯一用 findFirst（PG 对 NULL 不去重，upsert 不可用）；
 *  - 可重复执行，输出每次的「已存在 / 新建」结果。
 *
 * 口径对齐（移植铁律 6：跟随现行行为，不顺手修）：
 *  - DeptService.buildTreePath 现行 treePath 为**斜杠分隔**（根 = "0"），种子同口径；
 *  - 数据权限 dataScope=1 = DataScopeEnum.ALL（全部数据）；
 *  - isDeleted：0 = 未删（系统域旧口径）；
 *  - status：1 = 正常，0 = 冻结（auth.login 以 status===0 判冻结）；
 *    tenant 表 deletedAt：NULL = 未删（业务新表口径）。
 *
 * 运行（从 niulai-nest 发起，复用其 node_modules 与 tsconfig）：
 *   cd niulai-nest && pnpm db:seed
 *   # 等价：node ./node_modules/ts-node/dist/bin.js --transpile-only ../packages/db/prisma/seed.ts
 *
 * 演示账号：admin / 123456（平台）、tenant_admin / 123456（租户）
 */
import * as bcrypt from "bcrypt";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

// ── 环境加载：与 niulai-nest/prisma.config.ts 同源（先 .env 后 .env.<NODE_ENV||dev>）──
// 本文件位于 <仓库根>/packages/db/prisma/，后端根是**兄弟目录** niulai-nest（非祖先），
// 故向上找「含 niulai-nest/src/main.ts 的仓库根」，再拼出后端根。
function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, "niulai-nest", "src", "main.ts"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

function loadEnvFile(root: string, fileName: string): void {
  const file = path.join(root, fileName);
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const REPO_ROOT = findRepoRoot(__dirname);
const BACKEND_ROOT = path.join(REPO_ROOT, "niulai-nest");
loadEnvFile(BACKEND_ROOT, ".env");
loadEnvFile(BACKEND_ROOT, `.env.${process.env.NODE_ENV || "dev"}`);

const c = (k: string, d = ""): string => process.env[k] ?? d;
const connectionString =
  process.env.DATABASE_URL ||
  `postgresql://${c("PG_USER", "postgres")}:${encodeURIComponent(c("PG_PASSWORD"))}` +
    `@${c("PG_HOST", "localhost")}:${c("PG_PORT", "5432")}/${c("PG_DB", "peluvida_dev")}`;

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
  log: [
    { emit: "stdout", level: "warn" },
    { emit: "stdout", level: "error" },
  ],
});

async function main(): Promise<void> {
  console.log("[seed] 目标库：", connectionString.replace(/:[^:@/]+@/, ":***@"));

  // 1. 部门：总部（根节点，treePath="0"，斜杠口径跟随 DeptService.buildTreePath）
  let hq = await prisma.sysDept.findFirst({ where: { code: "HQ", isDeleted: 0 } });
  if (hq) {
    console.log(`[seed] 部门「总部」已存在（id=${hq.id}），跳过`);
  } else {
    hq = await prisma.sysDept.create({
      data: {
        name: "总部",
        code: "HQ",
        parentId: null,
        treePath: "0",
        sort: 1,
        status: 1,
        isDeleted: 0,
      },
    });
    console.log(`[seed] 部门「总部」已创建（id=${hq.id}）`);
  }

  // 2. ROOT 角色（dataScope=1 = ALL 全部数据）
  let rootRole = await prisma.sysRole.findFirst({ where: { code: "ROOT", isDeleted: 0 } });
  if (rootRole) {
    console.log(`[seed] 角色「超级管理员」已存在（id=${rootRole.id}），跳过`);
  } else {
    rootRole = await prisma.sysRole.create({
      data: {
        name: "超级管理员",
        code: "ROOT",
        sort: 1,
        status: 1,
        dataScope: 1,
        isDeleted: 0,
      },
    });
    console.log(`[seed] 角色「超级管理员」已创建（id=${rootRole.id}）`);
  }

  // 3. admin 演示账号（存在则跳过 —— 不覆盖已改密的真实账号）
  const existedUser = await prisma.sysUser.findFirst({
    where: { username: "admin", isDeleted: 0 },
  });
  if (existedUser) {
    console.log(`[seed] 用户「admin」已存在（id=${existedUser.id}），跳过（不覆盖密码）`);
  } else {
    const hash = await bcrypt.hash("123456", 10);
    const user = await prisma.sysUser.create({
      data: {
        username: "admin",
        nickname: "超级管理员",
        gender: 1,
        password: hash,
        deptId: hq.id,
        status: 1,
        isDeleted: 0,
      },
    });
    console.log(`[seed] 用户「admin」已创建（id=${user.id}）`);
  }

  // 4. 用户-角色关联（幂等 upsert）
  const admin = await prisma.sysUser.findFirstOrThrow({
    where: { username: "admin", isDeleted: 0 },
  });
  await prisma.sysUserRole.upsert({
    where: {
      userId_roleId: { userId: admin.id, roleId: rootRole.id },
    },
    update: {},
    create: { userId: admin.id, roleId: rootRole.id },
  });
  console.log(`[seed] 关联 admin(${admin.id}) ↔ ROOT(${rootRole.id}) 完成`);

  // 5. 演示租户（P0-03-01）：plan=professional，feature_flags 为 Professional 预设
  //    （键集与 @peluvida/shared TENANT_PLAN_PRESETS 一致；seed 内联不引 shared，
  //     键一致性由 shared 的 tenant-capability.test.cjs 保证）
  const PRO_FLAGS = { foster: true, member: true, marketing: true };
  let demoTenant = await prisma.tenant.findFirst({ where: { code: "demo", deletedAt: null } });
  if (demoTenant) {
    console.log(`[seed] 租户「演示租户」已存在（id=${demoTenant.id}），跳过`);
  } else {
    demoTenant = await prisma.tenant.create({
      data: {
        name: "演示租户",
        code: "demo",
        status: 1,
        plan: "professional",
        featureFlags: PRO_FLAGS,
      },
    });
    console.log(`[seed] 租户「演示租户」已创建（id=${demoTenant.id}，plan=professional）`);
  }

  // 6. 租户管理员账号（sys_user.tenant_id 回填验证数据）：tenant_admin / 123456
  const tenantUser = await prisma.sysUser.findFirst({
    where: { username: "tenant_admin", isDeleted: 0 },
  });
  if (tenantUser) {
    console.log(`[seed] 用户「tenant_admin」已存在（id=${tenantUser.id}），跳过`);
  } else {
    const hash = await bcrypt.hash("123456", 10);
    const created = await prisma.sysUser.create({
      data: {
        username: "tenant_admin",
        nickname: "演示租户管理员",
        gender: 1,
        password: hash,
        deptId: hq.id,
        tenantId: demoTenant.id,
        status: 1,
        isDeleted: 0,
      },
    });
    console.log(
      `[seed] 用户「tenant_admin」已创建（id=${created.id}，tenant_id=${demoTenant.id}）`
    );
  }

  // 7. 租户管理员 ↔ ROOT 角色关联（dataScope=ALL；租户内数据可见性由 RLS 收敛）
  const tenantAdmin = await prisma.sysUser.findFirstOrThrow({
    where: { username: "tenant_admin", isDeleted: 0 },
  });
  await prisma.sysUserRole.upsert({
    where: {
      userId_roleId: { userId: tenantAdmin.id, roleId: rootRole.id },
    },
    update: {},
    create: { userId: tenantAdmin.id, roleId: rootRole.id },
  });
  console.log(`[seed] 关联 tenant_admin(${tenantAdmin.id}) ↔ ROOT(${rootRole.id}) 完成`);

  // ─────────────────────────────────────────────
  // 8. 业务域演示数据（P0-04：门店 / 服务类目 / 房间 / 员工，归属演示租户 demo）
  // ─────────────────────────────────────────────
  // 幂等键均为业务唯一键（四表 id 是 uuid 库层生成，不能用 id 查重）：
  //   store (tenant_id, code) / service_category (tenant_id, store_id, parent_id, name)
  //   room (tenant_id, store_id, room_no) / staff (tenant_id, store_id, mobile)
  // created_by / updated_by 统一记 tenant_admin（演示租户管理员）。
  const bizTenantId = demoTenant.id;
  const auditBy = tenantAdmin.id;

  // 8.1 门店 ×2：总部店（code=hq，直营，含营业时段与配置示例）+ 分店（code=branch01，加盟）
  //     经纬度 Decimal(10,7)/(9,7) 传字符串，避免 JS 浮点精度进库
  const BUSINESS_HOURS_ALL_WEEK = {
    mon: [["09:00", "21:00"]],
    tue: [["09:00", "21:00"]],
    wed: [["09:00", "21:00"]],
    thu: [["09:00", "21:00"]],
    fri: [["09:00", "21:00"]],
    sat: [["09:00", "22:00"]],
    sun: [["09:00", "22:00"]],
  };
  // 门店级配置覆盖示例（FR-4：时段粒度/预约提前量/取消截止/寄养出入住时间窗/推送开关；
  // 键名为应用层草案口径，待 StoreConfig 配置模块定稿后对齐）
  const HQ_STORE_CONFIG = {
    slot_granularity_minutes: 30,
    booking_advance_days: 7,
    cancel_deadline_hours: 2,
    foster_checkin_window: ["09:00", "18:00"],
    foster_checkout_window: ["09:00", "18:00"],
    push_enabled: true,
  };

  let hqStore = await prisma.store.findFirst({
    where: { tenantId: bizTenantId, code: "hq", deletedAt: null },
  });
  if (hqStore) {
    console.log(`[seed] 门店「hq 总部店」已存在（id=${hqStore.id}），跳过`);
  } else {
    hqStore = await prisma.store.create({
      data: {
        tenantId: bizTenantId,
        code: "hq",
        name: "PeluVida 演示总部店",
        type: 1, // 1 直营
        province: "浙江省",
        city: "杭州市",
        district: "西湖区",
        address: "文三路 100 号宠物生活广场 1F",
        longitude: "120.1303960",
        latitude: "30.2590420",
        phone: "057188001001",
        businessHours: BUSINESS_HOURS_ALL_WEEK,
        config: HQ_STORE_CONFIG,
        status: 1, // 1 启用
        createdBy: auditBy,
        updatedBy: auditBy,
      },
    });
    console.log(`[seed] 门店「hq 总部店」已创建（id=${hqStore.id}）`);
  }

  let branchStore = await prisma.store.findFirst({
    where: { tenantId: bizTenantId, code: "branch01", deletedAt: null },
  });
  if (branchStore) {
    console.log(`[seed] 门店「branch01 分店」已存在（id=${branchStore.id}），跳过`);
  } else {
    branchStore = await prisma.store.create({
      data: {
        tenantId: bizTenantId,
        code: "branch01",
        name: "PeluVida 演示滨江分店",
        type: 2, // 2 加盟
        province: "浙江省",
        city: "杭州市",
        district: "滨江区",
        address: "江南大道 200 号滨江宝龙城 2F",
        longitude: "120.0853100",
        latitude: "30.2175610",
        phone: "057188001002",
        businessHours: BUSINESS_HOURS_ALL_WEEK,
        config: null, // 门店未覆盖 = 继承总部下发配置（FR-4 层级口径）
        status: 1,
        createdBy: auditBy,
        updatedBy: auditBy,
      },
    });
    console.log(`[seed] 门店「branch01 分店」已创建（id=${branchStore.id}）`);
  }

  // 8.2 服务类目 ×4（两级树）：主路径为租户级目录（store_id=NULL，总部统一管控，
  //     schema 注释明确口径）；cat_type 两级都填（二级填所属大类）。
  //     注意：唯一约束 (tenant_id, store_id, parent_id, name) 含可空列，
  //     PG 对 NULL 不去重，故根类目查重必须用 findFirst 业务查询（不能用 upsert）。
  let catGroom = await prisma.serviceCategory.findFirst({
    where: {
      tenantId: bizTenantId,
      storeId: null,
      parentId: null,
      name: "洗护美容",
      deletedAt: null,
    },
  });
  if (catGroom) {
    console.log(`[seed] 类目「洗护美容」已存在（id=${catGroom.id}），跳过`);
  } else {
    catGroom = await prisma.serviceCategory.create({
      data: {
        tenantId: bizTenantId,
        storeId: null,
        parentId: null,
        name: "洗护美容",
        catType: 1, // 1 洗护（PRD 十大类，两级都填）
        sort: 1,
        status: 1,
        createdBy: auditBy,
        updatedBy: auditBy,
      },
    });
    console.log(`[seed] 类目「洗护美容」已创建（id=${catGroom.id}）`);
  }

  let catFoster = await prisma.serviceCategory.findFirst({
    where: { tenantId: bizTenantId, storeId: null, parentId: null, name: "寄养", deletedAt: null },
  });
  if (catFoster) {
    console.log(`[seed] 类目「寄养」已存在（id=${catFoster.id}），跳过`);
  } else {
    catFoster = await prisma.serviceCategory.create({
      data: {
        tenantId: bizTenantId,
        storeId: null,
        parentId: null,
        name: "寄养",
        catType: 3, // 3 寄养
        sort: 2,
        status: 1,
        createdBy: auditBy,
        updatedBy: auditBy,
      },
    });
    console.log(`[seed] 类目「寄养」已创建（id=${catFoster.id}）`);
  }

  // 二级类目：挂「寄养」下（parent_id = 一级 uuid；storeId 同父级口径 = NULL）
  const childCategories = [
    { name: "狗狗寄养", sort: 1 },
    { name: "猫咪寄养", sort: 2 },
  ];
  for (const item of childCategories) {
    const existed = await prisma.serviceCategory.findFirst({
      where: {
        tenantId: bizTenantId,
        storeId: null,
        parentId: catFoster.id,
        name: item.name,
        deletedAt: null,
      },
    });
    if (existed) {
      console.log(`[seed] 类目「${item.name}」已存在（id=${existed.id}），跳过`);
      continue;
    }
    const created = await prisma.serviceCategory.create({
      data: {
        tenantId: bizTenantId,
        storeId: null,
        parentId: catFoster.id,
        name: item.name,
        catType: 3, // 二级填所属大类：寄养
        sort: item.sort,
        status: 1,
        createdBy: auditBy,
        updatedBy: auditBy,
      },
    });
    console.log(`[seed] 类目「${item.name}」已创建（id=${created.id}，parent=${catFoster.id}）`);
  }

  // 二级类目：挂「洗护美容」下 —— 这些叶子即**预约创建表单可选的服务项**
  //   （PRD《服务管理》FR-1「两级树，叶子挂服务项」；`service_item` 表属服务管理
  //   模块尚未建模，故 MVP-WEB-06-02 以**叶子类目**承载服务项语义，
  //   见 booking.service.ts 的语义裁决注释与 BookingServiceItemOption 文档）。
  //   幂等键同上一段：(tenant_id, store_id=NULL, parent_id, name) ——
  //   PG 对 NULL 列不去重，故仍走 findFirst 业务查重而非 upsert。
  const groomLeafCategories = [
    { name: "洗澡（小型犬）", sort: 1 },
    { name: "洗澡（中大型犬）", sort: 2 },
    { name: "猫咪洗护", sort: 3 },
    { name: "指甲修剪", sort: 4 },
  ];
  for (const item of groomLeafCategories) {
    const existed = await prisma.serviceCategory.findFirst({
      where: {
        tenantId: bizTenantId,
        storeId: null,
        parentId: catGroom.id,
        name: item.name,
        deletedAt: null,
      },
    });
    if (existed) {
      console.log(`[seed] 类目「${item.name}」已存在（id=${existed.id}），跳过`);
      continue;
    }
    const created = await prisma.serviceCategory.create({
      data: {
        tenantId: bizTenantId,
        storeId: null,
        parentId: catGroom.id,
        name: item.name,
        catType: 1, // 二级填所属大类：洗护
        sort: item.sort,
        status: 1,
        createdBy: auditBy,
        updatedBy: auditBy,
      },
    });
    console.log(`[seed] 类目「${item.name}」已创建（id=${created.id}，parent=${catGroom.id}）`);
  }

  // 8.3 房间 ×6（总部店）：覆盖全部房型枚举 roomType 1~6
  //     （1 笼位 kennel / 2 独立房 suite / 3 猫房 cat / 4 狗房 dog / 5 VIP / 6 多宠房）；
  //     房态 status 1 空闲为主，留 1 间 4=维护中（人工维护态）做看板展示。
  const demoRooms = [
    {
      roomNo: "K01",
      name: "小型犬笼位",
      roomType: 1,
      capacity: 1,
      allowPetSize: [{ min_kg: 0, max_kg: 10 }],
      status: 1,
    },
    {
      roomNo: "S01",
      name: "独立套房",
      roomType: 2,
      capacity: 1,
      allowPetSize: [{ min_kg: 0, max_kg: 40 }],
      status: 1,
    },
    {
      roomNo: "C01",
      name: "猫咪房",
      roomType: 3,
      capacity: 2,
      allowPetSize: [{ min_kg: 0, max_kg: 8 }],
      status: 1,
    },
    {
      roomNo: "D01",
      name: "大型犬房",
      roomType: 4,
      capacity: 2,
      allowPetSize: [{ min_kg: 10, max_kg: 40 }],
      status: 1,
    },
    {
      roomNo: "V01",
      name: "VIP 房",
      roomType: 5,
      capacity: 1,
      allowPetSize: [{ min_kg: 0, max_kg: 40 }],
      status: 1,
    },
    {
      roomNo: "M01",
      name: "多宠房",
      roomType: 6,
      capacity: 4,
      allowPetSize: [{ min_kg: 0, max_kg: 20 }],
      status: 4,
    },
  ];
  for (const room of demoRooms) {
    const existed = await prisma.room.findFirst({
      where: { tenantId: bizTenantId, storeId: hqStore.id, roomNo: room.roomNo, deletedAt: null },
    });
    if (existed) {
      console.log(`[seed] 房间「${room.roomNo}」已存在（id=${existed.id}），跳过`);
      continue;
    }
    const created = await prisma.room.create({
      data: {
        tenantId: bizTenantId,
        storeId: hqStore.id,
        name: room.name,
        roomNo: room.roomNo,
        roomType: room.roomType,
        capacity: room.capacity,
        allowPetSize: room.allowPetSize,
        status: room.status,
        createdBy: auditBy,
        updatedBy: auditBy,
      },
    });
    console.log(
      `[seed] 房间「${room.roomNo}」已创建（id=${created.id}，roomType=${room.roomType}）`
    );
  }

  // 8.4 员工 ×3（总部店）：店长关联 tenant_admin 后台账号（sys_user_id 复用口径），
  //     其余 NULL = 未开通后台账号；joinedAt 用本地午间构造，避免 DATE 列时区漂移。
  //     手机号为演示造数，唯一约束 (tenant_id, store_id, mobile) 保证幂等。
  const demoStaff = [
    {
      name: "陈店长",
      mobile: "13800001001",
      jobRole: 1,
      roles: ["manager"],
      sysUserId: tenantAdmin.id,
      joined: new Date(2025, 2, 1, 12, 0, 0),
    },
    {
      name: "林美容师",
      mobile: "13800001002",
      jobRole: 2,
      roles: ["groomer"],
      sysUserId: null,
      joined: new Date(2025, 5, 15, 12, 0, 0),
    },
    {
      name: "王寄养员",
      mobile: "13800001003",
      jobRole: 4,
      roles: ["boarder"],
      sysUserId: null,
      joined: new Date(2025, 8, 1, 12, 0, 0),
    },
  ];
  for (const staff of demoStaff) {
    const existed = await prisma.staff.findFirst({
      where: { tenantId: bizTenantId, storeId: hqStore.id, mobile: staff.mobile, deletedAt: null },
    });
    if (existed) {
      console.log(`[seed] 员工「${staff.name}」已存在（id=${existed.id}），跳过`);
      continue;
    }
    const created = await prisma.staff.create({
      data: {
        tenantId: bizTenantId,
        storeId: hqStore.id,
        name: staff.name,
        mobile: staff.mobile,
        idCard: null, // 敏感字段，演示数据不造
        jobRole: staff.jobRole,
        roles: staff.roles,
        sysUserId: staff.sysUserId,
        joinedAt: staff.joined,
        status: 1, // 1 在职
        createdBy: auditBy,
        updatedBy: auditBy,
      },
    });
    console.log(`[seed] 员工「${staff.name}」已创建（id=${created.id}，jobRole=${staff.jobRole}）`);
  }

  // 8.5 萌主档案 ×2（P0-05，归属演示租户）：幂等键 (tenant_id, mobile)
  //     （手机号租户内唯一，部分唯一索引 uk_customer_tenant_mobile；软删释放），
  //     created_by / updated_by 记 tenant_admin。
  //     以 mobile 为键留存客户 id，供 8.7 演示宠物挂主人归属。
  const demoCustomers = [
    {
      name: "张小萌",
      mobile: "13800002001",
      gender: 2,
      source: 1,
      storeId: hqStore.id as string,
      remark: "演示租户萌主档案（总部店）",
    },
    {
      name: "李阿福",
      mobile: "13800002002",
      gender: 1,
      source: 4,
      storeId: null,
      remark: "演示租户萌主档案（租户级客户）",
    },
  ];
  const customerIdsByMobile = new Map<string, string>();
  for (const customer of demoCustomers) {
    const existed = await prisma.customer.findFirst({
      where: { tenantId: bizTenantId, mobile: customer.mobile, deletedAt: null },
    });
    if (existed) {
      customerIdsByMobile.set(customer.mobile, existed.id);
      console.log(`[seed] 客户「${customer.name}」已存在（id=${existed.id}），跳过`);
      continue;
    }
    const created = await prisma.customer.create({
      data: {
        tenantId: bizTenantId,
        storeId: customer.storeId,
        name: customer.name,
        mobile: customer.mobile,
        gender: customer.gender,
        source: customer.source,
        remark: customer.remark,
        createdBy: auditBy,
        updatedBy: auditBy,
      },
    });
    customerIdsByMobile.set(customer.mobile, created.id);
    console.log(
      `[seed] 客户「${customer.name}」已创建（id=${created.id}，mobile=${customer.mobile}）`
    );
  }

  // 8.7 宠物档案 ×2（P0-06，归属演示租户）：幂等键 (tenant_id, name, owner_customer_id)
  //     （宠物名无租户内唯一约束，按「名字 + 主人」业务组合查重在先）；
  //     profile_completeness 为演示快照值（与字段填充一致的口径注释在侧），
  //     正式链路由 PetService.calcProfileCompleteness 重算（业务层职责，seed 不引后端代码）。
  const demoPets = [
    {
      customerMobile: "13800002001",
      name: "旺财",
      petType: 1, // 1 犬
      breed: "金毛",
      gender: 1, // 1 公
      birthday: new Date(2022, 2, 1, 12, 0, 0),
      weightKg: "12.50",
      coatColor: "金色",
      sterilized: true,
      chipNo: "CHIP-DEMO-001",
      photoUrl: "https://cdn.peluvida.example/pets/wangcai.jpg",
      remark: "演示宠物（总部店客户张小萌）",
    },
    {
      customerMobile: "13800002002",
      name: "雪球",
      petType: 2, // 2 猫
      breed: "英国短毛猫",
      gender: 2, // 2 母
      birthday: new Date(2023, 6, 15, 12, 0, 0),
      weightKg: "4.20",
      coatColor: "乳白",
      sterilized: false,
      chipNo: null,
      photoUrl: "https://cdn.peluvida.example/pets/xueqiu.jpg",
      remark: "演示宠物（租户级客户李阿福）",
    },
  ];
  for (const pet of demoPets) {
    const ownerCustomerId = customerIdsByMobile.get(pet.customerMobile);
    if (!ownerCustomerId) {
      console.log(`[seed] 宠物「${pet.name}」跳过：主人客户（mobile=${pet.customerMobile}）未找到`);
      continue;
    }
    const existed = await prisma.pet.findFirst({
      where: { tenantId: bizTenantId, name: pet.name, ownerCustomerId, deletedAt: null },
    });
    if (existed) {
      console.log(`[seed] 宠物「${pet.name}」已存在（id=${existed.id}），跳过`);
      continue;
    }
    const created = await prisma.pet.create({
      data: {
        tenantId: bizTenantId,
        ownerCustomerId,
        name: pet.name,
        petType: pet.petType,
        breed: pet.breed,
        gender: pet.gender,
        birthday: pet.birthday,
        weightKg: pet.weightKg,
        coatColor: pet.coatColor,
        sterilized: pet.sterilized,
        chipNo: pet.chipNo,
        photoUrl: pet.photoUrl,
        // 评分按 calcProfileCompleteness 权重口径手工折算：
        //   旺财 = 基础40+生日10+品种8+体重10+照片10+绝育7+芯片7+毛色4 = 96
        //   雪球 = 基础40+生日10+品种8+体重10+照片10+绝育7+毛色4 = 89
        profileCompleteness: pet.name === "旺财" ? 96 : 89,
        remark: pet.remark,
        createdBy: auditBy,
        updatedBy: auditBy,
      },
    });
    console.log(`[seed] 宠物「${pet.name}」已创建（id=${created.id}，主人=${ownerCustomerId}）`);
  }

  // 8.8 宠物健康记录演示数据（P0-06-03 到期提醒 + MVP-WEB-03-01 工作台「需要你处理」数据源）
  //     口径：每只演示宠物按 疫苗 / 驱虫 各落一条，expire_date 以「今天」为基准做相对偏移，
  //     覆盖到期预警三档（high ≤3 天 / medium ≤7 天 / low ≤14 天）；
  //     幂等键 (tenant_id, pet_id, record_type) —— 演示数据每宠物每类型只保留一条。
  //     健康记录为 append-only 语义（业务层不提供改删接口），seed 只在缺失时补写。
  const seedTodayUtc = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate())
  );
  const addUtcDays = (base: Date, days: number) =>
    new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

  const demoHealthRecords = [
    {
      petName: "旺财",
      recordType: 1,
      expireInDays: 3,
      content: "演示数据 · 狂犬疫苗（到期预警 high）",
    },
    {
      petName: "旺财",
      recordType: 2,
      expireInDays: 12,
      content: "演示数据 · 体内驱虫（到期预警 low）",
    },
    {
      petName: "雪球",
      recordType: 2,
      expireInDays: 6,
      content: "演示数据 · 体外驱虫（到期预警 medium）",
    },
  ];

  for (const record of demoHealthRecords) {
    const ownerSeed = demoPets.find((item) => item.name === record.petName);
    const ownerCustomerId = ownerSeed
      ? customerIdsByMobile.get(ownerSeed.customerMobile)
      : undefined;
    if (!ownerCustomerId) {
      console.log(`[seed] 健康记录跳过：宠物「${record.petName}」的主人未找到`);
      continue;
    }
    const petRow = await prisma.pet.findFirst({
      where: { tenantId: bizTenantId, name: record.petName, ownerCustomerId, deletedAt: null },
      select: { id: true },
    });
    if (!petRow) {
      console.log(`[seed] 健康记录跳过：宠物「${record.petName}」未找到`);
      continue;
    }
    const existedRecord = await prisma.healthRecord.findFirst({
      where: {
        tenantId: bizTenantId,
        petId: petRow.id,
        recordType: record.recordType,
        deletedAt: null,
      },
    });
    if (existedRecord) {
      console.log(
        `[seed] 健康记录（${record.petName} · 类型 ${record.recordType}）已存在（id=${existedRecord.id}），跳过`
      );
      continue;
    }
    const createdRecord = await prisma.healthRecord.create({
      data: {
        tenantId: bizTenantId,
        petId: petRow.id,
        recordType: record.recordType,
        recordDate: seedTodayUtc,
        expireDate: addUtcDays(seedTodayUtc, record.expireInDays),
        content: record.content,
        createdBy: auditBy,
        updatedBy: auditBy,
      },
    });
    console.log(
      `[seed] 健康记录已创建（${record.petName} · 类型 ${record.recordType} · 到期 +${record.expireInDays} 天，id=${createdRecord.id}）`
    );
  }

  // 8.9 宠物体重序列演示数据（P0-06-04 FR-3 体重曲线 + BR-4 环比预警）
  //     口径：以「今天」为基准做相对偏移（-120/-90/-60/-30/-2 天），保证图表恒有近期趋势；
  //     每只演示宠物序列的**最后一点**等于 pet.weight_kg 当前快照（旺财 12.50 / 雪球 4.20）
  //     —— pet 快照语义为「最新称重」，seed 不得让快照与序列最新点漂移；
  //     各含一条 |环比| > 15% 的跳变（旺财 -60 天 10.80→13.00 = +20.4%、
  //     雪球 -50 天 3.80→4.50 = +18.4%）以覆盖 BR-4 预警。
  //     幂等键 (tenant_id, pet_id, weighed_at)；weight 为 append-only 语义，seed 只在缺失时补写。
  const demoWeights: Array<{ petName: string; points: Array<[number, string]> }> = [
    {
      petName: "旺财",
      points: [
        [-120, "10.00"],
        [-90, "10.80"],
        [-60, "13.00"],
        [-30, "12.80"],
        [-2, "12.50"],
      ],
    },
    {
      petName: "雪球",
      points: [
        [-110, "3.40"],
        [-80, "3.80"],
        [-50, "4.50"],
        [-20, "4.20"],
      ],
    },
  ];

  for (const series of demoWeights) {
    const ownerSeed = demoPets.find((item) => item.name === series.petName);
    const ownerCustomerId = ownerSeed
      ? customerIdsByMobile.get(ownerSeed.customerMobile)
      : undefined;
    if (!ownerCustomerId) {
      console.log(`[seed] 体重序列跳过：宠物「${series.petName}」的主人未找到`);
      continue;
    }
    const weightPetRow = await prisma.pet.findFirst({
      where: { tenantId: bizTenantId, name: series.petName, ownerCustomerId, deletedAt: null },
      select: { id: true },
    });
    if (!weightPetRow) {
      console.log(`[seed] 体重序列跳过：宠物「${series.petName}」未找到`);
      continue;
    }
    let weightCreated = 0;
    for (const [offsetDays, weightKg] of series.points) {
      const weighedAt = addUtcDays(seedTodayUtc, offsetDays);
      const existedWeight = await prisma.weight.findFirst({
        where: { tenantId: bizTenantId, petId: weightPetRow.id, weighedAt },
        select: { id: true },
      });
      if (existedWeight) continue;
      await prisma.weight.create({
        data: {
          tenantId: bizTenantId,
          petId: weightPetRow.id,
          weighedAt,
          weightKg,
          createdBy: auditBy,
          updatedBy: auditBy,
        },
      });
      weightCreated += 1;
    }
    console.log(
      `[seed] 体重序列（${series.petName}）：新增 ${weightCreated} / 共 ${series.points.length} 点`
    );
  }

  // 8.10 行为标签库演示数据（P0-06-05 FR-4 + BR-2；MVP-WEB-05-05 管理页数据源）
  //     口径：PRD《宠物管理》FR-4 明确列举的标签族（咬人 / 吠叫 / 应激 / 社交友好 / 拆家）
  //     作为**租户级字典**预置 —— 空库会让「宠物打标签」（按钮 6109）与
  //     BR-2「行为标签含咬人的宠物，强制分配独立房」双双成为**死路径**；
  //     同时让 PetFormDialog 的标签下拉具有可选项。
  //     sort 决定列表 / 下拉顺序：「咬人」置首位（BR-2 最高优先级的防护项）。
  //     幂等键 (tenant_id, name)（唯一约束 uk_behavior_tag_tenant_name）：先查后建，
  //     已存在（含软删行）一律跳过 —— 不用 upsert，避免覆盖运营改名后的既有数据。
  const demoBehaviorTags: Array<{ name: string; sort: number; status: number }> = [
    { name: "咬人", sort: 1, status: 1 },
    { name: "吠叫", sort: 2, status: 1 },
    { name: "应激", sort: 3, status: 1 },
    { name: "社交友好", sort: 4, status: 1 },
    { name: "拆家", sort: 5, status: 1 },
  ];

  let behaviorTagCreated = 0;
  for (const tag of demoBehaviorTags) {
    const existedTag = await prisma.behaviorTag.findFirst({
      where: { tenantId: bizTenantId, name: tag.name },
      select: { id: true },
    });
    if (existedTag) continue;
    await prisma.behaviorTag.create({
      data: {
        tenantId: bizTenantId,
        name: tag.name,
        sort: tag.sort,
        status: tag.status,
        createdBy: auditBy,
        updatedBy: auditBy,
      },
    });
    behaviorTagCreated += 1;
  }
  console.log(
    `[seed] 行为标签库：新增 ${behaviorTagCreated} / 共 ${demoBehaviorTags.length} 条（幂等键 tenant_id+name）`
  );

  // 8.11 预约演示数据（MVP-WEB-06-01 预约列表与状态展示）
  //     口径：
  //      - 幂等键 **(tenant_id, booking_no)**；bookingNo 用**稳定**演示编号
  //        （BK-DEMO-0NN，不嵌日期），否则跨天重跑会因日期偏移生成新单号而重复落库；
  //      - booking_date 用**相对今天的偏移**（0/+1/+2/+3/+4/+5/-2 天），保证演示态
  //        恒有「今日排期」与未来排期（供 06-03 日历复用）；首次落库后不再漂移；
  //      - 覆盖**全部 7 个状态**（pending/confirmed/in_service/completed/cancelled/
  //        no_show/rescheduled），且刻意让 3 条落在**同一预约日**以证明服务端
  //        二级排序键（id asc）在并列时仍确定性（列表分页边界稳定）；
  //      - 001/002/003 同日落 hqStore；007/008 构成 BR-1「改期互链」
  //        （008 的 prev_booking_id 指向 007，007 置 rescheduled）；
  //      - service_id 留空（service_item 表尚未建模，见 schema 注释），只落
  //        service_name 快照供列表展示；
  //      - booking_date 为 DATE 列 ⇒ 统一以 **UTC 午夜瞬时**承载（对齐 store_calendar）；
  //        start_time / end_time 为 timestamptz ⇒ 把「北京墙钟」换算为真实瞬时（UTC+8）。
  const beijingInstant = (utcMidnight: Date, hour: number, minute: number): Date =>
    new Date(
      Date.UTC(
        utcMidnight.getUTCFullYear(),
        utcMidnight.getUTCMonth(),
        utcMidnight.getUTCDate(),
        hour - 8,
        minute
      )
    );

  const petIdByName = new Map<string, string>();
  for (const pet of demoPets) {
    const ownerCustomerId = customerIdsByMobile.get(pet.customerMobile);
    if (!ownerCustomerId) continue;
    const row = await prisma.pet.findFirst({
      where: { tenantId: bizTenantId, name: pet.name, ownerCustomerId, deletedAt: null },
      select: { id: true },
    });
    if (row) petIdByName.set(pet.name, row.id);
  }
  const staffIdByName = new Map<string, string>();
  for (const s of demoStaff) {
    const row = await prisma.staff.findFirst({
      where: { tenantId: bizTenantId, storeId: hqStore.id, mobile: s.mobile, deletedAt: null },
      select: { id: true },
    });
    if (row) staffIdByName.set(s.name, row.id);
  }
  const roomIdByNo = new Map<string, string>();
  for (const r of demoRooms) {
    const row = await prisma.room.findFirst({
      where: { tenantId: bizTenantId, storeId: hqStore.id, roomNo: r.roomNo, deletedAt: null },
      select: { id: true },
    });
    if (row) roomIdByNo.set(r.roomNo, row.id);
  }

  type DemoBookingSeed = {
    bookingNo: string;
    storeId: string;
    customerMobile: string;
    petName: string;
    serviceName: string;
    offsetDays: number;
    startHour: number;
    startMinute: number;
    endHour: number;
    endMinute: number;
    employeeName?: string;
    roomNo?: string;
    status: string;
    remark: string;
  };

  const demoBookings: DemoBookingSeed[] = [
    {
      bookingNo: "BK-DEMO-001",
      storeId: hqStore.id,
      customerMobile: "13800002001",
      petName: "旺财",
      serviceName: "洗澡（小型犬）",
      offsetDays: 0,
      startHour: 9,
      startMinute: 30,
      endHour: 10,
      endMinute: 30,
      employeeName: "林美容师",
      status: "confirmed",
      remark: "演示数据 · 今日排期",
    },
    {
      bookingNo: "BK-DEMO-002",
      storeId: hqStore.id,
      customerMobile: "13800002002",
      petName: "雪球",
      serviceName: "猫咪洗护",
      offsetDays: 0,
      startHour: 11,
      startMinute: 0,
      endHour: 12,
      endMinute: 0,
      employeeName: "林美容师",
      roomNo: "C01",
      status: "pending",
      remark: "演示数据 · 今日排期（待确认）",
    },
    {
      bookingNo: "BK-DEMO-003",
      storeId: hqStore.id,
      customerMobile: "13800002001",
      petName: "旺财",
      serviceName: "美容造型",
      offsetDays: 0,
      startHour: 14,
      startMinute: 0,
      endHour: 15,
      endMinute: 0,
      employeeName: "陈店长",
      status: "in_service",
      remark: "演示数据 · 今日排期（服务中）",
    },
    {
      bookingNo: "BK-DEMO-004",
      storeId: hqStore.id,
      customerMobile: "13800002001",
      petName: "旺财",
      serviceName: "狗狗寄养（日托）",
      offsetDays: 1,
      startHour: 10,
      startMinute: 0,
      endHour: 18,
      endMinute: 0,
      employeeName: "王寄养员",
      roomNo: "S01",
      status: "completed",
      remark: "演示数据 · 已完成",
    },
    {
      bookingNo: "BK-DEMO-005",
      storeId: hqStore.id,
      customerMobile: "13800002002",
      petName: "雪球",
      serviceName: "疫苗代办",
      offsetDays: 2,
      startHour: 9,
      startMinute: 0,
      endHour: 9,
      endMinute: 30,
      status: "cancelled",
      remark: "演示数据 · 已取消",
    },
    {
      bookingNo: "BK-DEMO-006",
      storeId: hqStore.id,
      customerMobile: "13800002001",
      petName: "旺财",
      serviceName: "指甲修剪",
      offsetDays: 3,
      startHour: 16,
      startMinute: 0,
      endHour: 16,
      endMinute: 30,
      employeeName: "林美容师",
      status: "no_show",
      remark: "演示数据 · 未到店",
    },
    {
      bookingNo: "BK-DEMO-007",
      storeId: hqStore.id,
      customerMobile: "13800002002",
      petName: "雪球",
      serviceName: "猫咪洗护",
      offsetDays: 4,
      startHour: 13,
      startMinute: 0,
      endHour: 14,
      endMinute: 0,
      status: "rescheduled",
      remark: "演示数据 · 改期前（BR-1 互链源单）",
    },
    {
      bookingNo: "BK-DEMO-008",
      storeId: hqStore.id,
      customerMobile: "13800002002",
      petName: "雪球",
      serviceName: "猫咪洗护",
      offsetDays: 5,
      startHour: 13,
      startMinute: 0,
      endHour: 14,
      endMinute: 0,
      status: "pending",
      remark: "演示数据 · 改期后（BR-1 互链目标单）",
    },
    {
      bookingNo: "BK-DEMO-009",
      storeId: hqStore.id,
      customerMobile: "13800002001",
      petName: "旺财",
      serviceName: "狗狗寄养（日托）",
      offsetDays: -2,
      startHour: 15,
      startMinute: 0,
      endHour: 16,
      endMinute: 0,
      employeeName: "王寄养员",
      roomNo: "D01",
      status: "completed",
      remark: "演示数据 · 历史已完成",
    },
  ];

  let bookingCreated = 0;
  let bookingRescheduledId: string | null = null;
  for (const item of demoBookings) {
    const existed = await prisma.booking.findFirst({
      where: { tenantId: bizTenantId, bookingNo: item.bookingNo },
      select: { id: true },
    });
    if (existed) {
      if (item.bookingNo === "BK-DEMO-007") bookingRescheduledId = existed.id;
      continue;
    }
    const customerId = customerIdsByMobile.get(item.customerMobile);
    const petId = petIdByName.get(item.petName);
    if (!customerId || !petId) {
      console.log(`[seed] 预约「${item.bookingNo}」跳过：客户或宠物未找到`);
      continue;
    }
    const bookingDate = addUtcDays(seedTodayUtc, item.offsetDays);
    const createdBooking = await prisma.booking.create({
      data: {
        tenantId: bizTenantId,
        storeId: item.storeId,
        customerId,
        petId,
        serviceId: null, // service_item 表尚未建模（悬空列）
        serviceName: item.serviceName,
        bookingNo: item.bookingNo,
        bookingDate,
        startTime: beijingInstant(bookingDate, item.startHour, item.startMinute),
        endTime: beijingInstant(bookingDate, item.endHour, item.endMinute),
        employeeId: item.employeeName ? (staffIdByName.get(item.employeeName) ?? null) : null,
        roomId: item.roomNo ? (roomIdByNo.get(item.roomNo) ?? null) : null,
        status: item.status,
        // BR-1 改期互链：008 指向 007（逐个创建保证引用到已落库的源单 id）
        prevBookingId: item.bookingNo === "BK-DEMO-008" ? (bookingRescheduledId ?? null) : null,
        remark: item.remark,
        createdBy: auditBy,
        updatedBy: auditBy,
      },
    });
    if (item.bookingNo === "BK-DEMO-007") bookingRescheduledId = createdBooking.id;
    bookingCreated += 1;
  }
  const bookingAlive = await prisma.booking.count({
    where: { tenantId: bizTenantId, deletedAt: null },
  });
  console.log(
    `[seed] 预约：新增 ${bookingCreated} / 共 ${bookingAlive} 条（幂等键 tenant_id+booking_no）`
  );

  // 8.12 订单演示数据（MVP-WEB-07-01 订单列表）
  //     口径：
  //      - 幂等键 **(tenant_id, order_no)**；orderNo 用**稳定**演示编号（OD-DEMO-0NN，
  //        不嵌日期），跨天重跑不重复落库；
  //      - 覆盖**全部 7 个状态**（draft/pending_payment/paid/in_progress/completed/
  //        refunded/closed），007 演示挂账（credit_flag=true）；
  //      - created_at 用**相对今天的偏移**（0/-1/-2/-3/-6/-8/-10 天），保证创建日期
  //        区间筛选可演示；首次落库后不再漂移；
  //      - 明细（order_item）刻意不落：订单生成与组合明细归 07-03，此处仅落主单列位；
  //      - 005 的 source_booking_id 指向 BK-DEMO-004（已完成预约），演示预约 → 订单链路。
  type DemoOrderSeed = {
    orderNo: string;
    status: string;
    totalAmount: bigint;
    discountAmount: bigint;
    creditFlag?: boolean;
    offsetDays: number;
    sourceBookingNo?: string;
    remark: string;
    /** 刻意落分店的演示单（门店筛选区分度样本）；缺省 = 总部店 */
    storeCode?: string;
  };

  const demoOrders: DemoOrderSeed[] = [
    {
      orderNo: "OD-DEMO-001",
      status: "draft",
      totalAmount: 12800n,
      discountAmount: 0n,
      offsetDays: 0,
      remark: "演示数据 · 草稿（待提交）",
    },
    {
      orderNo: "OD-DEMO-002",
      status: "pending_payment",
      totalAmount: 23800n,
      discountAmount: 800n,
      offsetDays: -1,
      remark: "演示数据 · 待支付（超时自动关闭见 07-06）",
    },
    {
      orderNo: "OD-DEMO-003",
      status: "paid",
      totalAmount: 9800n,
      discountAmount: 0n,
      offsetDays: -2,
      remark: "演示数据 · 已支付待服务",
    },
    {
      // 刻意与 003 **同刻**落库（并列 createdAt）：证明服务端二级排序键（id asc）
      // 在排序值并列时仍确定性（对齐 0601 预约演示同日三单的设计）
      orderNo: "OD-DEMO-004",
      status: "in_progress",
      totalAmount: 32800n,
      discountAmount: 2800n,
      offsetDays: -2,
      remark: "演示数据 · 服务进行中",
    },
    {
      orderNo: "OD-DEMO-005",
      status: "completed",
      totalAmount: 45800n,
      discountAmount: 0n,
      offsetDays: -6,
      sourceBookingNo: "BK-DEMO-004",
      remark: "演示数据 · 历史已完成（来源预约 BK-DEMO-004）",
    },
    {
      orderNo: "OD-DEMO-006",
      status: "refunded",
      totalAmount: 16800n,
      discountAmount: 0n,
      offsetDays: -8,
      remark: "演示数据 · 已退款",
    },
    {
      orderNo: "OD-DEMO-007",
      status: "closed",
      totalAmount: 8800n,
      discountAmount: 0n,
      creditFlag: true,
      offsetDays: -10,
      remark: "演示数据 · 已关闭（挂账单）",
      // 刻意落**分店**：给「门店筛选」留区分度样本（其余 6 条全在总部店 ⇒
      // 若全落同店，删 storeId 过滤的变异不可观测，131-d 同型）
      storeCode: "branch01",
    },
  ];

  const branchStoreRow = await prisma.store.findFirst({
    where: { tenantId: bizTenantId, code: "branch01", deletedAt: null },
    select: { id: true },
  });

  const completedDemoBooking = await prisma.booking.findFirst({
    where: { tenantId: bizTenantId, bookingNo: "BK-DEMO-004", deletedAt: null },
    select: { id: true },
  });

  let orderCreated = 0;
  for (const item of demoOrders) {
    const existed = await prisma.order.findFirst({
      where: { tenantId: bizTenantId, orderNo: item.orderNo },
      select: { id: true },
    });
    if (existed) continue;
    // 轮转两位演示客户/宠物，让列表页「客户 / 宠物」列有区分度
    const customerMobile = Number(item.orderNo.slice(-1)) % 2 === 1 ? "13800002001" : "13800002002";
    const customerId = customerIdsByMobile.get(customerMobile);
    const petId = petIdByName.get(customerMobile === "13800002001" ? "旺财" : "雪球");
    if (!customerId || !petId) {
      console.log(`[seed] 订单「${item.orderNo}」跳过：客户或宠物未找到`);
      continue;
    }
    const createdAt = new Date(addUtcDays(seedTodayUtc, item.offsetDays).getTime() + 10 * 3600_000);
    await prisma.order.create({
      data: {
        tenantId: bizTenantId,
        storeId: item.storeCode === "branch01" && branchStoreRow ? branchStoreRow.id : hqStore.id,
        customerId,
        petId,
        sourceBookingId:
          item.sourceBookingNo && completedDemoBooking ? completedDemoBooking.id : null,
        orderNo: item.orderNo,
        totalAmount: item.totalAmount,
        discountAmount: item.discountAmount,
        payableAmount: item.totalAmount - item.discountAmount,
        creditFlag: item.creditFlag ?? false,
        status: item.status,
        remark: item.remark,
        createdAt,
        createdBy: auditBy,
        updatedBy: auditBy,
      },
    });
    orderCreated += 1;
  }
  const orderAlive = await prisma.order.count({
    where: { tenantId: bizTenantId, deletedAt: null },
  });
  console.log(
    `[seed] 订单：新增 ${orderCreated} / 共 ${orderAlive} 条（幂等键 tenant_id+order_no）`
  );

  // 8.13 订单明细演示数据（MVP-WEB-07-02 订单详情 ·「明细」页签）
  //
  //   口径与约束：
  //    ① **价格快照**：`item_name` / `unit_price` 落库即固化（PRD《订单管理》），
  //       故明细与主数据改名 / 调价解耦；
  //    ② **明细合计 == 订单 total_amount**（优惠单记 `discount_amount`）⇒ 详情页
  //       「概览金额合计」与「明细小计」在真机上可交叉核对（不是两套口径）；
  //    ③ 三类 `item_type` 全覆盖（1 服务 / 2 商品 / 3 套餐）+ 一条 `quantity > 1`
  //       样本（小计乘算可观测）；
  //    ④ ⚠️ `OD-DEMO-007` **刻意不落明细** ⇒ 「明细页签空态」有区分度样本（131-d 同型）；
  //    ⑤ ⚠️ id 显式固定：`OD-DEMO-002` 两条明细 **同一 createdAt**，且**插入顺序与
  //       id 升序相反** ⇒ 服务端 `orderBy createdAt asc, id asc` 的二级键若被摘除，
  //       物理行序会与接口行序不同（二级排序键可观测，对齐 07-01 的订单并列设计）；
  //    ⑥ `ref_id` 是多态关联（无外键）：服务项取 `service_category` **叶子** id
  //       （对齐 06-02「以叶子类目承载服务项」的既有裁决），商品 / 套餐域尚未建模
  //       ⇒ 用固定演示 uuid（明细为快照，不依赖被引对象存在）；
  //    ⑦ 折扣列（`discount_amount` / `discount_source`，MVP-WEB-07-04）：002 / 004 带优惠
  //       ⇒ 「折扣来源」列与「优惠分摊」有可观测样本；其余单行优惠为 0（来源 0 无优惠），
  //       与 `order.discount_amount` 之和自洽（循环内断言校验，见「演示折扣分摊口径」）。
  type DemoOrderItemSeed = {
    id: string;
    itemType: number;
    /** itemType=1 时命中的 `service_category` 叶子名（据此回查 ref_id） */
    refName?: string;
    /** itemType=2/3 时的演示 uuid（无被引实体） */
    refId?: string;
    itemName: string;
    quantity: number;
    unitPrice: bigint;
    /**
     * 该行分摊到的优惠额（分；MVP-WEB-07-04）。
     * 取值 = 服务端 `PUT /orders/:id/discount` 用 `Money.allocate`（floor + 余数逐分派发）
     * 按**行小计比例**分摊的结果 —— 见下方「分摊口径」注释，勿手改单个数字。
     */
    discountAmount?: bigint;
    /** 折扣来源（0 无 / 1 手动改价 / 2 会员等级 / 3 优惠券）；有优惠即 1 */
    discountSource?: number;
    /**
     * 该行履约状态（MVP-WEB-07-05；0 未开始 / 1 进行中 / 2 已完成）。
     * 取值随**所属订单状态**联动（与 07-05 服务端联动语义同口径）：
     * `in_progress` 订单 ⇒ 1、`completed` 订单 ⇒ 2，其余状态 ⇒ 0（缺省）。
     */
    fulfillStatus?: number;
  };

  const DEMO_PRODUCT_REF = "0d0d0d0d-0000-4000-8000-0000000000f2";
  const DEMO_PACKAGE_REF = "0d0d0d0d-0000-4000-8000-0000000000f3";

  // ── 演示折扣分摊口径（MVP-WEB-07-04）────────────────────────────────────
  //  仅 `OD-DEMO-002`（优惠 800 分）与 `OD-DEMO-004`（优惠 2800 分）带优惠。
  //  分摊基数 = 各行小计（unit_price × quantity），**按接口行序**
  //  （`created_at asc, id asc`）排列后调用 `Money.allocate`（floor，余数从下标 0 起逐分派发）：
  //    002：明细接口序 = [指甲修剪 7000, 洗澡（中大型犬）16800]（同刻 createdAt ⇒ id 升序）
  //         → floor(800×7000/23800)=235、floor(800×16800/23800)=564，余 1 分补下标 0
  //         ⇒ [236, 564]，合计 800 ✓
  //    004：明细接口序 = [狗狗寄养 28800, 宠物零食 4000]
  //         → floor(2800×28800/32800)=2458、floor(2800×4000/32800)=341，余 1 分补下标 0
  //         ⇒ [2459, 341]，合计 2800 ✓
  //  ⟹ 守恒不变式：Σ 行 discount_amount == order.discount_amount（下方有断言校验）。
  const demoOrderItems: Record<string, DemoOrderItemSeed[]> = {
    // 128.00 = 猫咪洗护 128.00 ×1（无优惠）
    "OD-DEMO-001": [
      {
        id: "0d0d0d0d-0000-4000-8000-000000000001",
        itemType: 1,
        refName: "猫咪洗护",
        itemName: "猫咪洗护",
        quantity: 1,
        unitPrice: 12800n,
      },
    ],
    // 238.00 = 洗澡（中大型犬）168.00 + 指甲修剪 70.00；优惠 8.00 分摊 ⇒ 564 / 236
    //  ⚠️ 数组顺序刻意「大 id 在前」，物理行序与 id 升序相反（见 ⑤）
    "OD-DEMO-002": [
      {
        id: "0d0d0d0d-0000-4000-8000-000000000003",
        itemType: 1,
        refName: "洗澡（中大型犬）",
        itemName: "洗澡（中大型犬）",
        quantity: 1,
        unitPrice: 16800n,
        discountAmount: 564n,
        discountSource: 1,
      },
      {
        id: "0d0d0d0d-0000-4000-8000-000000000002",
        itemType: 1,
        refName: "指甲修剪",
        itemName: "指甲修剪",
        quantity: 1,
        unitPrice: 7000n,
        discountAmount: 236n,
        discountSource: 1,
      },
    ],
    // 98.00 = 洗澡（小型犬）98.00 ×1（无优惠）
    "OD-DEMO-003": [
      {
        id: "0d0d0d0d-0000-4000-8000-000000000004",
        itemType: 1,
        refName: "洗澡（小型犬）",
        itemName: "洗澡（小型犬）",
        quantity: 1,
        unitPrice: 9800n,
      },
    ],
    // 328.00 = 狗狗寄养 288.00 + 宠物零食 40.00（商品类）；优惠 28.00 分摊 ⇒ 2459 / 341
    "OD-DEMO-004": [
      {
        id: "0d0d0d0d-0000-4000-8000-000000000005",
        itemType: 1,
        refName: "狗狗寄养",
        itemName: "狗狗寄养（1 晚）",
        quantity: 1,
        unitPrice: 28800n,
        discountAmount: 2459n,
        discountSource: 1,
        fulfillStatus: 1,
      },
      {
        id: "0d0d0d0d-0000-4000-8000-000000000006",
        itemType: 2,
        refId: DEMO_PRODUCT_REF,
        itemName: "宠物零食（牛肉干）",
        quantity: 1,
        unitPrice: 4000n,
        discountAmount: 341n,
        discountSource: 1,
        fulfillStatus: 1,
      },
    ],
    // 458.00 = 洗护套餐 229.00 ×2（套餐类 + quantity > 1 样本；无优惠）
    "OD-DEMO-005": [
      {
        id: "0d0d0d0d-0000-4000-8000-000000000007",
        itemType: 3,
        refId: DEMO_PACKAGE_REF,
        itemName: "洗护套餐（5 次）",
        quantity: 2,
        unitPrice: 22900n,
        fulfillStatus: 2,
      },
    ],
    // 168.00 = 猫咪洗护 128.00 + 宠物零食 40.00（无优惠）
    "OD-DEMO-006": [
      {
        id: "0d0d0d0d-0000-4000-8000-000000000008",
        itemType: 1,
        refName: "猫咪洗护",
        itemName: "猫咪洗护",
        quantity: 1,
        unitPrice: 12800n,
      },
      {
        id: "0d0d0d0d-0000-4000-8000-000000000009",
        itemType: 2,
        refId: DEMO_PRODUCT_REF,
        itemName: "宠物零食（牛肉干）",
        quantity: 1,
        unitPrice: 4000n,
      },
    ],
    // OD-DEMO-007（closed / 分店挂账单）**刻意无明细** ⇒ 明细页签空态样本
    "OD-DEMO-007": [],
  };

  const leafCategories = await prisma.serviceCategory.findMany({
    where: { tenantId: bizTenantId, storeId: null, deletedAt: null },
    select: { id: true, name: true },
  });
  const leafIdByName = new Map(leafCategories.map((c) => [c.name, c.id]));

  let orderItemCreated = 0;
  let orderItemRepaired = 0;
  for (const [orderNo, items] of Object.entries(demoOrderItems)) {
    const orderRow = await prisma.order.findFirst({
      where: { tenantId: bizTenantId, orderNo },
      select: { id: true, createdAt: true, discountAmount: true },
    });
    if (!orderRow) continue;

    // 🔴 守恒断言（MVP-WEB-07-04）：Σ 行优惠 == 订单优惠。
    // 不一致 ⇒ 演示数据内部矛盾（详情页「概览优惠」与「明细分摊」会对不上），
    // 必须显式暴露而不是静默放过（与 8.13 ②「明细合计 == total_amount」同族约束）。
    const specDiscountSum = items.reduce((sum, item) => sum + (item.discountAmount ?? 0n), 0n);
    if (specDiscountSum !== orderRow.discountAmount) {
      console.log(
        `[seed] ⚠️ 订单「${orderNo}」优惠分摊不自洽：Σ行优惠=${specDiscountSum} ≠ 订单优惠=${orderRow.discountAmount}`
      );
    }

    for (const item of items) {
      const wantDiscount = item.discountAmount ?? 0n;
      const wantSource = item.discountSource ?? 0;
      const wantFulfill = item.fulfillStatus ?? 0;
      const existed = await prisma.orderItem.findFirst({
        where: { id: item.id },
        select: { id: true, discountAmount: true, discountSource: true, fulfillStatus: true },
      });
      if (existed) {
        // 幂等收敛：discount_amount / discount_source 为 07-04 新增列、fulfill_status 为
        // 07-05 新增列 ⇒ 老库既有行需补齐/纠正（显式 id 幂等键下老行不会被重建，
        // 故这里做「值收敛」而非跳过 —— 否则旧库永远缺折扣 / 履约状态）。
        if (
          existed.discountAmount !== wantDiscount ||
          existed.discountSource !== wantSource ||
          existed.fulfillStatus !== wantFulfill
        ) {
          await prisma.orderItem.update({
            where: { id: item.id },
            data: {
              discountAmount: wantDiscount,
              discountSource: wantSource,
              fulfillStatus: wantFulfill,
              updatedBy: auditBy,
            },
          });
          orderItemRepaired += 1;
        }
        continue;
      }
      const refId = item.refName ? leafIdByName.get(item.refName) : item.refId;
      if (!refId) {
        console.log(`[seed] 订单明细「${orderNo}/${item.itemName}」跳过：ref 未找到`);
        continue;
      }
      await prisma.orderItem.create({
        data: {
          id: item.id,
          tenantId: bizTenantId,
          orderId: orderRow.id,
          itemType: item.itemType,
          refId,
          itemName: item.itemName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: wantDiscount,
          discountSource: wantSource,
          fulfillStatus: wantFulfill,
          createdAt: orderRow.createdAt,
          createdBy: auditBy,
          updatedBy: auditBy,
        },
      });
      orderItemCreated += 1;
    }
  }
  const orderItemAlive = await prisma.orderItem.count({
    where: { tenantId: bizTenantId, deletedAt: null },
  });
  console.log(
    `[seed] 订单明细：新增 ${orderItemCreated} / 折扣·履约列收敛 ${orderItemRepaired} / 共 ${orderItemAlive} 条（幂等键=显式 id；OD-DEMO-007 刻意留空）`
  );

  // 8.14 订单演示审计（MVP-WEB-07-02 订单详情 ·「操作日志」页签）
  //
  //   ⚠️ `audit_log` 是 **append-only** 审计流水（触发器 `audit_log_no_mutation`
  //   拦截 UPDATE / DELETE，见踩坑 134-a）——本段只**新增**、不改不删。
  //   ⚠️ 订单域的**写入端点**归 07-03+（生成 / 优惠 / 履约 / 关闭）⇒ 当前没有真实
  //   审计产线，故本段按「演示数据」口径直插审计行，让「操作日志」页签的
  //   时间序 / 前后值 / 操作人 / 系统动作四类渲染都有可核对样本；
  //   真实写入侧留痕随 07-03+ 端点接入（届时本段可退化为「历史样例」）。
  //   幂等：`audit_log` 无自然键 ⇒ 用显式固定 id + findFirst(id) 跳过。
  const managerUser = await prisma.sysUser.findFirst({
    where: { tenantId: bizTenantId, username: "store_manager", isDeleted: 0 },
    select: { id: true, nickname: true },
  });
  const receptionUser = await prisma.sysUser.findFirst({
    where: { tenantId: bizTenantId, username: "reception01", isDeleted: 0 },
    select: { id: true, nickname: true },
  });

  type DemoOrderAuditSeed = {
    id: string;
    orderNo: string;
    action: number;
    before: unknown;
    after: unknown;
    /** 操作人：`manager` / `reception` / `system`（系统动作 operatorId 为 NULL） */
    by: "manager" | "reception" | "system";
    /** 相对订单 createdAt 的分钟偏移（保证同单内时间序唯一、跨单不交叉） */
    offsetMinutes: number;
  };

  const demoOrderAudits: DemoOrderAuditSeed[] = [
    {
      id: "0a0a0a0a-0000-4000-8000-000000000001",
      orderNo: "OD-DEMO-003",
      action: 1, // CREATE
      before: null,
      after: { status: "paid", totalAmount: "9800", payableAmount: "9800" },
      by: "manager",
      offsetMinutes: 3,
    },
    {
      id: "0a0a0a0a-0000-4000-8000-000000000002",
      orderNo: "OD-DEMO-004",
      action: 1, // CREATE
      before: null,
      after: { status: "draft", totalAmount: "32800", discountAmount: "2800", payableAmount: "30000" },
      by: "reception",
      offsetMinutes: 3,
    },
    {
      id: "0a0a0a0a-0000-4000-8000-000000000003",
      orderNo: "OD-DEMO-004",
      action: 2, // UPDATE
      before: { status: "draft" },
      after: { status: "in_progress" },
      by: "manager",
      offsetMinutes: 35,
    },
    {
      id: "0a0a0a0a-0000-4000-8000-000000000004",
      orderNo: "OD-DEMO-005",
      action: 1, // CREATE
      before: null,
      after: { status: "paid", totalAmount: "45800", payableAmount: "45800" },
      by: "reception",
      offsetMinutes: 3,
    },
    {
      id: "0a0a0a0a-0000-4000-8000-000000000005",
      orderNo: "OD-DEMO-005",
      action: 2, // UPDATE
      before: { status: "paid" },
      after: { status: "in_progress" },
      by: "manager",
      offsetMinutes: 30,
    },
    {
      id: "0a0a0a0a-0000-4000-8000-000000000006",
      orderNo: "OD-DEMO-005",
      action: 2, // UPDATE —— 系统动作样本（operatorType=0 / operatorId=NULL）
      before: { status: "in_progress" },
      after: { status: "completed" },
      by: "system",
      offsetMinutes: 240,
    },
  ];

  let orderAuditCreated = 0;
  for (const entry of demoOrderAudits) {
    const existed = await prisma.auditLog.findFirst({ where: { id: entry.id }, select: { id: true } });
    if (existed) continue;
    const orderRow = await prisma.order.findFirst({
      where: { tenantId: bizTenantId, orderNo: entry.orderNo },
      select: { id: true, storeId: true, createdAt: true },
    });
    if (!orderRow) continue;
    const operator =
      entry.by === "manager" ? managerUser : entry.by === "reception" ? receptionUser : null;
    await prisma.auditLog.create({
      data: {
        id: entry.id,
        tenantId: bizTenantId,
        storeId: orderRow.storeId,
        entityType: "order",
        entityId: orderRow.id,
        action: entry.action,
        before: (entry.before ?? undefined) as never,
        after: entry.after as never,
        operatorId: operator?.id ?? null,
        operatorType: operator ? 1 : 0,
        operatorName: operator?.nickname ?? null,
        ip: null,
        traceId: null,
        idempotencyKey: null,
        createdAt: new Date(orderRow.createdAt.getTime() + entry.offsetMinutes * 60_000),
      },
    });
    orderAuditCreated += 1;
  }
  const orderAuditAlive = await prisma.auditLog.count({
    where: { tenantId: bizTenantId, entityType: "order" },
  });
  console.log(
    `[seed] 订单演示审计：新增 ${orderAuditCreated} / 共 ${orderAuditAlive} 条（append-only，仅新增）`
  );

  // 8.6 业务域回读核验：按 tenant_id=1 + store_id 归属计数，与期望值比对
  const expect = { stores: 2, categories: 8, rooms: 6, staff: 3, customers: 2, pets: 2 };
  const [storeCount, categoryCount, roomCount, staffCount, customerCount, petCount] =
    await Promise.all([
      prisma.store.count({ where: { tenantId: bizTenantId, deletedAt: null } }),
      prisma.serviceCategory.count({
        where: { tenantId: bizTenantId, storeId: null, deletedAt: null },
      }),
      prisma.room.count({ where: { tenantId: bizTenantId, storeId: hqStore.id, deletedAt: null } }),
      prisma.staff.count({
        where: { tenantId: bizTenantId, storeId: hqStore.id, deletedAt: null },
      }),
      prisma.customer.count({ where: { tenantId: bizTenantId, deletedAt: null } }),
      prisma.pet.count({ where: { tenantId: bizTenantId, deletedAt: null } }),
    ]);
  const bizOk =
    storeCount === expect.stores &&
    categoryCount === expect.categories &&
    roomCount === expect.rooms &&
    staffCount === expect.staff &&
    customerCount === expect.customers &&
    petCount === expect.pets;
  console.log(
    `[seed] 业务域回读：门店 ${storeCount}/${expect.stores}、类目 ${categoryCount}/${expect.categories}、` +
      `房间 ${roomCount}/${expect.rooms}（store_id=${hqStore.id}）、员工 ${staffCount}/${expect.staff}（store_id=${hqStore.id}）、` +
      `客户 ${customerCount}/${expect.customers}、宠物 ${petCount}/${expect.pets}` +
      `${bizOk ? "✅" : "❌ 与期望不符"}`
  );

  // ─────────────────────────────────────────────
  // 9. 系统菜单树（MVP-WEB-01-04 RBAC 动态导航 / 前端侧边栏的前置数据）
  // ─────────────────────────────────────────────
  // 盘面来源：原 niulai_admin 的 MySQL 种子（git 历史 niulai-nest/sql/mysql/niulai_admin.sql，
  // 工作区已移除）。迁 PG/Prisma 时只搬了 schema、**漏搬菜单数据** ⇒ sys_menu / sys_role_menu 为空
  // ⇒ GET /menus/routes 返回 [] ⇒ 前端侧边栏只剩静态首页（dashboard）。
  //
  // 只种前端 src/views 下**仍然存在**的页面（系统管理一组）。已删除页面对应的菜单一律不种，
  // 否则会注册出指向不存在组件的路由（点开即 404）：
  //   280 通知公告 / 310 代码生成 / 501-504 平台文档 / 601 Apifox /
  //   701-709 组件封装 / 801-804 功能演示 / 910-913 多级菜单 / 1001-1002 路由参数
  //
  // id 显式沿用原 MySQL 种子（便于与历史数据对照）。因 sys_menu 是空表，
  // 显式 id **不会推进自增序列**，故 9.3 必须 setval 同步，否则后续新增菜单会与 1/210/... 撞号。
  // tree_path = 逗号分隔的「祖先…自身」路径（MenuService.getMenus 按 split(",") 补祖先链）。
  type MenuSeed = {
    id: number;
    parentId: number;
    treePath: string;
    name: string;
    menuType: "C" | "M" | "B";
    routeName?: string | null;
    routePath?: string | null;
    component?: string | null;
    perm?: string | null;
    alwaysShow?: number | null;
    keepAlive?: number | null;
    visible?: number;
    sort?: number;
    icon?: string | null;
    redirect?: string | null;
  };
  const menuSeeds: MenuSeed[] = [
    // 顶级目录：系统管理
    {
      id: 1,
      parentId: 0,
      treePath: "0",
      name: "系统管理",
      menuType: "C",
      routeName: "",
      routePath: "/system",
      component: "Layout",
      redirect: "/system/user",
      alwaysShow: null,
      keepAlive: null,
      visible: 1,
      sort: 1,
      icon: "system",
    },
    // 用户管理
    {
      id: 210,
      parentId: 1,
      treePath: "0,1",
      name: "用户管理",
      menuType: "M",
      routeName: "User",
      routePath: "user",
      component: "system/user/index",
      alwaysShow: null,
      keepAlive: 1,
      visible: 1,
      sort: 1,
      icon: "el-icon-User",
    },
    {
      id: 2101,
      parentId: 210,
      treePath: "0,1,210",
      name: "用户查询",
      menuType: "B",
      routePath: "",
      perm: "sys:user:list",
      visible: 1,
      sort: 1,
      icon: "",
    },
    {
      id: 2102,
      parentId: 210,
      treePath: "0,1,210",
      name: "用户新增",
      menuType: "B",
      routePath: "",
      perm: "sys:user:create",
      visible: 1,
      sort: 2,
      icon: "",
    },
    {
      id: 2103,
      parentId: 210,
      treePath: "0,1,210",
      name: "用户编辑",
      menuType: "B",
      routePath: "",
      perm: "sys:user:update",
      visible: 1,
      sort: 3,
      icon: "",
    },
    {
      id: 2104,
      parentId: 210,
      treePath: "0,1,210",
      name: "用户删除",
      menuType: "B",
      routePath: "",
      perm: "sys:user:delete",
      visible: 1,
      sort: 4,
      icon: "",
    },
    {
      id: 2105,
      parentId: 210,
      treePath: "0,1,210",
      name: "重置密码",
      menuType: "B",
      routePath: "",
      perm: "sys:user:reset-password",
      visible: 1,
      sort: 5,
      icon: "",
    },
    {
      id: 2106,
      parentId: 210,
      treePath: "0,1,210",
      name: "用户导入",
      menuType: "B",
      routePath: "",
      perm: "sys:user:import",
      visible: 1,
      sort: 6,
      icon: "",
    },
    {
      id: 2107,
      parentId: 210,
      treePath: "0,1,210",
      name: "用户导出",
      menuType: "B",
      routePath: "",
      perm: "sys:user:export",
      visible: 1,
      sort: 7,
      icon: "",
    },
    // 角色管理
    {
      id: 220,
      parentId: 1,
      treePath: "0,1",
      name: "角色管理",
      menuType: "M",
      routeName: "Role",
      routePath: "role",
      component: "system/role/index",
      alwaysShow: null,
      keepAlive: 1,
      visible: 1,
      sort: 2,
      icon: "role",
    },
    {
      id: 2201,
      parentId: 220,
      treePath: "0,1,220",
      name: "角色查询",
      menuType: "B",
      routePath: "",
      perm: "sys:role:list",
      visible: 1,
      sort: 1,
      icon: "",
    },
    {
      id: 2202,
      parentId: 220,
      treePath: "0,1,220",
      name: "角色新增",
      menuType: "B",
      routePath: "",
      perm: "sys:role:create",
      visible: 1,
      sort: 2,
      icon: "",
    },
    {
      id: 2203,
      parentId: 220,
      treePath: "0,1,220",
      name: "角色编辑",
      menuType: "B",
      routePath: "",
      perm: "sys:role:update",
      visible: 1,
      sort: 3,
      icon: "",
    },
    {
      id: 2204,
      parentId: 220,
      treePath: "0,1,220",
      name: "角色删除",
      menuType: "B",
      routePath: "",
      perm: "sys:role:delete",
      visible: 1,
      sort: 4,
      icon: "",
    },
    {
      id: 2205,
      parentId: 220,
      treePath: "0,1,220",
      name: "角色分配权限",
      menuType: "B",
      routePath: "",
      perm: "sys:role:assign",
      visible: 1,
      sort: 5,
      icon: "",
    },
    // 菜单管理
    {
      id: 230,
      parentId: 1,
      treePath: "0,1",
      name: "菜单管理",
      menuType: "M",
      routeName: "SysMenu",
      routePath: "menu",
      component: "system/menu/index",
      alwaysShow: null,
      keepAlive: 1,
      visible: 1,
      sort: 3,
      icon: "menu",
    },
    {
      id: 2301,
      parentId: 230,
      treePath: "0,1,230",
      name: "菜单查询",
      menuType: "B",
      routePath: "",
      perm: "sys:menu:list",
      visible: 1,
      sort: 1,
      icon: "",
    },
    {
      id: 2302,
      parentId: 230,
      treePath: "0,1,230",
      name: "菜单新增",
      menuType: "B",
      routePath: "",
      perm: "sys:menu:create",
      visible: 1,
      sort: 2,
      icon: "",
    },
    {
      id: 2303,
      parentId: 230,
      treePath: "0,1,230",
      name: "菜单编辑",
      menuType: "B",
      routePath: "",
      perm: "sys:menu:update",
      visible: 1,
      sort: 3,
      icon: "",
    },
    {
      id: 2304,
      parentId: 230,
      treePath: "0,1,230",
      name: "菜单删除",
      menuType: "B",
      routePath: "",
      perm: "sys:menu:delete",
      visible: 1,
      sort: 4,
      icon: "",
    },
    // 部门管理
    {
      id: 240,
      parentId: 1,
      treePath: "0,1",
      name: "部门管理",
      menuType: "M",
      routeName: "Dept",
      routePath: "dept",
      component: "system/dept/index",
      alwaysShow: null,
      keepAlive: 1,
      visible: 1,
      sort: 4,
      icon: "tree",
    },
    {
      id: 2401,
      parentId: 240,
      treePath: "0,1,240",
      name: "部门查询",
      menuType: "B",
      routePath: "",
      perm: "sys:dept:list",
      visible: 1,
      sort: 1,
      icon: "",
    },
    {
      id: 2402,
      parentId: 240,
      treePath: "0,1,240",
      name: "部门新增",
      menuType: "B",
      routePath: "",
      perm: "sys:dept:create",
      visible: 1,
      sort: 2,
      icon: "",
    },
    {
      id: 2403,
      parentId: 240,
      treePath: "0,1,240",
      name: "部门编辑",
      menuType: "B",
      routePath: "",
      perm: "sys:dept:update",
      visible: 1,
      sort: 3,
      icon: "",
    },
    {
      id: 2404,
      parentId: 240,
      treePath: "0,1,240",
      name: "部门删除",
      menuType: "B",
      routePath: "",
      perm: "sys:dept:delete",
      visible: 1,
      sort: 4,
      icon: "",
    },
    // 字典管理
    {
      id: 250,
      parentId: 1,
      treePath: "0,1",
      name: "字典管理",
      menuType: "M",
      routeName: "Dict",
      routePath: "dict",
      component: "system/dict/index",
      alwaysShow: null,
      keepAlive: 1,
      visible: 1,
      sort: 5,
      icon: "dict",
    },
    {
      id: 2501,
      parentId: 250,
      treePath: "0,1,250",
      name: "字典查询",
      menuType: "B",
      routePath: "",
      perm: "sys:dict:list",
      visible: 1,
      sort: 1,
      icon: "",
    },
    {
      id: 2502,
      parentId: 250,
      treePath: "0,1,250",
      name: "字典新增",
      menuType: "B",
      routePath: "",
      perm: "sys:dict:create",
      visible: 1,
      sort: 2,
      icon: "",
    },
    {
      id: 2503,
      parentId: 250,
      treePath: "0,1,250",
      name: "字典编辑",
      menuType: "B",
      routePath: "",
      perm: "sys:dict:update",
      visible: 1,
      sort: 3,
      icon: "",
    },
    {
      id: 2504,
      parentId: 250,
      treePath: "0,1,250",
      name: "字典删除",
      menuType: "B",
      routePath: "",
      perm: "sys:dict:delete",
      visible: 1,
      sort: 4,
      icon: "",
    },
    // 字典项（隐藏菜单：由字典管理页内跳转进入）
    {
      id: 251,
      parentId: 1,
      treePath: "0,1",
      name: "字典项",
      menuType: "M",
      routeName: "DictItem",
      routePath: "dict-item",
      component: "system/dict/dict-item",
      alwaysShow: 0,
      keepAlive: 1,
      visible: 0,
      sort: 6,
      icon: "",
    },
    {
      id: 2511,
      parentId: 251,
      treePath: "0,1,251",
      name: "字典项查询",
      menuType: "B",
      routePath: "",
      perm: "sys:dict-item:list",
      visible: 1,
      sort: 1,
      icon: "",
    },
    {
      id: 2512,
      parentId: 251,
      treePath: "0,1,251",
      name: "字典项新增",
      menuType: "B",
      routePath: "",
      perm: "sys:dict-item:create",
      visible: 1,
      sort: 2,
      icon: "",
    },
    {
      id: 2513,
      parentId: 251,
      treePath: "0,1,251",
      name: "字典项编辑",
      menuType: "B",
      routePath: "",
      perm: "sys:dict-item:update",
      visible: 1,
      sort: 3,
      icon: "",
    },
    {
      id: 2514,
      parentId: 251,
      treePath: "0,1,251",
      name: "字典项删除",
      menuType: "B",
      routePath: "",
      perm: "sys:dict-item:delete",
      visible: 1,
      sort: 4,
      icon: "",
    },
    // 系统日志
    {
      id: 260,
      parentId: 1,
      treePath: "0,1",
      name: "系统日志",
      menuType: "M",
      routeName: "Log",
      routePath: "log",
      component: "system/log/index",
      alwaysShow: 0,
      keepAlive: 1,
      visible: 1,
      sort: 7,
      icon: "document",
    },
    {
      id: 2601,
      parentId: 260,
      treePath: "0,1,260",
      name: "日志查询",
      menuType: "B",
      routePath: "",
      perm: "sys:log:list",
      visible: 1,
      sort: 1,
      icon: "",
    },
    // 系统配置
    {
      id: 270,
      parentId: 1,
      treePath: "0,1",
      name: "系统配置",
      menuType: "M",
      routeName: "Config",
      routePath: "config",
      component: "system/config/index",
      alwaysShow: 0,
      keepAlive: 1,
      visible: 1,
      sort: 8,
      icon: "setting",
    },
    {
      id: 2701,
      parentId: 270,
      treePath: "0,1,270",
      name: "系统配置查询",
      menuType: "B",
      routePath: "",
      perm: "sys:config:list",
      alwaysShow: 0,
      keepAlive: 1,
      visible: 1,
      sort: 1,
      icon: "",
    },
    {
      id: 2702,
      parentId: 270,
      treePath: "0,1,270",
      name: "系统配置新增",
      menuType: "B",
      routePath: "",
      perm: "sys:config:create",
      alwaysShow: 0,
      keepAlive: 1,
      visible: 1,
      sort: 2,
      icon: "",
    },
    {
      id: 2703,
      parentId: 270,
      treePath: "0,1,270",
      name: "系统配置修改",
      menuType: "B",
      routePath: "",
      perm: "sys:config:update",
      alwaysShow: 0,
      keepAlive: 1,
      visible: 1,
      sort: 3,
      icon: "",
    },
    {
      id: 2704,
      parentId: 270,
      treePath: "0,1,270",
      name: "系统配置删除",
      menuType: "B",
      routePath: "",
      perm: "sys:config:delete",
      alwaysShow: 0,
      keepAlive: 1,
      visible: 1,
      sort: 4,
      icon: "",
    },
    {
      id: 2705,
      parentId: 270,
      treePath: "0,1,270",
      name: "系统配置刷新",
      menuType: "B",
      routePath: "",
      perm: "sys:config:refresh",
      alwaysShow: 0,
      keepAlive: 1,
      visible: 1,
      sort: 5,
      icon: "",
    },

    // ── 门店模块（MVP-WEB-02-01「门店列表与表单页」的业务菜单）───────────────
    // 路径口径来自 PRD《页面清单》「页面清单总表」：模块「门店」→ 落地页 `stores`。
    // 目录 routePath `/stores` + 子菜单 routePath 空串 ⇒ 子路由即默认子路由，
    // 完整路径恒为 `/stores`（与 PRD 一致，非 `/stores/xxx`）。
    // 菜单由后端按权限下发（MenuService.getRoutes → 前端 transformRoutes），
    // 故「门店」归入《页面信息架构》§管理线分组、无授权角色整组/整模块不渲染。
    // 权限码对齐《权限规则》「页面与数据权限矩阵·管理模块」：门店管理 ● / ● / ◐（只读），
    // 店长只授 store:list ⇒ 页面可见但新建/编辑/删除入口由 v-hasPerm 自动隐藏。
    {
      id: 400,
      parentId: 0,
      treePath: "0",
      name: "门店",
      menuType: "C",
      routeName: "",
      routePath: "/stores",
      component: "Layout",
      alwaysShow: null,
      keepAlive: null,
      visible: 1,
      sort: 2,
      icon: "el-icon-Shop",
    },
    {
      id: 410,
      parentId: 400,
      treePath: "0,400",
      name: "门店管理",
      menuType: "M",
      routeName: "Stores",
      routePath: "",
      component: "store/stores/index",
      alwaysShow: null,
      keepAlive: 1,
      visible: 1,
      sort: 1,
      icon: "el-icon-Shop",
    },
    {
      id: 4101,
      parentId: 410,
      treePath: "0,400,410",
      name: "门店查询",
      menuType: "B",
      routePath: "",
      perm: "store:list",
      visible: 1,
      sort: 1,
      icon: "",
    },
    {
      id: 4102,
      parentId: 410,
      treePath: "0,400,410",
      name: "门店新增",
      menuType: "B",
      routePath: "",
      perm: "store:create",
      visible: 1,
      sort: 2,
      icon: "",
    },
    {
      id: 4103,
      parentId: 410,
      treePath: "0,400,410",
      name: "门店编辑",
      menuType: "B",
      routePath: "",
      perm: "store:update",
      visible: 1,
      sort: 3,
      icon: "",
    },
    {
      id: 4104,
      parentId: 410,
      treePath: "0,400,410",
      name: "门店删除",
      menuType: "B",
      routePath: "",
      perm: "store:delete",
      visible: 1,
      sort: 4,
      icon: "",
    },

    // ── 房间资源（MVP-WEB-02-02「房间资源管理页」的业务菜单）────────────────
    // 房间必属门店（room.storeId 非空），故作为「门店」目录下的第二个子菜单：
    // 子菜单 routePath 用相对段 `rooms` ⇒ vue-router children 语义拼成 `/stores/rooms`
    // （后端 buildRoutes 只透传 routePath、不做父路径拼接，拼接由 vue-router 完成）。
    // 权限码对齐后端 RoomController：room:list / room:create / room:update / room:delete。
    // 注意：房态看板/房态图（GET /rooms/availability）归 MVP-WEB-09-01，不在本页范围。
    {
      id: 420,
      parentId: 400,
      treePath: "0,400",
      name: "房间资源",
      menuType: "M",
      routeName: "Rooms",
      routePath: "rooms",
      component: "store/rooms/index",
      alwaysShow: null,
      keepAlive: 1,
      visible: 1,
      sort: 2,
      icon: "el-icon-House",
    },
    {
      id: 4201,
      parentId: 420,
      treePath: "0,400,420",
      name: "房间查询",
      menuType: "B",
      routePath: "",
      perm: "room:list",
      visible: 1,
      sort: 1,
      icon: "",
    },
    {
      id: 4202,
      parentId: 420,
      treePath: "0,400,420",
      name: "房间新增",
      menuType: "B",
      routePath: "",
      perm: "room:create",
      visible: 1,
      sort: 2,
      icon: "",
    },
    {
      id: 4203,
      parentId: 420,
      treePath: "0,400,420",
      name: "房间编辑",
      menuType: "B",
      routePath: "",
      perm: "room:update",
      visible: 1,
      sort: 3,
      icon: "",
    },
    {
      id: 4204,
      parentId: 420,
      treePath: "0,400,420",
      name: "房间删除",
      menuType: "B",
      routePath: "",
      perm: "room:delete",
      visible: 1,
      sort: 4,
      icon: "",
    },

    // ── 门店配置（MVP-WEB-02-03「营业时间与门店配置页」的业务菜单）────────────
    // 该页承载两类门店运营配置（均为「选中某一门店后编辑」）：
    //   ① 每周营业时段（PUT /stores/:id/business-hours，7 天键整存整取）；
    //   ② 结构化配置（PATCH /stores/:id/config，浅 merge：时段粒度/预约提前量/
    //      取消截止/寄养出入住时间窗/推送开关）。
    // 后端两接口共用门店档案权限码（store:list 读 / store:update 写），
    // 故本菜单**不再新增按钮级权限行**（避免同一 perm 在 sys_role_menu 里重复授权）。
    {
      id: 430,
      parentId: 400,
      treePath: "0,400",
      name: "门店配置",
      menuType: "M",
      routeName: "StoreConfig",
      routePath: "config",
      component: "store/config/index",
      alwaysShow: null,
      keepAlive: 1,
      visible: 1,
      sort: 3,
      icon: "el-icon-Setting",
    },

    // ── 门店日历（MVP-WEB-02-04「门店日历页」的业务菜单）──────────────────────
    // 该页承载门店的**日期级例外日历**与**整月逐日营业视图**（FR-3 的日历部分 +
    // FR-6 聚合视图）：
    //   ① 例外日 CRUD：POST/GET/DELETE /stores/:id/calendar（同店同日唯一，软删）；
    //   ② 整月逐日视图：GET /stores/:id/calendar-view?month=yyyy-MM
    //      （周时段 + 日历例外聚合，例外日优先：type1/2 闭店、type3 特殊时段）。
    // 交互模型与 02-03 的门店配置页不同：日历是「逐日即时提交」的 CRUD，
    // 没有整存整取与底部保存条，故独立成页而非 02-03 的第三个 Tab。
    // 权限码同样复用门店档案的 store:list（读）/ store:update（写），不新增按钮级行。
    // 子菜单 routePath 用相对段 `calendar` ⇒ 拼成 `/stores/calendar`。
    {
      id: 440,
      parentId: 400,
      treePath: "0,400",
      name: "门店日历",
      menuType: "M",
      routeName: "StoreCalendar",
      routePath: "calendar",
      component: "store/calendar/index",
      alwaysShow: null,
      keepAlive: 1,
      visible: 1,
      sort: 4,
      icon: "el-icon-Calendar",
    },

    // ── 客户（MVP-WEB-04-01「客户列表 DataTable」+ 04-02「客户详情」的业务菜单）──
    // 对象中心下的客户模块：PRD《页面清单》路径 `customers` / `customers/:customer_id`，
    // 可见角色 超管 / 总部 / 店长 / 前台 / 财务 / 运营。
    //   ① 列表：GET /customers（keyword/门店/分层/创建时间区间筛选，服务端排序）；
    //   ② 详情：GET /customers/:id（MVP-WEB-04-02，以列表页内**右侧抽屉**承载，
    //      PRD《Web规范》§页面模式 1「详情一律用右侧抽屉呈现而非跳页」⇒ 不新增路由/菜单）；
    //   ③ 删除：DELETE /customers/:id 软删（手机号随之释放）。
    // 权限码单一事实源见 niulai-nest/src/customer/customer-permissions.constants.ts：
    // 档案 CRUD 四码（5101~5104）+ MVP-WEB-04-02 明细能力点（5105~5112：
    // 宠物归属查询 / 触达记录查询·记录 / 触达偏好查询·设置 / 黑名单查询·拉黑·解除）。
    // ⚠️ 触达 / 黑名单子能力此前「复用客户域粗粒度四码」，自 P0-05-08 起细化为
    // `域:对象:动作` 能力点；ROOT 直放 ⇒ 对既有可运行链路零影响。
    // 目录 routePath 取绝对段 `/customers`，菜单 routePath 为空相对段 ⇒ 完整路径 `/customers`。
    {
      id: 500,
      parentId: 0,
      treePath: "0",
      name: "客户",
      menuType: "C",
      routeName: "",
      routePath: "/customers",
      component: "Layout",
      redirect: "/customers",
      alwaysShow: null,
      keepAlive: null,
      visible: 1,
      sort: 3,
      icon: "el-icon-User",
    },
    {
      id: 510,
      parentId: 500,
      treePath: "0,500",
      name: "客户列表",
      menuType: "M",
      routeName: "Customers",
      routePath: "",
      component: "customer/customers/index",
      alwaysShow: null,
      keepAlive: 1,
      visible: 1,
      sort: 1,
      icon: "el-icon-User",
    },
    {
      id: 5101,
      parentId: 510,
      treePath: "0,500,510",
      name: "客户查询",
      menuType: "B",
      routePath: "",
      perm: "customer:list",
      visible: 1,
      sort: 1,
      icon: "",
    },
    {
      id: 5102,
      parentId: 510,
      treePath: "0,500,510",
      name: "客户新增",
      menuType: "B",
      routePath: "",
      perm: "customer:create",
      visible: 1,
      sort: 2,
      icon: "",
    },
    {
      id: 5103,
      parentId: 510,
      treePath: "0,500,510",
      name: "客户修改",
      menuType: "B",
      routePath: "",
      perm: "customer:update",
      visible: 1,
      sort: 3,
      icon: "",
    },
    {
      id: 5104,
      parentId: 510,
      treePath: "0,500,510",
      name: "客户删除",
      menuType: "B",
      routePath: "",
      perm: "customer:delete",
      visible: 1,
      sort: 4,
      icon: "",
    },
    // ── 客户详情子能力（MVP-WEB-04-02）──
    {
      id: 5105,
      parentId: 510,
      treePath: "0,500,510",
      name: "客户宠物-查询",
      menuType: "B",
      routePath: "",
      perm: "customer:pet:list",
      visible: 1,
      sort: 5,
      icon: "",
    },
    {
      id: 5106,
      parentId: 510,
      treePath: "0,500,510",
      name: "客户触达-查询",
      menuType: "B",
      routePath: "",
      perm: "customer:reach:list",
      visible: 1,
      sort: 6,
      icon: "",
    },
    {
      id: 5107,
      parentId: 510,
      treePath: "0,500,510",
      name: "客户触达-记录",
      menuType: "B",
      routePath: "",
      perm: "customer:reach:create",
      visible: 1,
      sort: 7,
      icon: "",
    },
    {
      id: 5108,
      parentId: 510,
      treePath: "0,500,510",
      name: "触达偏好-查询",
      menuType: "B",
      routePath: "",
      perm: "customer:reach:preference:read",
      visible: 1,
      sort: 8,
      icon: "",
    },
    {
      id: 5109,
      parentId: 510,
      treePath: "0,500,510",
      name: "触达偏好-设置",
      menuType: "B",
      routePath: "",
      perm: "customer:reach:preference:update",
      visible: 1,
      sort: 9,
      icon: "",
    },
    {
      id: 5110,
      parentId: 510,
      treePath: "0,500,510",
      name: "黑名单-查询",
      menuType: "B",
      routePath: "",
      perm: "customer:blacklist:list",
      visible: 1,
      sort: 10,
      icon: "",
    },
    {
      id: 5111,
      parentId: 510,
      treePath: "0,500,510",
      name: "黑名单-拉黑",
      menuType: "B",
      routePath: "",
      perm: "customer:blacklist:create",
      visible: 1,
      sort: 11,
      icon: "",
    },
    {
      id: 5112,
      parentId: 510,
      treePath: "0,500,510",
      name: "黑名单-解除",
      menuType: "B",
      routePath: "",
      perm: "customer:blacklist:release",
      visible: 1,
      sort: 12,
      icon: "",
    },
    // ── MVP-WEB-04-03「客户合并 + 宠物转移审批」──
    // 合并入口在客户列表操作列；转移「发起」在客户详情抽屉「宠物」页签、
    // 转移「审批侧」为独立页面（520 转移审批：列表 + 审批/拒绝/撤销）。
    // 权限码单一事实源见 niulai-nest/src/customer/customer-permissions.constants.ts。
    {
      id: 5113,
      parentId: 510,
      treePath: "0,500,510",
      name: "客户合并",
      menuType: "B",
      routePath: "",
      perm: "customer:merge",
      visible: 1,
      sort: 13,
      icon: "",
    },
    {
      id: 520,
      parentId: 500,
      treePath: "0,500",
      name: "转移审批",
      menuType: "M",
      routeName: "CustomerTransfers",
      routePath: "transfers",
      component: "customer/transfers/index",
      alwaysShow: null,
      keepAlive: 1,
      visible: 1,
      sort: 2,
      icon: "el-icon-Switch",
    },
    {
      id: 5114,
      parentId: 520,
      treePath: "0,500,520",
      name: "转移申请-查询",
      menuType: "B",
      routePath: "",
      perm: "customer:transfer:list",
      visible: 1,
      sort: 1,
      icon: "",
    },
    {
      id: 5115,
      parentId: 520,
      treePath: "0,500,520",
      name: "转移申请-发起",
      menuType: "B",
      routePath: "",
      perm: "customer:transfer:create",
      visible: 1,
      sort: 2,
      icon: "",
    },
    {
      id: 5116,
      parentId: 520,
      treePath: "0,500,520",
      name: "转移申请-审批",
      menuType: "B",
      routePath: "",
      perm: "customer:transfer:approve",
      visible: 1,
      sort: 3,
      icon: "",
    },
    {
      id: 5117,
      parentId: 520,
      treePath: "0,500,520",
      name: "转移申请-拒绝",
      menuType: "B",
      routePath: "",
      perm: "customer:transfer:reject",
      visible: 1,
      sort: 4,
      icon: "",
    },
    {
      id: 5118,
      parentId: 520,
      treePath: "0,500,520",
      name: "转移申请-撤销",
      menuType: "B",
      routePath: "",
      perm: "customer:transfer:cancel",
      visible: 1,
      sort: 5,
      icon: "",
    },

    // ── 宠物（MVP-WEB-05-01「宠物列表与档案页」的业务菜单）────────────────────
    // 对象中心下的宠物模块：PRD《页面清单》路径 `pets` / `pets/:pet_id`。
    //   ① 列表：GET /pets（name 模糊 + 类型 / 主人 / 门店 / 芯片号精确 + 创建时间区间，
    //      服务端排序白名单 createdAt / name）；
    //   ② 档案页（5 页签：基本信息 / 健康 / 服务历史 / 消费记录 / Timeline）：
    //      GET /pets/:id，并**只读**消费 GET health / health/validity / timeline。
    //      该页为**跳页**（PRD《Web规范》§页面模式 1 的 480px 抽屉承载不下 5 页签 +
    //      Timeline）⇒ 作为「宠物」目录下的**隐藏子菜单**（visible=0）注册路由
    //      `/pets/:petId`，不进侧边栏。
    // 权限码单一事实源见 niulai-nest/src/pet/pet-permissions.constants.ts：
    // 档案 CRUD 四码（6101~6104）+ 只读消费三码（6105~6107）+ 标签库查询
    // （6108）与宠物打/取消标签（6109）+ **健康档案写三码（6110~6112，05-02 登记）**
    // + **体重记录写两码（6113~6114，05-03 登记）**
    // + **时间线写两码（6115~6116，05-04 登记）**
    // + **标签库写三码（6117~6119，05-05 登记）**。
    // MVP-WEB-05-05「行为标签管理」：宠物域新增**可见页** 630（routePath `tags`
    //   ⇒ `/pets/tags`，component `pet/tags/index`），承载标签库（租户级字典）CRUD。
    //   ⚠️ 与兄弟动态路由 620（`:petId`）**段数相同**，命中优先级依赖 vue-router
    //   「静态段优先」排序 ⇒ 真机断言「/pets/tags 落在标签页而非宠物详情」。
    {
      id: 600,
      parentId: 0,
      treePath: "0",
      name: "宠物",
      menuType: "C",
      routeName: "",
      routePath: "/pets",
      component: "Layout",
      redirect: "/pets",
      alwaysShow: null,
      keepAlive: null,
      visible: 1,
      sort: 4,
      icon: "el-icon-Star",
    },
    {
      id: 610,
      parentId: 600,
      treePath: "0,600",
      name: "宠物档案",
      menuType: "M",
      routeName: "Pets",
      routePath: "",
      component: "pet/pets/index",
      alwaysShow: null,
      keepAlive: 1,
      visible: 1,
      sort: 1,
      icon: "el-icon-Star",
    },
    {
      id: 6101,
      parentId: 610,
      treePath: "0,600,610",
      name: "宠物档案-查询",
      menuType: "B",
      routePath: "",
      perm: "pet:list",
      visible: 1,
      sort: 1,
      icon: "",
    },
    {
      id: 6102,
      parentId: 610,
      treePath: "0,600,610",
      name: "宠物档案-新增",
      menuType: "B",
      routePath: "",
      perm: "pet:create",
      visible: 1,
      sort: 2,
      icon: "",
    },
    {
      id: 6103,
      parentId: 610,
      treePath: "0,600,610",
      name: "宠物档案-修改",
      menuType: "B",
      routePath: "",
      perm: "pet:update",
      visible: 1,
      sort: 3,
      icon: "",
    },
    {
      id: 6104,
      parentId: 610,
      treePath: "0,600,610",
      name: "宠物档案-删除",
      menuType: "B",
      routePath: "",
      perm: "pet:delete",
      visible: 1,
      sort: 4,
      icon: "",
    },
    {
      id: 6105,
      parentId: 610,
      treePath: "0,600,610",
      name: "健康档案-查询",
      menuType: "B",
      routePath: "",
      perm: "pet:health:list",
      visible: 1,
      sort: 5,
      icon: "",
    },
    {
      id: 6106,
      parentId: 610,
      treePath: "0,600,610",
      name: "体重曲线-查询",
      menuType: "B",
      routePath: "",
      perm: "pet:weight:list",
      visible: 1,
      sort: 6,
      icon: "",
    },
    {
      id: 6107,
      parentId: 610,
      treePath: "0,600,610",
      name: "宠物时间线-查询",
      menuType: "B",
      routePath: "",
      perm: "pet:timeline:list",
      visible: 1,
      sort: 7,
      icon: "",
    },
    {
      id: 6108,
      parentId: 610,
      treePath: "0,600,610",
      name: "行为标签-查询",
      menuType: "B",
      routePath: "",
      perm: "pet:tag:list",
      visible: 1,
      sort: 8,
      icon: "",
    },
    {
      id: 6109,
      parentId: 610,
      treePath: "0,600,610",
      name: "宠物打标签",
      menuType: "B",
      routePath: "",
      perm: "pet:tag:assign",
      visible: 1,
      sort: 9,
      icon: "",
    },
    // MVP-WEB-05-02「健康档案页与到期提醒」：健康记录写路径（建档 / 更正 / 软删）
    {
      id: 6110,
      parentId: 610,
      treePath: "0,600,610",
      name: "健康档案-新增",
      menuType: "B",
      routePath: "",
      perm: "pet:health:create",
      visible: 1,
      sort: 10,
      icon: "",
    },
    {
      id: 6111,
      parentId: 610,
      treePath: "0,600,610",
      name: "健康档案-更正",
      menuType: "B",
      routePath: "",
      perm: "pet:health:update",
      visible: 1,
      sort: 11,
      icon: "",
    },
    {
      id: 6112,
      parentId: 610,
      treePath: "0,600,610",
      name: "健康档案-删除",
      menuType: "B",
      routePath: "",
      perm: "pet:health:delete",
      visible: 1,
      sort: 12,
      icon: "",
    },
    // MVP-WEB-05-03「体重曲线图」：体重记录写路径（记录 / 删除）
    {
      id: 6113,
      parentId: 610,
      treePath: "0,600,610",
      name: "体重记录-新增",
      menuType: "B",
      routePath: "",
      perm: "pet:weight:create",
      visible: 1,
      sort: 13,
      icon: "",
    },
    {
      id: 6114,
      parentId: 610,
      treePath: "0,600,610",
      name: "体重记录-删除",
      menuType: "B",
      routePath: "",
      perm: "pet:weight:delete",
      visible: 1,
      sort: 14,
      icon: "",
    },
    // MVP-WEB-05-04「Pet Timeline 组件与页面」：时间线**写**路径。
    //   补录（create）与冲正（revise）均为**追加语义**（TR-4：时间线不可编辑与删除，
    //   纠错以新事件冲正）⇒ 不属「删除」，故对齐「店长 ◐（可读可写）」口径一并授 manager；
    //   staff 只读，不授。ROOT 超管直放。
    {
      id: 6115,
      parentId: 610,
      treePath: "0,600,610",
      name: "时间线-补录",
      menuType: "B",
      routePath: "",
      perm: "pet:timeline:create",
      visible: 1,
      sort: 15,
      icon: "",
    },
    {
      id: 6116,
      parentId: 610,
      treePath: "0,600,610",
      name: "时间线-冲正",
      menuType: "B",
      routePath: "",
      perm: "pet:timeline:revise",
      visible: 1,
      sort: 16,
      icon: "",
    },
    {
      id: 620,
      parentId: 600,
      treePath: "0,600",
      name: "宠物详情",
      menuType: "M",
      routeName: "PetDetail",
      routePath: ":petId",
      component: "pet/pets/detail",
      alwaysShow: null,
      keepAlive: 1,
      visible: 0,
      sort: 2,
      icon: "",
    },
    // MVP-WEB-05-04：独立时间线页（PRD《页面清单》`Pet Timeline | pets/:pet_id/timeline | 全部角色`）。
    //   与 620 同属「宠物」目录下的**隐藏跳页路由**（visible=0，不进侧边栏）；
    //   routePath 两段 `:petId/timeline` ⇒ 生成 `/pets/:petId/timeline`，
    //   与 `/pets/:petId` 段数不同，无路由吞并冲突。
    {
      id: 621,
      parentId: 600,
      treePath: "0,600",
      name: "宠物时间线",
      menuType: "M",
      routeName: "PetTimeline",
      routePath: ":petId/timeline",
      component: "pet/pets/timeline",
      alwaysShow: null,
      keepAlive: 1,
      visible: 0,
      sort: 3,
      icon: "",
    },
    // MVP-WEB-05-05「行为标签管理」：行为标签库 = **租户级字典**（FR-4「咬人、吠叫、
    //   应激、社交友好、拆家等，标签驱动照护任务与房间分配约束」+ BR-2「含咬人的
    //   宠物强制分配独立房」）⇒ 需可维护（新增 / 改名 / 排序 / 停用 / 删除）。
    //   《页面清单》未登记该页；但门店域「房间资源 / 门店配置 / 门店日历」同为
    //   **未登记而落地的独立可见页**（relative routePath 挂模块目录）⇒ 本页照此范式。
    //   visible=1 进侧边栏（sort=2，紧随「宠物档案」；620/621 为 visible=0 不影响）；
    //   路径无动态段 ⇒ 非详情页，不进工作区标签区（踩坑 128 口径），与 PRD 第 6 条一致。
    {
      id: 630,
      parentId: 600,
      treePath: "0,600",
      name: "行为标签",
      menuType: "M",
      routeName: "BehaviorTags",
      routePath: "tags",
      component: "pet/tags/index",
      alwaysShow: null,
      keepAlive: 1,
      visible: 1,
      sort: 2,
      icon: "el-icon-PriceTag",
    },
    // 标签库**写**路径：新增 / 修改 / 删除（软删并清宠物关联 + 重算完整度）。
    //   授权口径对齐既有「店长 ◐（可读可写，不含删除）」：manager 授 6117/6118，
    //   **不授** 6119（删除）；ROOT 超管直放；staff 只读（仅 6108），不授本三码。
    {
      id: 6117,
      parentId: 630,
      treePath: "0,600,630",
      name: "行为标签-新增",
      menuType: "B",
      routePath: "",
      perm: "pet:tag:create",
      visible: 1,
      sort: 1,
      icon: "",
    },
    {
      id: 6118,
      parentId: 630,
      treePath: "0,600,630",
      name: "行为标签-修改",
      menuType: "B",
      routePath: "",
      perm: "pet:tag:update",
      visible: 1,
      sort: 2,
      icon: "",
    },
    {
      id: 6119,
      parentId: 630,
      treePath: "0,600,630",
      name: "行为标签-删除",
      menuType: "B",
      routePath: "",
      perm: "pet:tag:delete",
      visible: 1,
      sort: 3,
      icon: "",
    },

    // ── 预约域（MVP-WEB-06-01 预约列表与状态展示）─────────────────────────
    // 顶级目录「预约」+ 列表页（PRD《页面清单》路径 `bookings`，可见角色
    //   超管 / 总部 / 店长 / 前台 / 美容师 / 寄养员）。
    // ⚠️ 预约日历 `bookings/calendar`（06-03）与预约详情 `bookings/:booking_id`
    //   **不在本轮**：日历随 06-03 落独立子菜单；详情按《Web规范》§页面模式 1
    //   「详情一律右侧抽屉不跳页」以抽屉承载（与客户详情 04-02 同口径，不建路由），
    //   故本轮不种隐藏子菜单（对照 05-01/05-04：仅「详情跳页」才需要隐藏子菜单）。
    // 顶级目录 sort=5（紧随「宠物」4；实际侧边栏顺序由前端 6 组派生决定）。
    {
      id: 700,
      parentId: 0,
      treePath: "0",
      name: "预约",
      menuType: "C",
      routeName: "",
      routePath: "/bookings",
      component: "Layout",
      redirect: "/bookings",
      alwaysShow: null,
      keepAlive: null,
      visible: 1,
      sort: 5,
      icon: "el-icon-Calendar",
    },
    {
      id: 710,
      parentId: 700,
      treePath: "0,700",
      name: "预约列表",
      menuType: "M",
      routeName: "Bookings",
      routePath: "",
      component: "booking/bookings/index",
      alwaysShow: null,
      keepAlive: 1,
      visible: 1,
      sort: 1,
      icon: "el-icon-Tickets",
    },
    // 权限码（B 类按钮）。
    //   7101 只读（列表与详情共用；PRD《Booking API》「全部内部角色」可读）。
    //   7102 写（MVP-WEB-06-02 创建预约；PRD「创建预约 | 店长、前台、宠主」）——
    //     同时门控创建表单的参考数据端点（员工 / 服务项下拉）。
    //   7103~7109 状态流转（MVP-WEB-06-05 七个动作，逐码对应 PRD 端点清单的角色列）。
    //   容量预校验（06-04）无独立权限码，复用 7102（创建流程的前置校验）。
    {
      id: 7101,
      parentId: 710,
      treePath: "0,700,710",
      name: "预约-查询",
      menuType: "B",
      routePath: "",
      perm: "booking:list",
      visible: 1,
      sort: 1,
      icon: "",
    },
    {
      id: 7102,
      parentId: 710,
      treePath: "0,700,710",
      name: "预约-新建",
      menuType: "B",
      routePath: "",
      perm: "booking:create",
      visible: 1,
      sort: 2,
      icon: "",
    },
    // 状态流转权限码（MVP-WEB-06-05 改期 / 取消 / 爽约与状态流转）：七个动作**各立一码**
    //   —— PRD《Booking API》端点清单对每个动作分别标注了角色（confirm/checkin/no-show =
    //   店长·前台；start/complete 再加美容师；reschedule/cancel = 店长·前台·宠主），
    //   合成一个 booking:transition 会让「美容师可开始服务但不可确认预约」无法表达。
    //   与后端 `booking-permissions.constants.ts` 的 BookingPermissions 逐字对应。
    {
      id: 7103,
      parentId: 710,
      treePath: "0,700,710",
      name: "预约-确认",
      menuType: "B",
      routePath: "",
      perm: "booking:confirm",
      visible: 1,
      sort: 3,
      icon: "",
    },
    {
      id: 7104,
      parentId: 710,
      treePath: "0,700,710",
      name: "预约-到店登记",
      menuType: "B",
      routePath: "",
      perm: "booking:checkin",
      visible: 1,
      sort: 4,
      icon: "",
    },
    {
      id: 7105,
      parentId: 710,
      treePath: "0,700,710",
      name: "预约-开始服务",
      menuType: "B",
      routePath: "",
      perm: "booking:start",
      visible: 1,
      sort: 5,
      icon: "",
    },
    {
      id: 7106,
      parentId: 710,
      treePath: "0,700,710",
      name: "预约-完成服务",
      menuType: "B",
      routePath: "",
      perm: "booking:complete",
      visible: 1,
      sort: 6,
      icon: "",
    },
    {
      id: 7107,
      parentId: 710,
      treePath: "0,700,710",
      name: "预约-改期",
      menuType: "B",
      routePath: "",
      perm: "booking:reschedule",
      visible: 1,
      sort: 7,
      icon: "",
    },
    {
      id: 7108,
      parentId: 710,
      treePath: "0,700,710",
      name: "预约-取消",
      menuType: "B",
      routePath: "",
      perm: "booking:cancel",
      visible: 1,
      sort: 8,
      icon: "",
    },
    {
      id: 7109,
      parentId: 710,
      treePath: "0,700,710",
      name: "预约-标记爽约",
      menuType: "B",
      routePath: "",
      perm: "booking:no-show",
      visible: 1,
      sort: 9,
      icon: "",
    },
    // 预约日历（MVP-WEB-06-03）按《页面清单》「预约日历 | bookings/calendar | 超管、
    //   总部、店长、前台、美容师、寄养员」⇒ 独立页菜单 720（routePath "calendar" 挂目录
    //   700 之下 ⇒ 完整路径 `/bookings/calendar`，component 落 `views/booking/calendar/index.vue`）。
    //   ⚠️ **不新增权限码**：日历读端点（`GET /bookings/calendar`）与冲突检测端点
    //   （`POST /bookings/calendar/conflict-check`）都是**只读**（冲突检测只回「候选时段
    //   与哪些单重叠」的事实、不写库）⇒ 复用 7101（`booking:list`）—— 另立 `booking:calendar`
    //   会产出「日历能看、列表不能看」的怪权限格（详见 booking-permissions.constants.ts）。
    {
      id: 720,
      parentId: 700,
      treePath: "0,700",
      name: "预约日历",
      menuType: "M",
      routeName: "BookingCalendar",
      routePath: "calendar",
      component: "booking/calendar/index",
      alwaysShow: null,
      keepAlive: 1,
      visible: 1,
      sort: 2,
      icon: "el-icon-Calendar",
    },
    // ── 订单域（MVP-WEB-07-01 订单列表）───────────────────────────────────
    // 顶级目录「订单」+ 列表页（PRD《页面清单》路径 `orders`，可见角色
    //   超管 / 总部 / 店长 / 前台 / 财务 / 运营）。
    // 顶级目录 sort=6（紧随「预约」5）。
    {
      id: 800,
      parentId: 0,
      treePath: "0",
      name: "订单",
      menuType: "C",
      routeName: "",
      routePath: "/orders",
      component: "Layout",
      redirect: "/orders",
      alwaysShow: null,
      keepAlive: null,
      visible: 1,
      sort: 6,
      icon: "el-icon-Document",
    },
    {
      id: 810,
      parentId: 800,
      treePath: "0,800",
      name: "订单列表",
      menuType: "M",
      routeName: "Orders",
      routePath: "",
      component: "order/orders/index",
      alwaysShow: null,
      keepAlive: 1,
      visible: 1,
      sort: 1,
      icon: "el-icon-Tickets",
    },
    {
      id: 8101,
      parentId: 810,
      treePath: "0,800,810",
      name: "订单-查询",
      menuType: "B",
      routePath: "",
      perm: "order:list",
      visible: 1,
      sort: 1,
      icon: "",
    },
    // MVP-WEB-07-02 订单详情（PRD《页面清单》`订单详情 | orders/:order_id`）。
    //   四页签（概览 / 明细 / 支付记录 / 操作日志）+ 金额与明细表 + 审计时间序，
    //   宽度需求超出 PRD《Web规范》§页面模式 1 的 480px 抽屉承载 ⇒ 按「跳页」落地，
    //   作为「订单」目录下的**隐藏子菜单**（visible=0，不进侧边栏，踩坑 123）；
    //   routePath 单段 `:orderId` ⇒ 生成 `/orders/:orderId`，与 `/orders` 段数不同，
    //   无路由吞并冲突。读端点复用 `order:list`（对齐宠物档案 `GET /pets/:id` 口径），
    //   故**不新增权限码**、不新增 B 型按钮行。
    {
      id: 8102,
      parentId: 800,
      treePath: "0,800",
      name: "订单详情",
      menuType: "M",
      routeName: "OrderDetail",
      routePath: ":orderId",
      component: "order/orders/detail",
      alwaysShow: null,
      keepAlive: 1,
      visible: 0,
      sort: 2,
      icon: "",
    },
    // MVP-WEB-07-03 订单生成与组合明细。创建 / 编辑走**独立页**（PRD《Web规范》：
    // 明细组合宽度超抽屉承载，对齐 07-02 详情跳页口径）：
    //   - 8103 创建页 `/orders/new`（路径取 PRD《页面清单》「创建订单 | orders/new」原文；
    //     静态段，vue-router 4 评分高于 8102 的 `:orderId` 动态段，无吞并）；
    //   - 8104 编辑页 `/orders/:orderId/edit`（两段，与 8102 一段路由无冲突）。
    //   两路由共用 `order/orders/form` 组件（创建 / 编辑模式参数区分），visible=0 不进侧边栏。
    {
      id: 8103,
      parentId: 800,
      treePath: "0,800",
      name: "订单创建",
      menuType: "M",
      routeName: "OrderCreate",
      routePath: "new",
      component: "order/orders/form",
      alwaysShow: null,
      keepAlive: 1,
      visible: 0,
      sort: 3,
      icon: "",
    },
    {
      id: 8104,
      parentId: 800,
      treePath: "0,800",
      name: "订单编辑",
      menuType: "M",
      routeName: "OrderEdit",
      routePath: ":orderId/edit",
      component: "order/orders/form",
      alwaysShow: null,
      keepAlive: 1,
      visible: 0,
      sort: 4,
      icon: "",
    },
    // 写权限按钮（PRD《订单管理》验收要点：仅 draft / pending_payment 可编辑删除，
    // 状态守卫由后端 A0907/A0908 承载，权限码只管「有没有入口」）。
    // 授权口径：开单是前台 / 店长核心动作（《操作流程》「订单列表"新建订单"」入口）
    // ⇒ manager 全授（8105~8107）、staff 授创建（同 06-02 booking:create 边界口径）；
    // 编辑 / 删除归店长及以上。draft / pending_payment 删除 = 放弃草稿单（资金流未动），
    // 非档案类删除，**不沿**「店长不含删除」既有口径（4104/4204/5104/6104 等均为档案删除）。
    {
      id: 8105,
      parentId: 810,
      treePath: "0,800,810",
      name: "订单-新建",
      menuType: "B",
      routePath: "",
      perm: "order:create",
      visible: 1,
      sort: 2,
      icon: "",
    },
    {
      id: 8106,
      parentId: 810,
      treePath: "0,800,810",
      name: "订单-编辑",
      menuType: "B",
      routePath: "",
      perm: "order:update",
      visible: 1,
      sort: 3,
      icon: "",
    },
    {
      id: 8107,
      parentId: 810,
      treePath: "0,800,810",
      name: "订单-删除",
      menuType: "B",
      routePath: "",
      perm: "order:delete",
      visible: 1,
      sort: 4,
      icon: "",
    },
    // MVP-WEB-07-04 优惠与权益分摊：手动改价折扣权限点。
    // 授权口径取 PRD《权限规则》「关键操作权限矩阵 · 手动改价折扣 `order:order:discount`
    // 默认角色 = 店长」⇒ 授 manager，**不授 staff**（前台改价需店长权限，本期不做
    // 「申请-审批」二级流程，故 staff 连入口都不渲染；后端 PermissionGuard 为最终闸门）。
    {
      id: 8108,
      parentId: 810,
      treePath: "0,800,810",
      name: "订单-改价折扣",
      menuType: "B",
      routePath: "",
      perm: "order:discount",
      visible: 1,
      sort: 5,
      icon: "",
    },
    // MVP-WEB-07-05 履约联动（order_item 与状态流转）：开始服务 / 完成服务两个权限点。
    //   PRD《权限规则》「关键操作权限矩阵」**未单列**该两动作 ⇒ 取「履约执行」口径：
    //   开始 / 完成服务由门店执行侧操作（店长 + 美容师 / 寄养员）⇒ manager 与 staff 均授。
    //   ⚠️ 边界：本仓角色体系只有 manager/staff 两档，无法把「前台」从 staff 中裁出 ⇒
    //   staff 全体获得该两码，比 PRD 字面范围略宽（与 06-02 booking:create 既有口径一致）。
    {
      id: 8109,
      parentId: 810,
      treePath: "0,800,810",
      name: "订单-开始服务",
      menuType: "B",
      routePath: "",
      perm: "order:start",
      visible: 1,
      sort: 6,
      icon: "",
    },
    {
      id: 8110,
      parentId: 810,
      treePath: "0,800,810",
      name: "订单-完成服务",
      menuType: "B",
      routePath: "",
      perm: "order:complete",
      visible: 1,
      sort: 7,
      icon: "",
    },
  ];

  let menuCreated = 0;
  for (const menu of menuSeeds) {
    const existed = await prisma.sysMenu.findFirst({ where: { id: BigInt(menu.id) } });
    if (existed) continue;
    await prisma.sysMenu.create({
      data: {
        id: BigInt(menu.id),
        parentId: BigInt(menu.parentId),
        treePath: menu.treePath,
        name: menu.name,
        menuType: menu.menuType,
        routeName: menu.routeName ?? null,
        routePath: menu.routePath ?? null,
        component: menu.component ?? null,
        perm: menu.perm ?? null,
        alwaysShow: menu.alwaysShow ?? null,
        keepAlive: menu.keepAlive ?? null,
        visible: menu.visible ?? 1,
        sort: menu.sort ?? 0,
        icon: menu.icon ?? null,
        redirect: menu.redirect ?? null,
        createTime: new Date(),
        updateTime: new Date(),
      },
    });
    menuCreated += 1;
  }
  console.log(
    `[seed] 系统菜单：新建 ${menuCreated} 条，已存在 ${menuSeeds.length - menuCreated} 条（共 ${menuSeeds.length}）`
  );

  // 9.2 ROOT 角色菜单授权（sys_role_menu）
  //   ⚠️ MenuService.getRoutes 的「超级管理员返回全部菜单」旁路条件是 **userId === "1"**；
  //      本库 admin / tenant_admin 的 id 是 91 / 92，**不命中该旁路**，
  //      因此必须靠本表授权才能拿到菜单（否则 /menus/routes 仍返回 []）。
  const rootMenuRows = menuSeeds.map((menu) => ({ roleId: rootRole.id, menuId: BigInt(menu.id) }));
  const granted = await prisma.sysRoleMenu.createMany({ data: rootMenuRows, skipDuplicates: true });
  console.log(
    `[seed] ROOT(${rootRole.id}) 菜单授权：本次新增 ${granted.count} 条（应有 ${rootMenuRows.length} 条）`
  );

  // 9.3 自增序列同步：显式 id 插入不会推进 sys_menu_id_seq，不同步则后续新增菜单会撞号
  await prisma.$queryRawUnsafe(
    "SELECT setval(pg_get_serial_sequence('sys_menu','id'), GREATEST((SELECT COALESCE(MAX(id), 1) FROM sys_menu), 1))"
  );
  // ─────────────────────────────────────────────
  // 10. 用户管理演示数据（非 ROOT 角色 + 普通用户，真实入库）
  // ─────────────────────────────────────────────
  // 背景：`UserService.buildUserWhere()` 含一条硬过滤「ROOT 角色用户不在用户列表中展示」
  //   （模板原行为，防止超管被误删）。而第 1~7 段只创建了 admin / tenant_admin 两个
  //   **均挂 ROOT** 的账号 ⇒「系统管理 → 用户管理」列表恒为 0 条
  //   （连库复现：sys_user 2 条、sys_role 仅 ROOT、按列表口径过滤后可见 0 行）。
  //   本段补齐**真实入库**的非 ROOT 角色与用户，使列表有数据可管，
  //   同时为后续「角色权限分配 / 员工账号绑定」提供演示素材（非 mock）。
  // 幂等键：sys_role.code / sys_user.username / sys_role_menu(role_id, menu_id)。
  //
  // dataScope 见 niulai-nest/src/common/enums/data-scope.enum.ts：
  //   1=ALL / 2=DEPT_AND_SUB / 3=DEPT / 4=SELF / 5=CUSTOM
  // 菜单 id 见上方 menuSeeds：400 门店目录 / 410 门店管理(+4101~4104 按钮)
  //   / 420 房间资源(+4201~4204 按钮) / 430 门店配置 / 440 门店日历
  //   （430 / 440 复用 store:list·update，**无按钮级行**）
  //   / 500 客户目录 / 510 客户列表(+5101~5113 按钮) / 520 转移审批(+5114~5118 按钮)
  //   / 600 宠物目录 / 610 宠物档案(+6101~6112 按钮) / 620 宠物详情（隐藏路由 `/pets/:petId`）
  type DemoRoleSeed = {
    code: string;
    name: string;
    sort: number;
    dataScope: number;
    menuIds: number[];
  };

  const demoRoleSeeds: DemoRoleSeed[] = [
    {
      code: "manager",
      name: "门店经理",
      sort: 2,
      dataScope: 3, // DEPT：本部门数据
      // 业务线可读可写，**不含删除**（4104 门店删除 / 4204 房间删除 / 5104 客户删除）
      // 客户详情子能力（MVP-WEB-04-02）按《权限规则》「客户管理 店长 ◐（可读可写）」
      // + PRD《客户管理》BR-2「黑名单操作需店长以上权限」⇒ 5105~5112 全授（含拉黑/解除；
      // 解除为状态流转 + 必填原因，非删除语义，故不受「不含删除」约束）。
      // 客户合并与转移审批（MVP-WEB-04-03）同按「店长 ◐」⇒ 5113（合并）+ 520 页面
      // 及其 5114~5118（转移查询/发起/审批/拒绝/撤销）全授；合并虽不可逆，但为
      // 数据归并（非删除），且 PRD 异常场景 5「操作人审批确认」要求由店长执行。
      // 宠物（MVP-WEB-05-01）按「宠物管理 店长 ◐（可读可写）」⇒ 档案 CRUD 授
      // 查/增/改（6101~6103，**不含** 6104 删除）+ 只读消费（6105~6107）+
      // 标签库查询 6108 + 宠物打标签 6109；620 为跳页路由（须授权才注册）。
      // 健康档案（MVP-WEB-05-02）同按「店长 ◐」⇒ 新增/更正 6110/6111 授出；
      // 6112（健康档案-删除）**不授** —— 对齐「店长不含删除」既有口径（6104 同）。
      // 时间线（MVP-WEB-05-04）补录/冲正 6115/6116 均**授出**（追加语义，TR-4 明确
      // 「不可编辑与删除，纠错以新事件冲正」⇒ 不属删除）；独立时间线页 621 授出。
      // 标签库（MVP-WEB-05-05）按「店长 ◐」⇒ 新增/修改 6117/6118 授出 + 管理页
      // 630（须授页面菜单才注册路由）；**不授** 6119（删除，同「店长不含删除」口径）。
      // 预约（MVP-WEB-06-01）按《页面清单》「预约列表 | bookings | 超管、总部、店长、
      // 前台、美容师、寄养员」⇒ 目录 700 + 列表页 710 + 只读码 7101（booking:list）授出；
      // 预约创建（MVP-WEB-06-02）按 PRD《Booking API》「创建预约 | 店长、前台、宠主」
      // ⇒ 7102（booking:create）授出（创建是非删除写入，不受「店长不含删除」约束）。
      // 预约日历（MVP-WEB-06-03）按《页面清单》「预约日历 | bookings/calendar」可见角色含
      // 店长 ⇒ 页面菜单 720 授出（读端点复用 7101，无新增权限码）。
      // 预约状态流转（MVP-WEB-06-05）按 PRD《Booking API》端点清单的角色列，店长对
      // 七个动作全有权限 ⇒ 7103~7109 全授（均为状态流转，非删除，不受「店长不含删除」约束）。
      menuIds: [
        400, 410, 4101, 4102, 4103, 420, 4201, 4202, 4203, 430, 440, 500, 510, 5101, 5102, 5103,
        5105, 5106, 5107, 5108, 5109, 5110, 5111, 5112, 5113, 520, 5114, 5115, 5116, 5117, 5118,
        600, 610, 6101, 6102, 6103, 6105, 6106, 6107, 6108, 6109, 6110, 6111, 6113, 6115, 6116, 620,
        621, 630, 6117, 6118, 700, 710, 7101, 7102, 720, 7103, 7104, 7105, 7106, 7107, 7108, 7109,
        800, 810, 8101, 8102, 8103, 8104, 8105, 8106, 8107, 8108, 8109, 8110,
      ],
    },
    {
      code: "staff",
      name: "门店员工",
      sort: 3,
      dataScope: 4, // SELF：仅本人数据
      // 业务线只读
      // 宠物（MVP-WEB-05-01）只授查询（6101）+ 只读消费（6105~6107）+ 标签库查询
      // （6108）+ 跳页路由 620/621（档案页与独立时间线页；621 为 05-04 补），
      // **不含**任何写入口（6102~6104 / 6109 / 6115 / 6116）。
      // 行为标签**管理页** 630 及其写码 6117~6119（MVP-WEB-05-05）属配置类页面
      // ⇒ 限店长及以上，staff **不授**（含不授只读的 630，标签释义对员工无必要）。
      // 预约（MVP-WEB-06-01）：PRD《页面清单》把预约列表 / 详情的可见角色含
      // 「美容师、寄养员、前台」⇒ staff **授** 700/710/7101（只读）。
      // 预约创建（MVP-WEB-06-02）：PRD 创建角色为「店长、**前台**、宠主」，而
      // 前台在 seed 里隶属 staff 角色（reception01）⇒ 7102（booking:create）一并授出。
      // ⚠️ 边界：本仓角色体系只有 manager/staff 两档，无法把「前台」从「美容师 /
      // 寄养员」中单独裁出 ⇒ staff 全体获得创建权，比 PRD 字面范围略宽，记为边界。
      // ⚠️ 数据范围：PRD「美容师、寄养员仅可见本人相关数据」属**数据权限三级**范畴，
      // 由 @DataPermission（现值覆盖系统域 SysUser/SysDept）统一承载；本轮与
      // customer/room/pet 各域同口径**不在此处裁剪**（项目级待收口，记为边界）。
      // 预约日历（MVP-WEB-06-03）：可见角色含「美容师、寄养员、前台」⇒ 页面菜单 720
      // 一并授出（读端点复用 7101，无新增权限码；冲突检测为只读查询，不涉写权限）。
      // 预约状态流转（MVP-WEB-06-05）：PRD 端点清单里 confirm/checkin/no-show 含「前台」、
      // start/complete 再加「美容师」、reschedule/cancel 含「前台」⇒ staff 全体授 7103~7109。
      // ⚠️ 边界：本仓角色只有 manager/staff 两档，无法把「前台 / 美容师 / 寄养员」拆开，
      //   故 staff 获得的范围比 PRD 字面略宽（与 06-02 创建码的既有边界口径一致）。
      //   PRD 里真正需要「店长独有」的是**改期累计超限的二次确认**，那条已按角色码
      //   （manager）单独裁决，不依赖权限码粒度。
      // 订单生成与组合明细（MVP-WEB-07-03）：开单是前台核心动作（《操作流程》
      // 「订单列表"新建订单"」入口）⇒ 创建页 8103 + 创建码 8105 授出（同 06-02
      // booking:create 的既有边界口径）；编辑 / 删除归店长及以上，8104/8106/8107 不授。
      // 优惠与权益分摊（MVP-WEB-07-04）：PRD《权限规则》「手动改价折扣
      // `order:order:discount` 默认角色 = 店长」⇒ 8108（order:discount）**不授 staff**
      // （改价直接改变应收金额，属资金敏感动作；本期无「申请-审批」二级流程，
      //  故前端连入口都不渲染，后端 PermissionGuard 为最终闸门）。
      // 履约联动（MVP-WEB-07-05）：开始 / 完成服务由门店执行侧操作（店长 + 美容师 /
      // 寄养员）⇒ 8109（order:start）/ 8110（order:complete）**授 staff**。
      // ⚠️ 边界：本仓角色只有 manager/staff 两档，无法把「前台」从 staff 中裁出 ⇒
      //   staff 获得的范围比 PRD 字面略宽（与 06-02 创建码的既有边界口径一致）。
      menuIds: [
        400, 410, 4101, 420, 4201, 430, 440, 600, 610, 6101, 6105, 6106, 6107, 6108, 620, 621, 700,
        710, 7101, 7102, 720, 7103, 7104, 7105, 7106, 7107, 7108, 7109,
        800, 810, 8101, 8102, 8103, 8105, 8109, 8110,
      ],
    },
  ];

  const demoRoleIdByCode = new Map<string, bigint>();
  for (const roleSeed of demoRoleSeeds) {
    let roleRow = await prisma.sysRole.findFirst({ where: { code: roleSeed.code, isDeleted: 0 } });
    if (!roleRow) {
      roleRow = await prisma.sysRole.create({
        data: {
          name: roleSeed.name,
          code: roleSeed.code,
          sort: roleSeed.sort,
          status: 1,
          dataScope: roleSeed.dataScope,
          isDeleted: 0,
        },
      });
      console.log(
        `[seed] 角色「${roleSeed.name}」已创建（id=${roleRow.id}，dataScope=${roleSeed.dataScope}）`
      );
    } else {
      console.log(`[seed] 角色「${roleSeed.name}」已存在（id=${roleRow.id}），跳过`);
    }
    demoRoleIdByCode.set(roleSeed.code, roleRow.id);
  }

  // 10.1 普通角色菜单授权（只授业务线，**不含「系统管理」目录** ⇒ 演示真实 RBAC 差异）
  let demoRoleMenuCreated = 0;
  for (const roleSeed of demoRoleSeeds) {
    const roleId = demoRoleIdByCode.get(roleSeed.code);
    if (!roleId) throw new Error(`[seed] 角色不存在：${roleSeed.code}`);
    const grantedRoleMenu = await prisma.sysRoleMenu.createMany({
      data: roleSeed.menuIds.map((menuId) => ({ roleId, menuId: BigInt(menuId) })),
      skipDuplicates: true,
    });
    demoRoleMenuCreated += grantedRoleMenu.count;
  }
  console.log(`[seed] 普通角色菜单授权：本次新增 ${demoRoleMenuCreated} 条`);

  // 10.2 演示用户 ×3（归属演示租户，密码统一 123456）
  //   ⚠️ 必须回填 tenant_id = 演示租户：用户列表走 prisma.scoped ⇒ 按登录人 tenantId 过滤，
  //      漏填则列表仍看不到（admin 的 tenant_id 为 null，属平台账号，不参与租户列表）
  const demoUserSeeds: Array<{
    username: string;
    nickname: string;
    gender: number;
    roleCode: string;
  }> = [
    { username: "store_manager", nickname: "林店长", gender: 2, roleCode: "manager" },
    { username: "groomer01", nickname: "周美容师", gender: 2, roleCode: "staff" },
    { username: "reception01", nickname: "吴前台", gender: 1, roleCode: "staff" },
  ];

  const demoUserIds: bigint[] = [];
  for (const userSeed of demoUserSeeds) {
    let userRow = await prisma.sysUser.findFirst({
      where: { username: userSeed.username, isDeleted: 0 },
    });
    if (!userRow) {
      const hash = await bcrypt.hash("123456", 10);
      userRow = await prisma.sysUser.create({
        data: {
          username: userSeed.username,
          nickname: userSeed.nickname,
          gender: userSeed.gender,
          password: hash,
          deptId: hq.id,
          tenantId: demoTenant.id,
          status: 1,
          isDeleted: 0,
        },
      });
      console.log(
        `[seed] 用户「${userSeed.username}」已创建（id=${userRow.id}，tenant_id=${demoTenant.id}）`
      );
    } else {
      console.log(`[seed] 用户「${userSeed.username}」已存在（id=${userRow.id}），跳过`);
    }
    demoUserIds.push(userRow.id);

    const roleId = demoRoleIdByCode.get(userSeed.roleCode);
    if (!roleId) throw new Error(`[seed] 角色不存在：${userSeed.roleCode}`);
    await prisma.sysUserRole.upsert({
      where: { userId_roleId: { userId: userRow.id, roleId } },
      update: {},
      create: { userId: userRow.id, roleId },
    });
  }
  console.log(`[seed] 演示用户 ×${demoUserSeeds.length} 关联角色完成：${demoUserIds.join(", ")}`);

  // 10.3 回读：按「用户管理」列表的真实口径（本租户 + 排除 ROOT）确认确有可见行
  const rootUserIdsInList = (
    await prisma.sysUserRole.findMany({
      where: { roleId: rootRole.id },
      select: { userId: true },
    })
  ).map((row) => row.userId);
  const listableUserCount = await prisma.sysUser.count({
    where: {
      isDeleted: 0,
      tenantId: demoTenant.id,
      id: { notIn: rootUserIdsInList },
    },
  });
  console.log(
    `[seed] 用户列表可见性回读（演示租户 + 排除 ROOT）：${listableUserCount} 条（预期 ${demoUserSeeds.length}）`
  );

  const [menuCount, roleMenuCount] = await Promise.all([
    prisma.sysMenu.count(),
    prisma.sysRoleMenu.count(),
  ]);
  console.log(
    `[seed] 菜单回读：sys_menu ${menuCount} 条、sys_role_menu ${roleMenuCount} 条（自增序列已同步至 ${menuCount}）`
  );

  console.log("");
  console.log(
    "[seed] ✅ 系统域 + 演示租户 + 业务域 + 系统菜单种子就绪 —— 账号：admin / 123456（平台）、tenant_admin / 123456（租户）、store_manager·groomer01·reception01 / 123456（门店）"
  );
}

main()
  .catch((err) => {
    console.error("[seed] ❌ 失败：", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
