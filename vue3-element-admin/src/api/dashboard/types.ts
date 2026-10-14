/**
 * 经营工作台类型定义（MVP-WEB-03-01 / 03-03）
 *
 * 与后端 `niulai-nest/src/dashboard/dashboard.types.ts` 契约一一对应
 * （字段名保持后端原始命名，见 PRD《组件》§数据表格）。
 *
 * 🔴 `available` 语义：`false` 表示该指标依赖的业务模块尚未上线，`value` 恒为 `null`，
 * 页面渲染 `--` 并把 `note` 作为口径提示 —— **不得把 null 当 0 展示**
 * （用户看到「今日营业额 0」会误以为真的没有收入）。
 */

/** 指标数据源标识 */
export type DashboardMetricSource =
  | "order"
  | "payment"
  | "stay"
  | "booking"
  | "room"
  | "health"
  | "consult"
  | "inventory"
  | "timeline";

/** 指标可用性包装 */
export interface DashboardMetric {
  /** 指标值；`null` = 数据源未上线 */
  value: number | null;
  /** 值是否真实可用 */
  available: boolean;
  /** 数据来源标识 */
  source: DashboardMetricSource;
  /** 口径说明（悬浮 tooltip） */
  note: string;
}

/** 今日数据四指标 */
export interface DashboardTodayMetrics {
  /** 今日营业额（单位：分） */
  revenue: DashboardMetric;
  /** 今日订单数 */
  orderCount: DashboardMetric;
  /** 在店宠物数 */
  boardingPetCount: DashboardMetric;
  /** 待处理数 */
  pendingCount: DashboardMetric;
}

/** 「今天的工作」时间线条目 */
export interface DashboardTimelineItem {
  /** 发生时刻（ISO 8601；前端按本地时区渲染 `HH:mm`） */
  time: string;
  /** 事件类型（`TimelineEvent.eventType`：1 入驻 / 2 离店 / 3 喂养 / 4 洗护 / 5 医疗 / 6 体重 / 7 照片 / 8 系统） */
  eventType: number;
  /** 宠物名 */
  petName: string;
  /** 服务项 / 事由 */
  serviceName: string;
  /** 负责人（操作人昵称；系统事件为「系统」） */
  ownerName: string;
  /** 超时未开始（已发生事件恒 false） */
  overdue: boolean;
}

/** 「今天的工作」卡数据 */
export interface DashboardTimeline {
  available: boolean;
  source: DashboardMetricSource;
  note: string;
  items: DashboardTimelineItem[];
}

/** 「需要你处理」待办类型 */
export type DashboardTodoKind = "health" | "transfer";

/** 「需要你处理」待办条目 */
export interface DashboardTodoItem {
  /** 稳定标识（list key） */
  key: string;
  /** 待办类型（判别字段：前端据此渲染不同元信息行） */
  kind: DashboardTodoKind;
  /** 分类：vaccine 疫苗 / deworm 驱虫 / transfer 转移审批（i18n 键后缀） */
  category: string;
  petId: string;
  petName: string;
  severity: "high" | "medium" | "low";
  /** 目标路由（页面未上线时为 null） */
  route: string | null;
  /** `kind=health` 专属：到期日 yyyy-MM-dd */
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
 * 与后端 `dashboard.types.ts` 的 `DashboardOverviewMeta` 一一对应：工作台每 60s
 * 携带上次 `revision` 请求 `?since=<revision>`，服务端指纹未变即回 `changed:false`
 * （只含元信息，无业务读数），变化时才回全量。
 */
export interface DashboardOverviewMeta {
  /** 本次相比客户端 `since` 是否变化（首次拉取无 `since` 时为 true） */
  changed: boolean;
  /** 数据指纹（不透明字符串，前端只做相等判断，不解析） */
  revision: string;
  /** 生成时刻（ISO 8601） */
  generatedAt: string;
  /** 聚合范围（storeId 为 null = 租户级） */
  scope: { storeId: string | null };
}

/** 数据未变化时的轻量响应（无业务读数） */
export interface DashboardOverviewUnchanged extends DashboardOverviewMeta {
  changed: false;
}

/** 经营工作台总览响应体（首次拉取 / 数据有变化） */
export interface DashboardOverview extends DashboardOverviewMeta {
  changed: true;
  today: DashboardTodayMetrics;
  timeline: DashboardTimeline;
  todos: DashboardTodos;
}

/** 总览端点响应（按 `changed` 判别） */
export type DashboardOverviewResponse = DashboardOverview | DashboardOverviewUnchanged;
