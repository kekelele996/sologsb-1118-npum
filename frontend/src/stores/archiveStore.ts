import { db, applyMergePlan } from '@/hooks/usePersistentStore'
import { artifactStore } from '@/stores/artifactStore'
import { planTrenchArchiveMerge, type MergeReport } from '@/utils/archive'
import { relationStore } from '@/stores/relationStore'
import { stratumStore } from '@/stores/stratumStore'
import { trenchStore } from '@/stores/trenchStore'

/** 读取当前编目、计算合并方案；方案通过单个 IndexedDB 事务原子落库 */
export async function mergeTrenchArchive(raw: unknown): Promise<MergeReport> {
  const [trenches, strata, artifacts, relations] = await Promise.all([
    db.trenches.toArray(),
    db.strata.toArray(),
    db.artifacts.toArray(),
    db.relations.toArray()
  ])

  const plan = planTrenchArchiveMerge({ trenches, strata, artifacts, relations }, raw)
  await applyMergePlan(plan)

  await Promise.all([
    trenchStore.getState().hydrate(),
    stratumStore.getState().hydrate(),
    artifactStore.getState().hydrate(),
    relationStore.getState().hydrate()
  ])

  return plan
}
