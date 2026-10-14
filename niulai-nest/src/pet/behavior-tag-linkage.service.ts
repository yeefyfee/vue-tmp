import { Injectable, Logger, Optional } from "@nestjs/common";

import { TimelineWriteService } from "./timeline-write.service";

/**
 * 行为标签联动钩子（P0-06-05 · FR-4「联动房间与任务」）
 *
 * 设计目标：把「宠物行为标签发生变更」这一事实，解耦为可扩展的**钩子契约**，
 * 让下游（房间分配 / 照护任务）在不改动 PetService / BehaviorTagService 的前提下
 * 订阅消费。
 *
 * 契约：
 *  - `onTagsChanged(petId, added, removed)`：`added` = 本次新增关联的标签 id；
 *    `removed` = 本次摘除关联的标签 id；两者均为**已去重**的差分集合，且都非空
 *    时才需要联动（两者皆空时服务层直接短路返回）。
 *
 * ⚠️ 硬约束（任务书）：**不得引入对未建模块的硬依赖**（P0-06-08 照护任务 /
 * P0-08 房间分配均未落地），否则编译失败。故本轮为「最小实现 + 显式接入点注释」：
 * 仅做结构化日志，保证调用链已连通、可被单测/ E2E 观测；真正的联动逻辑在各
 * 下游模块落地后于 TODO 处接入。
 *
 * 后续接入点（TODO）：
 *  1. P0-08 房间分配：`added` 命中「危险行为」标签（如咬人/应激）→ 写入房间
 *     分配约束（禁同房 / 需单间），`removed` 解除约束；
 *  2. P0-06-08 照护任务：`added` 触发对应照护 SOP 任务派发（如应激宠物喂食
 *     安抚流程），`removed` 结束相关任务；
 *  3. P0-06-06 时间线：标签变更落 `timeline_event`（`事件名 = pet.tags.changed`）
 *     —— 已接入（P0-06-10，见 {@link onTagsChanged} 经 TimelineWriteService 最佳努力写入）。
 */
@Injectable()
export class BehaviorTagLinkageService {
  private readonly logger = new Logger(BehaviorTagLinkageService.name);

  constructor(
    // 时间线写入 SDK（P0-06-10）：@Optional 保证单测直构 `new BehaviorTagLinkageService()` 不变；
    // 未注入时时间线写入短路（不影响联动钩子的最小实现）。
    @Optional() private readonly timelineWrite?: TimelineWriteService
  ) {}

  /**
   * 宠物行为标签变更回调（FR-4 联动扩展点）。
   *
   * @param petId 宠物 id（uuid）
   * @param added 本次新增的标签 id 列表（去重后差分）
   * @param removed 本次摘除的标签 id 列表（去重后差分）
   */
  async onTagsChanged(
    petId: string,
    added: readonly string[],
    removed: readonly string[]
  ): Promise<void> {
    // 差分皆空：无联动语义，短路（避免下游空触发）
    if (added.length === 0 && removed.length === 0) {
      return;
    }

    // 最小实现：结构化日志（可观测调用链；真正的房间/任务联动见类注释 TODO）
    this.logger.debug(
      `behavior-tag linkage: petId=${petId} added=[${added.join(",")}] removed=[${removed.join(",")}]`
    );

    // P0-06-10 时间线写入点：行为标签变更落 timeline_event（事件名 pet.tags.changed）。
    // 最佳努力：写入失败不阻断标签替换主流程。
    if (this.timelineWrite) {
      try {
        await this.timelineWrite.recordSync({
          petId,
          eventName: "pet.tags.changed",
          content: `行为标签变更 +${added.length}/-${removed.length}`,
          payload: {
            addedTagIds: [...added],
            removedTagIds: [...removed],
          },
          refType: "pet",
          refId: petId,
        });
      } catch (error) {
        this.logger.warn(
          `时间线写入失败（不阻断主流程）event=pet.tags.changed pet=${petId}: ${
            (error as Error).message
          }`
        );
      }
    }

    // TODO(P0-08 / P0-06-08)：接入房间分配约束、照护任务派发。
    // 由于上述模块尚未落地，本轮不引入任何硬依赖（编译期安全）。
  }
}
