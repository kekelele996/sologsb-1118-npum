import { computed, type Ref } from 'vue'
import type { Relation, Stratum } from '@/types'
import { stratumThickness } from '@/types'
import { computeStratumOrder, type StratumOrderResult } from '@/utils/stratumOrder'

export type { StratumOrderResult }

/**
 * 按深度与层位关系计算地层序列：
 * - 主序按距地表上界深度升序；
 * - 若存在「A 叠压/打破 B 但 A 的上界比 B 更深」的情况，则给出矛盾告警；
 * - 同时返回倒置单位与重复单位号，供编目表即时提示。
 */
export function useStratumOrder(strata: Ref<Stratum[]>, relations: Ref<Relation[]>): { result: Ref<StratumOrderResult> } {
  const result = computed<StratumOrderResult>(() => computeStratumOrder(strata.value, relations.value))
  return { result }
}

/** 供编目表展示：单位厚度文本 */
export function thicknessText(stratum: Stratum): string {
  return `${stratumThickness(stratum)} m`
}
