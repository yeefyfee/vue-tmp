<template>
  <ErrorPage
    status-code="403"
    label="无访问权限"
    title="当前账号暂无该页面的访问权限"
    description="你已登录，但当前角色未被授权访问此页面。可返回工作台继续操作，或申请开通对应权限"
    variant="locked"
  >
    <template #actions>
      <el-button type="primary" :icon="Monitor" @click="goWorkspace">返回工作台</el-button>
      <el-button :icon="Bell" @click="applyPermission">申请权限</el-button>
    </template>
  </ErrorPage>
</template>

<script setup lang="ts">
import { Bell, Monitor } from "@element-plus/icons-vue";
import { ElMessageBox } from "element-plus";
import ErrorPage from "./components/ErrorPage.vue";

defineOptions({ name: "Page403" });

const router = useRouter();

/**
 * 返回工作台
 *
 * 工作台落地页为 /dashboard（与根路由 redirect 及左侧菜单首项一致），
 * 不使用 "/"，避免再次经过根路由重定向。
 */
function goWorkspace() {
  router.push("/dashboard");
}

/**
 * 申请权限
 *
 * 说明：当前基座尚未提供「权限申请」页面或帮助链接入口，
 * 因此先以提示框引导用户联系管理员，待权限申请模块落地后再替换为真实跳转。
 * 待接入正式申请入口。
 */
function applyPermission() {
  ElMessageBox.alert("请联系管理员开通权限后再访问该页面。", "申请权限", {
    confirmButtonText: "我知道了",
    type: "info",
  }).catch(() => {
    // 用户可通过 ESC / 点击遮罩关闭，忽略取消产生的 rejection
  });
}
</script>
