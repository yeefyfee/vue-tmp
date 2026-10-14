/**
 * 寄养状态机（Stay）与房间房态（Room）
 *
 * 寄养主链路：booked → checked_in → staying → checked_out
 * 分支：extended / early_leave / incident
 * 房态：available / occupied / cleaning / disabled（closed 循环 occupied → cleaning → available）
 * 规则：入住校验疫苗有效期、猫狗分房、咬人宠物禁同房；退房物品全额归还方可完成。
 */

import type { StatusMeta } from "./meta";

export const StayStatus = {
  BOOKED: "booked",
  CHECKED_IN: "checked_in",
  STAYING: "staying",
  CHECKED_OUT: "checked_out",
  EXTENDED: "extended",
  EARLY_LEAVE: "early_leave",
  INCIDENT: "incident",
} as const;

export type StayStatus = (typeof StayStatus)[keyof typeof StayStatus];

export const STAY_STATUS_META: Readonly<Record<StayStatus, StatusMeta>> = {
  [StayStatus.BOOKED]: { value: "booked", label: "已预订", color: "info" },
  [StayStatus.CHECKED_IN]: { value: "checked_in", label: "已入住", color: "info" },
  [StayStatus.STAYING]: { value: "staying", label: "寄养中", color: "info" },
  [StayStatus.CHECKED_OUT]: { value: "checked_out", label: "已退房", color: "success" },
  [StayStatus.EXTENDED]: { value: "extended", label: "已延期", color: "warning" },
  [StayStatus.EARLY_LEAVE]: { value: "early_leave", label: "提前退房", color: "warning" },
  [StayStatus.INCIDENT]: { value: "incident", label: "异常", color: "danger" },
};

/** 房间房态 */
export const RoomStatus = {
  AVAILABLE: "available",
  OCCUPIED: "occupied",
  CLEANING: "cleaning",
  DISABLED: "disabled",
} as const;

export type RoomStatus = (typeof RoomStatus)[keyof typeof RoomStatus];

export const ROOM_STATUS_META: Readonly<Record<RoomStatus, StatusMeta>> = {
  [RoomStatus.AVAILABLE]: { value: "available", label: "空闲", color: "success" },
  [RoomStatus.OCCUPIED]: { value: "occupied", label: "占用", color: "info" },
  [RoomStatus.CLEANING]: { value: "cleaning", label: "清洁中", color: "warning" },
  [RoomStatus.DISABLED]: { value: "disabled", label: "停用", color: "neutral" },
};

/** 房态流转（退房后必须经 cleaning 才回到 available） */
export const ROOM_STATUS_TRANSITIONS: Readonly<Record<RoomStatus, readonly RoomStatus[]>> = {
  [RoomStatus.AVAILABLE]: [RoomStatus.OCCUPIED, RoomStatus.DISABLED],
  [RoomStatus.OCCUPIED]: [RoomStatus.CLEANING],
  [RoomStatus.CLEANING]: [RoomStatus.AVAILABLE, RoomStatus.DISABLED],
  [RoomStatus.DISABLED]: [RoomStatus.AVAILABLE],
};

export function canTransitionRoom(from: RoomStatus, to: RoomStatus): boolean {
  return ROOM_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/** 房间资源类型（6 类） */
export const RoomType = {
  KENNEL: "kennel",
  SUITE: "suite",
  CAT: "cat",
  DOG: "dog",
  VIP: "vip",
  MULTI: "multi",
} as const;

export type RoomType = (typeof RoomType)[keyof typeof RoomType];

export const ROOM_TYPE_META: Readonly<Record<RoomType, StatusMeta>> = {
  [RoomType.KENNEL]: { value: "kennel", label: "标准间", color: "neutral" },
  [RoomType.SUITE]: { value: "suite", label: "套房", color: "neutral" },
  [RoomType.CAT]: { value: "cat", label: "猫房", color: "neutral" },
  [RoomType.DOG]: { value: "dog", label: "犬房", color: "neutral" },
  [RoomType.VIP]: { value: "vip", label: "VIP 房", color: "warning" },
  [RoomType.MULTI]: { value: "multi", label: "多宠间", color: "neutral" },
};
