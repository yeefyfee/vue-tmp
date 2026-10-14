import { createApp } from "vue";
import App from "./App.vue";

import "element-plus/theme-chalk/dark/css-vars.css";
import "@/styles/index.scss";
import "uno.css";
import "animate.css";

import { setupDirective } from "@/directives";
import { setupRouter } from "@/router";
import { setupStore } from "@/stores";
import { setupI18n } from "@/lang";
import * as ElementPlusIcons from "@element-plus/icons-vue";
import { setupPermissionGuard } from "@/router/guards/permission";
import { setupWorkspaceGuard } from "@/router/guards/workspace";
import { setupSse } from "@/composables";

const app = createApp(App);

setupDirective(app);
setupI18n(app);
setupRouter(app);
setupStore(app);

Object.entries(ElementPlusIcons).forEach(([name, comp]) => app.component(name, comp));

// 工作区标签页守卫须先于权限守卫注册：未保存修改的离开拦截优先于路由生成/403 判定
setupWorkspaceGuard();
setupPermissionGuard();
setupSse();

app.mount("#app");
