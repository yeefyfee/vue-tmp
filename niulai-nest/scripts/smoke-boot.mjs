/**
 * 启动冒烟：真实拉起 `dist/main`，验证 Nest 依赖注入接线与 Prisma 探活。
 *
 * 为什么需要它：`tsc` 只查类型，各模块的 `verify-*.ts` 直接 new 出 service，
 * 都**不会**经过 Nest 的 DI 容器。像「APP_INTERCEPTOR 注入了 PrismaService」
 * 这类接线错误只在真正 bootstrap 时暴露。
 *
 * PeluVida 数据访问基线是 PostgreSQL + Prisma，连接串走 `DATABASE_URL`（`.env.dev` / `.env.prod`）。
 * 历史说明：PEL-10 过渡期曾在此处给子进程注入 `MYSQL_*`（当时还有模块依赖 TypeORM），
 * 现在 TypeORM / mysql2 已从依赖中摘除，**无需再注入任何数据库环境变量**。
 *
 * 运行：node scripts/smoke-boot.mjs
 * 退出码：启动成功 0；未在时限内就绪或进程异常退出为 1
 */
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const READY_PATTERNS = [/Nest application successfully started/];
const FAIL_PATTERNS = [/Error:/, /ERROR/, /Cannot find module/, /Nest can't resolve/];
const TIMEOUT_MS = 90_000;

const entry = path.join(process.cwd(), "dist", "main.js");

const child = spawn(process.execPath, [entry], {
  cwd: process.cwd(),
  env: { ...process.env },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
let settled = false;

function finish(code, reason) {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  try {
    child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
  // 兜底：确保进程退出，避免占用 8000 端口
  setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }, 1500).unref?.();

  const lines = output.split(/\r?\n/).filter(Boolean);
  // 错误行必须**完整**输出：截断会漏掉真正的接线问题
  const errorLines = lines.filter((l) =>
    /Error:|ERROR|Cannot find module|Nest can't resolve/i.test(l)
  );
  // 常规信息只挑关键几行，避免刷屏
  console.log(
    lines.filter((l) => /Prisma|successfully started/i.test(l) && !/Mapped \{/.test(l)).join("\n")
  );
  // 路由映射做**汇总**而不是截断末 40 行：
  // 之前 slice(-40) 会把最早初始化的模块（auth/user/menu/role/dept…）整个挤掉，
  // 于是「以为没映射」和「真的没映射」无法区分 —— 正是本脚本要抓的那类问题。
  const resolverLines = lines.filter((l) => /RoutesResolver\]/.test(l));
  const mappedRoutes = lines.filter((l) => /Mapped \{/.test(l));
  console.log(
    `[smoke-boot] 已初始化控制器 ${resolverLines.length} 个，映射路由 ${mappedRoutes.length} 条`
  );
  console.log(
    resolverLines
      .map((l) => `  - ${l.replace(/^.*RoutesResolver\]\s*/, "")}`)
      .join("\n")
  );
  if (errorLines.length) console.log(errorLines.join("\n"));
  console.log(`\n[smoke-boot] ${reason} (exit=${code})`);

  if (code === 0) {
    const ok = READY_PATTERNS.every((re) => re.test(output));
    const failed = FAIL_PATTERNS.some((re) => re.test(output)) && !ok;
    console.log(
      ok && !failed
        ? "[smoke-boot] ✅ 启动成功，DI 接线与 Prisma 探活正常"
        : "[smoke-boot] ❌ 未检测到就绪标志"
    );
    process.exit(ok && !failed ? 0 : 1);
  }
  process.exit(1);
}

child.stdout.on("data", (d) => {
  output += d.toString();
  if (READY_PATTERNS.every((re) => re.test(output))) {
    finish(0, "检测到启动就绪");
  }
});
child.stderr.on("data", (d) => {
  output += d.toString();
});
child.on("exit", (code) => finish(code ?? 1, "进程自行退出"));

const timer = setTimeout(() => finish(1, `超时未就绪（${TIMEOUT_MS}ms）`), TIMEOUT_MS);
