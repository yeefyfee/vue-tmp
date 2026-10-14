/**
 * 经营工作台（MVP-WEB-03-01 / 03-03）返回契约
 *
 * 契约来源：PRD《页面功能》§5.2 首页：经营工作台 + 详细设计《经营工作台》。
 *
 * 🔴 设计口径（`available` 语义）：工作台承载的指标大多依赖**尚未开发**的业务模块
 * （订单 07 / 支付 14 / 预约 06 / 寄养 09 / 库存）。为避免「未知被渲染成 0」的
 * 误导（用户看到 `今日营业额 0` 会以为真的没收入），本契约把每个指标包成
 * `DashboardMetric`：
 *  - `available: true`  ⇒ `value` 是真实值；
 *  - `available: false` ⇒ `value` 恒为 `null`，前端渲染 `--` + `note` 口径提示。
 *
 * ⚠️ 不在本服务内做的事：不伪造占位数字、不用 mock；未上线的数据源一律显式声明
 * 接入计划（`note`）。
 *
 * 数据聚合层（MVP-WEB-03-03）：把**已上线**的数据源真实并入选三列卡片 ——
 *  - 今日数据：在店宠物（room）/ 待处理（todos 合计）；
 *  - 今天的工作：**宠物时间线事件流**（`TimelineEvent` 当日切片，P0-06-06）；
 *  - 需要你处理：**健康到期预警**（health）+**宠物转移待审批**（transfer）。
 * 未上线源的指标仍以 `available: false` + 口径说明占位，待对应模块上线并入。
 */

/** 指标数据源标识（与前端口径 tooltip 共用；枚举收口避免中文散落） */
export type DashboardMetricSource =
  /** 订单模块（MVP-WEB-07，未上线） */
  | "order"
  /** 支付/收银模块（MVP-WEB-14，未上线） */
  | "payment"
  /** 寄养入住（MVP-WEB-09，未上线） */
  | "stay"
  /** 预约模块（MVP-WEB-06，未上线） */
  | "booking"
  /** 房间资源（P0-04-03，已上线） */
  | "room"
  /** 宠物健康档案（P0-06，已上线） */
  | "health"
  /** 站内咨询（MVP-WEB-13，未上线） */
  | "consult"
  /** 商品库存（MVP-WEB-12，未上线） */
  | "inventory"
  /** 宠物时间线事件流（P0-06-06，已上线） */
  | "timeline";

/**
 * 指标可用性包装
 *
 * 统一的「值 + 可用性 + 来源 + 口径」四元组，供前端 `StatCard` 直接消费。
 */
export interface DashboardMetric {
  /** 指标值；`null` = 数据源未上线（前端渲染 `--`） */
  value: number | null;
  /** 值是否真实可用（false ⇒ 依赖模块未上线，见 `note`） */
  available: boolean;
  /** 数据来源标识 */
  source: DashboardMetricSource;
  /** 口径说明 —— 前端作为悬浮 tooltip 展示（PRD《数据口径与性能约定》第 1 条） */
  note: string;
}

/** 今日数据四指标（PRD：今日营业额 / 今日订单 / 在店宠物 / 待处理） */
export interface DashboardTodayMetrics {
  /** 今日营业额（口径：当日 `payment.status = success` 的金额汇总，单位「分」） */
  revenue: DashboardMetric;
  /** 今日订单数 */
  orderCount: DashboardMetric;
  /** 在店宠物数 */
  boardingPetCount: DashboardMetric;
  /** 待处理数（聚合待确认订单 / 待回复咨询 / 异常照护 / 库存预警） */
  pendingCount: DashboardMetric;
}

/**
 * 「今天的工作」时间线条目
 *
 * 数据来源：**宠物时间线事件流**（`TimelineEvent`，P0-06-06）的当日切片 ——
 * 所有业务动作（入驻 / 离店 / 喂养 / 洗护 / 医疗 …）经领域事件写入后在此按
 * 时间正序呈现。PRD 原口径的「预约排期 / 退房 / 接送」切片依赖 Booking（06）
 * 与 Stay（09），两模块上线后并入同一列表。
 */
export interface DashboardTimelineItem {
  /** 发生时刻（ISO 8601；前端按本地时区渲染 `HH:mm`） */
  time: string;
  /**
   * 事件类型：与 `TimelineEvent.eventType` 值域一致
   * （1 入驻 / 2 离店 / 3 喂养 / 4 洗护 / 5 医疗 / 6 体重 / 7 照片 / 8 系统）
   */
  eventType: number;
  /** 宠物名 */
  petName: string;
  /** 服务项 / 事由（事件名语义化的摘要） */
  serviceName: string;
  /** 负责人（操作人昵称；系统事件为「系统」） */
  ownerName: string;
  /** 超时未开始（PRD：超时未开始条目高亮）。已发生事件恒 false；未来排期并入后启用 */
  overdue: boolean;
}

/** 「今天的工作」卡数据 */
export interface DashboardTimeline {
  available: boolean;
  source: DashboardMetricSource;
  note: string;
  items: DashboardTimelineItem[];
}

/**
 * 「需要你处理」待办类型
 *
 *  - `health`：宠物健康到期预警（疫苗 / 驱虫）—— 已上线（P0-06）；
 *  - `transfer`：宠物转移待审批（`PetTransferRequest.status = 1`）—— 已上线（P0-05-03）。
 */
export type DashboardTodoKind = "health" | "transfer";

/**
 * 「需要你处理」待办条目
 *
 * 按优先级（severity + 到期紧迫度）排序；每条可带 `route`（目标页上线后可点击直达）。
 * 首期产出**当前可算**的两类：健康到期预警（异常照护类）与宠物转移待审批；
 * 其余三类（待确认订单 / 待回复咨询 / 库存预警）待对应模块上线后并入。
 */
export interface DashboardTodoItem {
  /** 稳定标识（前端 list key） */
  key: string;
  /** 待办类型（判别字段：前端据此渲染不同的元信息行） */
  kind: DashboardTodoKind;
  /** 分类：vaccine 疫苗 / deworm 驱虫 / transfer 转移审批（前端 i18n 键后缀） */
  category: string;
  /** 宠物 id */
  petId: string;
  /** 宠物名 */
  petName: string;
  /** 严重度：high 已逾期或 ≤3 天 / medium ≤7 天 / low ≤14 天 */
  severity: "high" | "medium" | "low";
  /** 目标路由（页面未上线时为 null，前端不渲染跳转） */
  route: string | null;
  /** `kind=health` 专属：到期日（yyyy-MM-dd） */
  dueDate?: string;
  /** `kind=health` 专属：距到期天数（负数 = 已逾期） */
  dueInDays?: number;
  /** `kind=transfer` 专属：申请提交时刻（ISO 8601） */
  submittedAt?: string;
}

/** 「需要你处理」卡数据 */
export interface DashboardTodos {
  available: boolean;
  note: string;
  items: DashboardTodoItem[];
}

/**
 * 增量轮询公共字段（MVP-WEB-03-02）
 *
 * 工作台每 60s 携带上次 `revision` 请求 `GET /dashboard/overview?since=<revision>`：
 *  - 服务端先做**轻量**指纹比对（3 张表的 `max(updated_at)` + 行数），未变化则
 *    直接返回 `{ changed: false }`（省去待办装配与宠物回查，即「增量」）；
 *  - 变化时才回全量读数（`{ changed: true }`）。
 *
 * `revision` 是可比较的不透明指纹字符串，前端只做「相等即未变」判断，不解析语义。
 */
export interface DashboardOverviewMeta {
  /** 本次读数相比客户端 `since` 是否发生变化（无 `since` 时恒为 true） */
  changed: boolean;
  /** 当前聚合范围的数据指纹（HTTP 缓存 / 增量轮询用，不透明） */
  revision: string;
  /** 生成时刻（ISO 8601，供前端显示「更新于」） */
  generatedAt: string;
  /** 聚合范围：当前门店上下文（无门店上下文时为 null = 租户级） */
  scope: { storeId: string | null };
}

/** 数据未变化时的轻量响应（只回指纹，不含业务读数） */
export interface DashboardOverviewUnchanged extends DashboardOverviewMeta {
  changed: false;
}

/** 经营工作台总览响应体（数据有变化 / 首次拉取） */
export interface DashboardOverview extends DashboardOverviewMeta {
  changed: true;
  /** 今日数据 */
  today: DashboardTodayMetrics;
  /** 今天的工作 */
  timeline: DashboardTimeline;
  /** 需要你处理 */
  todos: DashboardTodos;
}

/** 总览端点响应（按 `changed` 判别：false 走轻量分支，true 走全量分支） */
export type DashboardOverviewResponse = DashboardOverview | DashboardOverviewUnchanged;
