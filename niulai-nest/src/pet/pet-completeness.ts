/**
 * 宠物档案完整度评分（P0-06-02）
 *
 * 纯函数、零依赖：按关键字段填充权重累加（合计 100），create/update 时
 * 由 PetService 调用重算并写入 pet.profileCompleteness。
 *
 * 权重表（业务语义：基础身份 > 健康关键 > 展示增值）：
 *   name（必填 base）      20
 *   ownerCustomerId        10  （必填 base；主人归属是档案成立的锚点）
 *   petType                10  （必填 base；分房/服务匹配的刚性字段）
 *   birthday               10
 *   weightKg               10  （当前体重快照）
 *   photoUrl 或 photos     10  （有任一图片即计满）
 *   breed                   8
 *   sterilized（非 null）   7
 *   chipNo                  7
 *   coatColor               4
 *   behaviorTags ≥ 1        4
 *                        ─────
 *                         100
 */

/** 各字段权重（合计 100；调整时保持 SUM === 100） */
export const PET_COMPLETENESS_WEIGHTS = {
  name: 20,
  ownerCustomerId: 10,
  petType: 10,
  birthday: 10,
  weightKg: 10,
  photo: 10,
  breed: 8,
  sterilized: 7,
  chipNo: 7,
  coatColor: 4,
  behaviorTags: 4,
} as const;

/** 评分入参形态（pet 行 + 关联行为标签数；全部可空容忍半成品数据） */
export interface PetCompletenessInput {
  name?: string | null;
  ownerCustomerId?: string | null;
  petType?: number | null;
  birthday?: Date | string | null;
  weightKg?: unknown;
  photoUrl?: string | null;
  photos?: unknown;
  breed?: string | null;
  sterilized?: boolean | null;
  chipNo?: string | null;
  coatColor?: string | null;
  behaviorTagCount?: number;
}

/** 判定「字符串字段已有效填充」（非 null / 非 undefined / trim 后非空） */
function isFilled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/** 判定「photos Json 数组已填充」（非空数组且至少一项非空） */
function hasPhotos(photos: unknown): boolean {
  return Array.isArray(photos) && photos.length > 0;
}

/**
 * 计算完整度评分（0~100）。
 * 必填字段（name/ownerCustomerId/petType）恒计权——create DTO 强制要求，
 * 缺失仅可能出现在直接改库的异常数据，此时评分如实降低（探测坏数据）。
 */
export function calcProfileCompleteness(pet: PetCompletenessInput): number {
  let score = 0;
  if (isFilled(pet.name)) score += PET_COMPLETENESS_WEIGHTS.name;
  if (isFilled(pet.ownerCustomerId)) score += PET_COMPLETENESS_WEIGHTS.ownerCustomerId;
  if (pet.petType !== null && pet.petType !== undefined) {
    score += PET_COMPLETENESS_WEIGHTS.petType;
  }
  if (pet.birthday !== null && pet.birthday !== undefined) {
    score += PET_COMPLETENESS_WEIGHTS.birthday;
  }
  // 体重快照：非 null/undefined 即计（0 值权重也是有效录入，业务上体重 > 0
  // 由 DTO 校验保证；直改库的 0 值仍计分——评分衡量「填充」，非数值合理性）
  if (pet.weightKg !== null && pet.weightKg !== undefined) {
    score += PET_COMPLETENESS_WEIGHTS.weightKg;
  }
  if (isFilled(pet.photoUrl) || hasPhotos(pet.photos)) {
    score += PET_COMPLETENESS_WEIGHTS.photo;
  }
  if (isFilled(pet.breed)) score += PET_COMPLETENESS_WEIGHTS.breed;
  if (pet.sterilized !== null && pet.sterilized !== undefined) {
    score += PET_COMPLETENESS_WEIGHTS.sterilized;
  }
  if (isFilled(pet.chipNo)) score += PET_COMPLETENESS_WEIGHTS.chipNo;
  if (isFilled(pet.coatColor)) score += PET_COMPLETENESS_WEIGHTS.coatColor;
  if ((pet.behaviorTagCount ?? 0) > 0) score += PET_COMPLETENESS_WEIGHTS.behaviorTags;
  return Math.min(100, Math.max(0, score));
}
