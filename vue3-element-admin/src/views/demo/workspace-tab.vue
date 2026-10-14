<template>
  <div class="demo-tab">
    <el-card shadow="never">
      <template #header>工作区标签页演示（详情类页面 · 仅开发环境注册）</template>

      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="实例 ID">{{ id }}</el-descriptions-item>
        <el-descriptions-item label="标签键（fullPath）">{{ route.fullPath }}</el-descriptions-item>
        <el-descriptions-item label="未保存修改">
          <el-tag :type="isDirty ? 'warning' : 'success'" size="small">
            {{ isDirty ? "是" : "否" }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="访问计数">{{ visits }}</el-descriptions-item>
      </el-descriptions>

      <el-form class="demo-tab__form" label-width="80px">
        <el-form-item label="备注">
          <el-input
            v-model="remark"
            placeholder="输入内容即标记为「有未保存的修改」"
            @input="onEdit"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :disabled="!isDirty" @click="save">保存</el-button>
          <el-button @click="renameTag">重命名标签</el-button>
          <el-button @click="reload">模拟刷新</el-button>
        </el-form-item>
      </el-form>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="验证要点"
        description="① 换一个 id 打开即新增标签（多实例）；同一 id 复用；② 钉住最多 3 个，刷新后只恢复钉住标签；③ 打开第 13 个标签会按 LRU 淘汰最久未访问者；④ 有未保存修改时关闭该标签会二次确认。"
      />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from "vue-router";
import { useUnsavedGuard } from "@/composables";
import { useTagsViewStore } from "@/stores";

defineOptions({ name: "DemoWorkspaceTab" });

const route = useRoute();
const router = useRouter();
const tagsViewStore = useTagsViewStore();
const { isDirty, markDirty, markClean } = useUnsavedGuard();

const id = computed(() => String(route.params.id ?? ""));
const visits = ref(0);
const remark = ref("");

/** 每次进入该实例（含 keep-alive 复用）刷新计数，便于观察标签复用行为 */
onActivated(() => {
  visits.value += 1;
});

const onEdit = () => {
  markDirty();
};

const save = () => {
  markClean();
  ElMessage.success("已保存（未保存标记已清除）");
};

/** 演示 PRD 第 5 条：标签标题动态生成「对象类型 + 名称 + 状态」 */
const renameTag = () => {
  tagsViewStore.updateTagName(
    route.fullPath,
    `标签演示 #${id.value} · ${remark.value || "未命名"}`
  );
  ElMessage.success("标签标题已更新");
};

/** 走刷新当前标签的既有链路（/redirect 中转） */
const reload = () => {
  tagsViewStore.delCachedView({
    key: route.fullPath,
    name: String(route.name),
    title: String(route.meta.title),
    path: route.path,
    fullPath: route.fullPath,
  });
  nextTick(() => {
    router.replace("/redirect" + route.fullPath);
  });
};
</script>

<style lang="scss" scoped>
.demo-tab {
  padding: 16px;

  &__form {
    margin-top: 16px;
  }
}
</style>
