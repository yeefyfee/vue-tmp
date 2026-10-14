import { useWindowSize } from "@vueuse/core";
import { useAppStore } from "@/stores";
import { DeviceEnum } from "@/enums/settings";

/** 与 styles/variables.scss 的 $breakpoint-md / $breakpoint-xl 保持一致（《Web 规范·响应式断点》） */
const MD_BREAKPOINT = 768;
const XL_BREAKPOINT = 1280;

/**
 * 根据窗口宽度同步设备类型和侧边栏展开状态
 *
 * 四档断点（《Web 规范·响应式断点》）：
 * - ≥1280px（xl）：完整布局，侧边栏展开（完整菜单）
 * - 1024~1279px（lg）：左侧导航折叠为图标
 * - 768~1023px（md）：桌面窄屏，左导航保持图标态
 * - <768px（sm）：移动端，侧边栏隐藏（抽屉式浮层）
 */
export function useLayoutDevice() {
  const appStore = useAppStore();
  const { width } = useWindowSize();

  const isDesktop = computed(() => width.value >= MD_BREAKPOINT);
  const isWideDesktop = computed(() => width.value >= XL_BREAKPOINT);

  watchEffect(() => {
    const device = isDesktop.value ? DeviceEnum.DESKTOP : DeviceEnum.MOBILE;

    appStore.toggleDevice(device);

    if (isWideDesktop.value) {
      appStore.openSidebar();
    } else {
      appStore.closeSidebar();
    }
  });

  return {
    isDesktop,
  };
}
