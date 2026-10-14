import type { App } from "vue";
import { createPinia } from "pinia";

const store = createPinia();

export function setupStore(app: App<Element>) {
  app.use(store);
}

export * from "./app";
export * from "./dict";
export * from "./permission";
export * from "./settings";
export * from "./store-context";
export * from "./tags-view";
// PeluVida 基座（PEL-04）：./tenant 已随业务模块归档，待 P0-03 重建后恢复导出
export * from "./user";
export { store };
