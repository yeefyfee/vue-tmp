<template>
  <div class="page-container">
    <el-card class="page-content" shadow="never">
      <!-- ── 头部（auto）：返回 / 订单号 + 状态徽章 ──────────────────────── -->
      <div class="order-detail__head">
        <div class="order-detail__head-left">
          <el-button
            link
            class="order-detail__back"
            data-testid="order-detail-back"
            @click="goBack"
          >
            <el-icon><ArrowLeft /></el-icon>
            {{ t("order.detail.back") }}
          </el-button>
          <span class="order-detail__title">
            {{ detail?.order.orderNo ?? t("order.detail.title") }}
          </span>
          <el-tag
            v-if="detail"
            :type="orderStatusTagType(detail.order.status)"
            size="default"
            class="order-detail__status"
            data-testid="order-detail-status"
          >
            {{ t(orderStatusLabelKey(detail.order.status)) }}
          </el-tag>
        </div>

        <!--
          顶部操作区：按状态机渲染（PRD《页面功能》#订单详情 1）+ 权限码（v-hasPerm）双重判定。
            draft / pending_payment → 编辑、删除（07-03）
            paid                   → 开始服务（07-05，权限 order:start）
            in_progress            → 完成服务（07-05，权限 order:complete）
          收款 / 取消 / 申请退款 / 打印归结算与退款域（07-06+，未上线）⇒ 不渲染
          （PRD《Web规范》§权限与视图 1）。
        -->
        <div class="order-detail__head-right">
          <template v-if="detail && isOrderEditable(detail.order.status)">
            <el-button
              v-hasPerm="'order:update'"
              type="warning"
              plain
              data-testid="order-detail-edit"
              @click="goEdit"
            >
              {{ t("order.action.edit") }}
            </el-button>
            <el-button
              v-hasPerm="'order:delete'"
              type="danger"
              plain
              data-testid="order-detail-delete"
              @click="handleDelete"
            >
              {{ t("order.action.delete") }}
            </el-button>
          </template>

          <el-button
            v-if="detail && isOrderStartable(detail.order.status)"
            v-hasPerm="'order:start'"
            type="primary"
            data-testid="order-detail-start"
            @click="handleStart"
          >
            {{ t("order.action.start") }}
          </el-button>

          <el-button
            v-if="detail && isOrderCompletable(detail.order.status)"
            v-hasPerm="'order:complete'"
            type="success"
            data-testid="order-detail-complete"
            @click="handleComplete"
          >
            {{ t("order.action.complete") }}
          </el-button>
        </div>
      </div>

      <!-- ── 正文（1fr，独立滚动）：四页签 ──────────────────────────────── -->
      <div class="order-detail__scroll">
        <TableSkeleton v-if="showSkeleton" :column-count="4" :row-count="6" />

        <DataState
          v-else-if="loadError"
          variant="error"
          :title="t('order.detail.loadError')"
          :description="loadError"
          :action-text="t('order.detail.retry')"
          @action="loadDetail"
        />

        <DataState
          v-else-if="notFound && !detail"
          variant="empty"
          :title="t('order.detail.notFound')"
          :action-text="t('order.detail.back')"
          @action="goBack"
        />

        <el-tabs v-else-if="detail" v-model="activeTab" class="order-detail__tabs">
          <el-tab-pane :label="t('order.detail.tabOverview')" name="overview">
            <OrderOverviewTab
              :order="detail.order"
              :items="detail.items"
              @open-customer="goCustomer"
              @open-pet="goPet"
            />
          </el-tab-pane>

          <el-tab-pane :label="t('order.detail.tabItems')" name="items" lazy>
            <OrderItemsTab
              :items="detail.items"
              :editable="isOrderEditable(detail.order.status)"
              :can-discount="canDiscount"
              @go-edit="goEdit"
              @set-discount="openDiscountDialog"
            />
          </el-tab-pane>

          <el-tab-pane :label="t('order.detail.tabPayments')" name="payments" lazy>
            <OrderPaymentUnavailableTab />
          </el-tab-pane>

          <el-tab-pane :label="t('order.detail.tabAudit')" name="audit" lazy>
            <OrderAuditTab :order-id="orderId" />
          </el-tab-pane>
        </el-tabs>
      </div>
    </el-card>

    <!-- 设置优惠（MVP-WEB-07-04）：订单级优惠额 → 服务端按明细小计比例分摊 -->
    <OrderDiscountDialog
      v-if="detail"
      v-model="discountDialogVisible"
      :order-id="orderId"
      :version="detail.order.version"
      :total-amount="detail.order.totalAmount"
      :discount-amount="detail.order.discountAmount"
      @saved="handleDiscountSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { ElMessage, ElMessageBox } from "element-plus";
import { ArrowLeft } from "@element-plus/icons-vue";

import OrderAPI from "@/api/order";
import type { OrderDetail, OrderTransitionPayload } from "@/api/order";
import DataState from "@/components/DataState/DataState.vue";
import TableSkeleton from "@/components/DataState/TableSkeleton.vue";
import { hasPerm } from "@/utils/auth";
import {
  isOrderCompletable,
  isOrderEditable,
  isOrderStartable,
  orderStatusLabelKey,
  orderStatusTagType,
} from "@/utils/order";
import { isApiError } from "@/utils/request";
import { useTagsViewStore } from "@/stores";
import OrderAuditTab from "./components/OrderAuditTab.vue";
import OrderDiscountDialog from "./components/OrderDiscountDialog.vue";
import OrderItemsTab from "./components/OrderItemsTab.vue";
import OrderOverviewTab from "./components/OrderOverviewTab.vue";
import OrderPaymentUnavailableTab from "./components/OrderPaymentUnavailableTab.vue";

/**
 * 订单详情页（MVP-WEB-07-02 · 四页签 / 07-04 优惠分摊入口 / 07-05 履约流转入口）
 *
 * 路由：`/orders/:orderId`（PRD《页面清单》`订单详情 | orders/:order_id`）。
 * **跳页**而非抽屉：四页签 + 明细表 + 审计时间序超出 480px 抽屉承载
 * （PRD《Web规范》§页面模式 1）；菜单侧以 `visible=0` 的隐藏子菜单注册
 * （seed id 8102，踩坑 123），不进侧边栏。
 *
 * 布局：严格遵循内容卡三段式 grid（`auto / 1fr / auto`）——本页只有两个直接子元素：
 *  `__head`（auto）+ `__scroll`（1fr，独立滚动），第三个 auto 行为空（高度 0），
 *  不会撑破 `.el-card__body` 的 `overflow: hidden`（PITFALLS 布局红线 96）。
 *  优惠对话框用 `el-dialog` + `append-to-body` 渲染到 body，**不计入**该 grid。
 *
 * 地址栏：只同步**页签** `?tab=`（默认 `overview` 不写），与宠物档案页同范式；
 *  `orderId` 是路由身份段。`?tab=` 会改变 `route.fullPath` ⇒ 工作区按 fullPath
 *  重建组件（踩坑 95/122），故用**模块级详情缓存**消除切换页签的骨架闪烁。
 *
 * 数据源边界：概览 = `GET /orders/:id`；明细 = 同载荷 `items`（含 07-04 折扣列）；
 *  操作日志 = `GET /orders/:id/audit-logs`（受 `order:list` 保护的只读通道）；
 *  **支付记录 = 未建模**（无 `payment` 表）⇒ 渲染诚实空态，不造假数据。
 *
 * 优惠入口（07-04）：改价是资金敏感动作（PRD《权限规则》默认角色 = 店长）⇒
 *  「设置优惠」按钮按 `order:discount`（`/users/me` 的 perms[]）渲染，后端
 *  `PermissionGuard` 为最终闸门。
 *
 * 履约入口（07-05）：`paid` 态渲染「开始服务」（`order:start`）、`in_progress` 态渲染
 *  「完成服务」（`order:complete`）—— 状态由状态机判定、权限由 perms 判定，两者皆满足
 *  才渲染；后端 `PUT /orders/:id/start|complete` 为最终闸门（A0911 非法跃迁 / A0909 版本冲突）。
 */
defineOptions({ name: "OrderDetail", inheritAttrs: false });

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const orderId = computed(() => String(route.params.orderId ?? ""));

/** 当前用户是否具备手动改价折扣权限（按钮入口可见性，非安全边界） */
const canDiscount = computed(() => hasPerm("order:discount"));

const tagsViewStore = useTagsViewStore();

/** 详情缓存（模块级，跨组件重建存活；仅用于消除 `?tab=` 变化引起的重建闪烁） */
const detailCache = new Map<string, OrderDetail>();

const TABS = ["overview", "items", "payments", "audit"] as const;
type TabName = (typeof TABS)[number];

const activeTab = ref<TabName>(
  TABS.includes(route.query.tab as TabName) ? (route.query.tab as TabName) : "overview"
);

const detail = ref<OrderDetail | null>(null);
const loading = ref(false);
const hasLoaded = ref(false);
const loadError = ref("");
const notFound = ref(false);

/** 首屏骨架：仅当没有缓存详情可即时渲染时才出现 */
const showSkeleton = computed(() => loading.value && !hasLoaded.value && !detail.value);

async function loadDetail(): Promise<void> {
  const id = orderId.value;
  if (!id) {
    notFound.value = true;
    return;
  }

  const cached = detailCache.get(id);
  if (cached) detail.value = cached;

  loadError.value = "";
  loading.value = true;
  try {
    const data = await OrderAPI.getDetail(id);
    detail.value = data;
    detailCache.set(id, data);
    notFound.value = false;
    // PRD《多标签页策略》第 5 条：标签标题动态生成（对象类型 + 单号），
    // 覆盖菜单名「订单详情」，否则多个订单的标签无法区分
    tagsViewStore.updateTagName(
      route.fullPath,
      `${data.order.orderNo} · ${t("order.detail.title")}`
    );
  } catch (error) {
    if (isApiError(error) && error.code === "A0901") {
      notFound.value = true;
      detailCache.delete(id);
    } else {
      loadError.value = isApiError(error) ? error.message : String(error ?? "");
    }
  } finally {
    loading.value = false;
    hasLoaded.value = true;
  }
}

function goBack(): void {
  void router.push("/orders");
}

/** 客户卡 → 客户列表（按姓名/手机号定位，对齐宠物档案页的 goOwner 口径） */
function goCustomer(): void {
  const keyword = detail.value?.order.customerName;
  void router.push({ path: "/customers", query: keyword ? { keyword } : {} });
}

/** 宠物卡 → 宠物档案页（`/pets/:petId` 已上线，直达而非搜索） */
function goPet(): void {
  const petId = detail.value?.order.petId;
  if (petId) void router.push(`/pets/${petId}`);
}

/** 编辑入口（列表 / 明细页签共用）：跳编辑独立页 `/orders/:orderId/edit`（07-03） */
function goEdit(): void {
  void router.push(`/orders/${orderId.value}/edit`);
}

/**
 * 删除订单（07-03 · 软删）：作废订单属**强确认**（PRD《交互规范》§确认与撤销 1，
 * 输入完整单号）；成功后回订单列表（本单已软删，留在详情页必然 404）。
 */
async function handleDelete(): Promise<void> {
  const order = detail.value?.order;
  if (!order) return;
  try {
    const { value } = await ElMessageBox.prompt(
      t("order.delete.confirmText", { orderNo: order.orderNo }),
      t("order.delete.title"),
      {
        confirmButtonText: t("order.action.delete"),
        cancelButtonText: t("order.form.cancel"),
        inputPlaceholder: order.orderNo,
        inputValidator: (input: string) => String(input ?? "").trim() === order.orderNo,
        inputErrorMessage: t("order.delete.mismatch"),
        type: "warning",
      }
    );
    if (String(value ?? "").trim() !== order.orderNo) return;

    await OrderAPI.remove(order.id);
    ElMessage.success(t("order.delete.success"));
    goBack();
  } catch {
    // 取消（ElMessageBox reject）与请求失败均静默：后者由请求层统一渲染提示
  }
}

// ── 优惠设置（MVP-WEB-07-04）────────────────────────────────────────────

const discountDialogVisible = ref(false);

/** 明细页签「设置优惠」入口：只在`editable && canDiscount`时渲染（父层已判定） */
function openDiscountDialog(): void {
  discountDialogVisible.value = true;
}

/**
 * 优惠保存成功：接口回带**最新详情** ⇒ 直接落 ref + 缓存，不再追加一次 GET
 * （避免「写后无谓回源」的请求风暴，见踩坑 135 的并发口径）。
 */
function handleDiscountSaved(updated: OrderDetail): void {
  detail.value = updated;
  detailCache.set(orderId.value, updated);
}

// ── 履约流转（MVP-WEB-07-05 履约联动）──────────────────────────────────

/**
 * 履约流转公共实现（开始服务 / 完成服务共用）
 *
 * 交互：轻确认（PRD《交互规范》§确认与撤销 —— 状态推进非破坏性、可逆性中等 ⇒
 * 二次确认即可，无需输入单号强确认）；成功后接口回带**最新详情** ⇒ 直接落 ref +
 * 缓存（不追加 GET，踩坑 135 并发口径）。
 *
 * 失败（A0909 版本冲突 / A0911 非法跃迁）由请求层统一渲染提示 ⇒ 本层静默。
 */
async function runFulfillTransition(
  apiFn: (id: string, payload: OrderTransitionPayload) => Promise<OrderDetail>,
  titleKey: string,
  confirmKey: string
): Promise<void> {
  const order = detail.value?.order;
  if (!order) return;
  try {
    await ElMessageBox.confirm(t(confirmKey, { orderNo: order.orderNo }), t(titleKey), {
      confirmButtonText: t(titleKey),
      cancelButtonText: t("order.form.cancel"),
      type: "warning",
    });
  } catch {
    return; // 用户取消
  }
  try {
    const updated = await apiFn(order.id, { version: order.version });
    detail.value = updated;
    detailCache.set(orderId.value, updated);
    ElMessage.success(t("order.fulfill.success"));
  } catch {
    // 请求层已统一提示（版本冲突 / 非法跃迁），此处不再二次弹窗
  }
}

/** 开始服务（paid → in_progress；权限 order:start，按钮可见性由父层判定） */
function handleStart(): void {
  void runFulfillTransition(OrderAPI.start, "order.action.start", "order.fulfill.startConfirm");
}

/** 完成服务（in_progress → completed；权限 order:complete，按钮可见性由父层判定） */
function handleComplete(): void {
  void runFulfillTransition(
    OrderAPI.complete,
    "order.action.complete",
    "order.fulfill.completeConfirm"
  );
}

// ── 地址栏同步页签（默认 overview 不写）────────────────────────────────
watch(activeTab, (tab) => {
  const query: Record<string, string> = {};
  if (tab !== "overview") query.tab = tab;
  void router.replace({ path: route.path, query }).then(
    () => undefined,
    () => undefined
  );
});

// ── 生命周期 ────────────────────────────────────────────────────────────
onMounted(() => {
  void loadDetail();
});

/**
 * keep-alive 激活：`orderId` 变化（从另一张订单进来）或本页被复用（缓存键同）时，
 * 按地址栏重新对齐页签并刷新详情（首次挂载走 `onMounted`，`hadActivated` 去重
 * 避免首屏双请求——踩坑 125 两路径互斥）。
 */
let hadActivated = false;
onActivated(() => {
  if (!hadActivated) {
    hadActivated = true;
    return;
  }
  const tab = route.query.tab as TabName;
  activeTab.value = TABS.includes(tab) ? tab : "overview";
  void loadDetail();
});
</script>

<style lang="scss" scoped>
.order-detail {
  &__head {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  &__head-left {
    display: flex;
    gap: 12px;
    align-items: center;
    min-width: 0;
  }

  &__back {
    height: auto;
    padding: 0;
    font-size: 13px;
  }

  &__title {
    font-size: 16px;
    font-weight: 600;
    color: var(--el-text-color-primary);
  }

  &__status {
    flex-shrink: 0;
  }

  &__head-right {
    display: flex;
    flex-shrink: 0;
    gap: 8px;
  }

  /* 1fr 滚动行：四页签在同一滚动容器内 */
  &__scroll {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
    overflow: auto;
  }

  &__tabs {
    :deep(.el-tabs__content) {
      padding-top: 4px;
    }
  }
}
</style>
