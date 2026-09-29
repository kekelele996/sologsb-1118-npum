import type {
  Artifact,
  ArtifactCategory,
  Completeness,
  Inclusion,
  Relation,
  RelationBasis,
  RelationType,
  Stratum,
  Trench,
  TrenchSize,
  UnitType
} from '@/types'
import {
  ARTIFACT_CATEGORIES,
  COMPLETENESS,
  INCLUSIONS,
  RELATION_BASES,
  RELATION_TYPES,
  UNIT_TYPES,
  trenchKey
} from '@/types'
import { db } from '@/hooks/usePersistentStore'
import { uid } from './id'
import { wouldCreateCycle } from './graph'
import { computeStratumOrder, type StratumOrderResult } from './stratumOrder'

/** 档案文件标记与版本（工地 ↔ 整理室对传） */
export const ARCHIVE_FORMAT = 'gbtrenchlog-archive'
export const ARCHIVE_VERSION = 1

export interface ArchiveFile {
  format: typeof ARCHIVE_FORMAT
  version: number
  exportedAt: string
  trench: ArchiveTrench
  strata: ArchiveStratum[]
  artifacts: ArchiveArtifact[]
  relations: ArchiveRelation[]
}

export interface ArchiveTrench {
  code: string
  area: string
  size?: string
  basePoint?: string
  openLayer?: string
  startDate?: string
  endDate?: string
  leader?: string
  wallNote?: string
  backfilled?: boolean
}

export interface ArchiveStratum {
  code: string
  type?: string
  openLayer?: string
  topDepth: number
  bottomDepth: number
  soil?: string
  inclusions?: string[]
  formation?: string
  date?: string
  drawingNo?: string
}

export interface ArchiveArtifact {
  code: string
  /** 所属地层单位号（档案里只存单位号，不存本地 id） */
  stratumCode: string
  category?: string
  count?: number
  completeness?: string
  x?: number
  y?: number
  z: number
  date?: string
  collector?: string
  tempLocation?: string
}

export interface ArchiveRelation {
  unitACode: string
  type: string
  unitBCode: string
  basis?: string
  recorder?: string
  note?: string
}

/** 解析档案时抛出（中文提示，直接展示给用户） */
export class ArchiveError extends Error {}

function normCode(code: string): string {
  return code.trim().toUpperCase()
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function number(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function pickInclusions(value: unknown): Inclusion[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Inclusion => typeof item === 'string' && (INCLUSIONS as readonly string[]).includes(item))
}

// ---------------------------------------------------------------------------
// 导出：一个探方 → 一份档案（全部用业务键，不含本地 id）
// ---------------------------------------------------------------------------

export function exportArchive(
  trench: Trench,
  strata: Stratum[],
  artifacts: Artifact[],
  relations: Relation[]
): ArchiveFile {
  const stratumIds = new Set(strata.map((item) => item.id))
  return {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    trench: {
      code: trench.code,
      area: trench.area,
      size: trench.size,
      basePoint: trench.basePoint,
      openLayer: trench.openLayer,
      startDate: trench.startDate,
      endDate: trench.endDate,
      leader: trench.leader,
      wallNote: trench.wallNote,
      backfilled: trench.backfilled
    },
    strata: strata.map((item) => ({
      code: item.code,
      type: item.type,
      openLayer: item.openLayer,
      topDepth: item.topDepth,
      bottomDepth: item.bottomDepth,
      soil: item.soil,
      inclusions: [...item.inclusions],
      formation: item.formation,
      date: item.date,
      drawingNo: item.drawingNo
    })),
    artifacts: artifacts
      .filter((item) => stratumIds.has(item.stratumId))
      .map((item) => {
        const stratum = strata.find((row) => row.id === item.stratumId) as Stratum
        return {
          code: item.code,
          stratumCode: stratum.code,
          category: item.category,
          count: item.count,
          completeness: item.completeness,
          x: item.x,
          y: item.y,
          z: item.z,
          date: item.date,
          collector: item.collector,
          tempLocation: item.tempLocation
        }
      }),
    relations: relations
      .filter((item) => stratumIds.has(item.unitAId) && stratumIds.has(item.unitBId))
      .map((item) => {
        const a = strata.find((row) => row.id === item.unitAId) as Stratum
        const b = strata.find((row) => row.id === item.unitBId) as Stratum
        return {
          unitACode: a.code,
          type: item.type,
          unitBCode: b.code,
          basis: item.basis,
          recorder: item.recorder,
          note: item.note
        }
      })
  }
}

// ---------------------------------------------------------------------------
// 解析与校验
// ---------------------------------------------------------------------------

export function parseArchive(rawText: string): ArchiveFile {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    throw new ArchiveError('档案不是合法的 JSON 文件，请确认是从本系统导出的探方档案')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ArchiveError('档案内容为空或格式不正确')
  }
  const data = parsed as Record<string, unknown>
  if (data.format !== ARCHIVE_FORMAT) {
    throw new ArchiveError('档案格式不正确（缺少 gbtrenchlog-archive 标记），请确认是从本系统导出的探方档案')
  }
  if (data.version !== ARCHIVE_VERSION) {
    throw new ArchiveError(`档案版本不受支持（version=${String(data.version)}），请用对应版本的系统导入`)
  }

  const trenchRaw = data.trench as Record<string, unknown> | undefined
  if (!trenchRaw || !text(trenchRaw.code) || !text(trenchRaw.area)) {
    throw new ArchiveError('档案缺少探方信息（发掘区、探方号），无法对传')
  }

  const strata: ArchiveStratum[] = (Array.isArray(data.strata) ? (data.strata as unknown[]) : []).map((row) => {
    const item = row as Record<string, unknown>
    return {
      code: text(item.code),
      type: text(item.type, '地层'),
      openLayer: text(item.openLayer),
      topDepth: number(item.topDepth, 0),
      bottomDepth: number(item.bottomDepth, 0),
      soil: text(item.soil),
      inclusions: pickInclusions(item.inclusions),
      formation: text(item.formation),
      date: text(item.date),
      drawingNo: text(item.drawingNo)
    }
  })
  if (strata.some((item) => !item.code)) {
    throw new ArchiveError('档案中存在缺少单位号的地层单位，无法按单位号合并')
  }
  if (strata.some((item) => !Number.isFinite(item.topDepth) || !Number.isFinite(item.bottomDepth))) {
    throw new ArchiveError('档案中存在深度非法的地层单位，无法合并')
  }

  const artifacts: ArchiveArtifact[] = (Array.isArray(data.artifacts) ? (data.artifacts as unknown[]) : []).map((row) => {
    const item = row as Record<string, unknown>
    return {
      code: text(item.code),
      stratumCode: text(item.stratumCode),
      category: text(item.category, '陶器'),
      count: number(item.count, 1),
      completeness: text(item.completeness, '残片'),
      x: number(item.x, 0),
      y: number(item.y, 0),
      z: number(item.z, NaN),
      date: text(item.date),
      collector: text(item.collector),
      tempLocation: text(item.tempLocation)
    }
  })
  if (artifacts.some((item) => !item.code)) {
    throw new ArchiveError('档案中存在缺少器物编号的出土物，无法按器物编号合并')
  }
  if (artifacts.some((item) => !item.stratumCode)) {
    throw new ArchiveError('档案中存在缺少所属单位号的出土物，无法归并到地层单位')
  }
  if (artifacts.some((item) => !Number.isFinite(item.z))) {
    throw new ArchiveError('档案中存在出土深度非法的出土物，无法合并')
  }

  const relations: ArchiveRelation[] = (Array.isArray(data.relations) ? (data.relations as unknown[]) : []).map((row) => {
    const item = row as Record<string, unknown>
    return {
      unitACode: text(item.unitACode),
      type: text(item.type, '叠压'),
      unitBCode: text(item.unitBCode),
      basis: text(item.basis, '剖面观察'),
      recorder: text(item.recorder),
      note: text(item.note)
    }
  })
  if (relations.some((item) => !item.unitACode || !item.unitBCode)) {
    throw new ArchiveError('档案中存在缺少单位号的层位关系，无法按单位号重挂')
  }

  return {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: text(data.exportedAt),
    trench: {
      code: text(trenchRaw.code),
      area: text(trenchRaw.area),
      size: text(trenchRaw.size),
      basePoint: text(trenchRaw.basePoint),
      openLayer: text(trenchRaw.openLayer),
      startDate: text(trenchRaw.startDate),
      endDate: text(trenchRaw.endDate),
      leader: text(trenchRaw.leader),
      wallNote: text(trenchRaw.wallNote),
      backfilled: Boolean(trenchRaw.backfilled)
    },
    strata,
    artifacts,
    relations
  }
}

// ---------------------------------------------------------------------------
// 合并计划（纯函数，不写库）
// ---------------------------------------------------------------------------

export interface MergeSkippedRelation {
  label: string
  reason: string
}

export interface MergeStratumDiff {
  code: string
  field: string
  local: string
  archive: string
}

export interface MergeOutOfBounds {
  code: string
  z: number
  range: string
}

export interface MergeReport {
  archive: ArchiveFile
  trenchAction: 'create' | 'merge'
  trenchLabel: string
  // 地层单位
  strataCreated: string[]
  strataUpdated: string[]
  strataUnmatchedLocal: string[]
  stratumDiffs: MergeStratumDiff[]
  // 出土物
  artifactsToCreate: string[]
  artifactsDuplicate: string[]
  artifactsUnresolved: string[]
  // 层位关系
  relationsToWrite: string[]
  relationsSkipped: MergeSkippedRelation[]
  // 合并后核对
  postInverted: string[]
  postConflicts: string[]
  postOutOfBounds: MergeOutOfBounds[]
  postOrder: StratumOrderResult
}

export interface MergePlan {
  report: MergeReport
  trench: Trench
  createTrench: boolean
  strataToPut: Stratum[]
  artifactsToPut: Artifact[]
  relationsToPut: Relation[]
}

export interface LocalData {
  trenches: Trench[]
  strata: Stratum[]
  artifacts: Artifact[]
  relations: Relation[]
}

const UNIT_TYPE_SET = new Set<string>(UNIT_TYPES)
const RELATION_TYPE_SET = new Set<string>(RELATION_TYPES)
const RELATION_BASE_SET = new Set<string>(RELATION_BASES)
const ARTIFACT_CATEGORY_SET = new Set<string>(ARTIFACT_CATEGORIES)
const COMPLETENESS_SET = new Set<string>(COMPLETENESS)

/**
 * 按单位号把档案合并进本地编目，产出合并计划（不写库）：
 * - 同一个地层单位按单位号并成一条；土质土色与包含物取带回来的那份，上下界深度留工地量的值；
 * - 对不上的（单位号、字段差异）列入复核清单；
 * - 层位关系按单位号重挂；会造成互相叠压/打破（环路）的先不写、列入清单；
 * - 出土物按器物编号并进去，重号的跳过；
 * - 合并后重算序位，核对出土物深度是否仍在所属单位区间，越界的列出来。
 */
export function computeMergePlan(archive: ArchiveFile, local: LocalData): MergePlan {
  const key = trenchKey({ area: archive.trench.area, code: archive.trench.code })
  const existingTrench = local.trenches.find((item) => trenchKey(item) === key) ?? null

  const trenchLabel = `${archive.trench.area} · ${archive.trench.code}`
  const createTrench = !existingTrench
  const trench: Trench = existingTrench ?? {
    id: uid('tr'),
    code: normCode(archive.trench.code),
    area: archive.trench.area.trim(),
    size: (archive.trench.size as TrenchSize) || '5×5 米',
    basePoint: archive.trench.basePoint ?? '',
    openLayer: archive.trench.openLayer ?? '',
    startDate: archive.trench.startDate ?? '',
    endDate: archive.trench.endDate ?? '',
    leader: archive.trench.leader ?? '',
    wallNote: archive.trench.wallNote ?? '',
    backfilled: archive.trench.backfilled ?? false
  }

  const trenchStrata = local.strata.filter((item) => item.trenchId === trench.id)
  const trenchStratumIds = new Set(trenchStrata.map((item) => item.id))

  // ---- 地层单位：按单位号并成一条 ----
  const strataToPut: Stratum[] = []
  const codeToId = new Map<string, string>()
  trenchStrata.forEach((item) => codeToId.set(normCode(item.code), item.id))

  const strataCreated: string[] = []
  const strataUpdated: string[] = []
  const stratumDiffs: MergeStratumDiff[] = []

  for (const archiveStratum of archive.strata) {
    const code = normCode(archiveStratum.code)
    const matched = trenchStrata.find((item) => normCode(item.code) === code)
    if (matched) {
      // 土质土色与包含物取带回来的那份；上下界深度等工地量的值保留
      strataToPut.push({
        ...matched,
        soil: archiveStratum.soil ?? '',
        inclusions: (archiveStratum.inclusions ?? []) as Inclusion[]
      })
      strataUpdated.push(code)
      const diffFields: { field: string; local: string; archive: string }[] = [
        { field: '单位类型', local: matched.type, archive: archiveStratum.type ?? '' },
        { field: '开口层位', local: matched.openLayer, archive: archiveStratum.openLayer ?? '' },
        { field: '堆积成因', local: matched.formation, archive: archiveStratum.formation ?? '' },
        { field: '发掘日期', local: matched.date, archive: archiveStratum.date ?? '' },
        { field: '绘图/拍照号', local: matched.drawingNo, archive: archiveStratum.drawingNo ?? '' }
      ]
      diffFields
        .filter((item) => item.archive && item.local !== item.archive)
        .forEach((item) => stratumDiffs.push({ code, field: item.field, local: item.local, archive: item.archive }))
    } else {
      const id = uid('st')
      strataToPut.push({
        id,
        trenchId: trench.id,
        code,
        type: (UNIT_TYPE_SET.has(archiveStratum.type ?? '') ? archiveStratum.type : '地层') as UnitType,
        openLayer: archiveStratum.openLayer ?? '',
        topDepth: archiveStratum.topDepth,
        bottomDepth: archiveStratum.bottomDepth,
        soil: archiveStratum.soil ?? '',
        inclusions: (archiveStratum.inclusions ?? []) as Inclusion[],
        formation: archiveStratum.formation ?? '',
        date: archiveStratum.date ?? '',
        drawingNo: archiveStratum.drawingNo ?? ''
      })
      codeToId.set(code, id)
      strataCreated.push(code)
    }
  }

  const archiveCodes = new Set(archive.strata.map((item) => normCode(item.code)))
  const strataUnmatchedLocal = trenchStrata
    .filter((item) => !archiveCodes.has(normCode(item.code)))
    .map((item) => item.code)

  // 合并后的完整地层序列（未改动的本地单位 + 更新 + 新增）
  const updatedByCode = new Map(strataToPut.map((item) => [normCode(item.code), item]))
  const finalStrata: Stratum[] = trenchStrata.map((item) => updatedByCode.get(normCode(item.code)) ?? item)
  strataToPut.forEach((item) => {
    if (!finalStrata.some((row) => row.id === item.id)) finalStrata.push(item)
  })

  // ---- 出土物：按器物编号并进去，重号的跳过 ----
  const artifactsToPut: Artifact[] = []
  const artifactsToCreate: string[] = []
  const artifactsDuplicate: string[] = []
  const artifactsUnresolved: string[] = []

  for (const archiveArtifact of archive.artifacts) {
    const code = archiveArtifact.code.trim()
    if (local.artifacts.some((item) => normCode(item.code) === normCode(code))) {
      artifactsDuplicate.push(code)
      continue
    }
    const stratumId = codeToId.get(normCode(archiveArtifact.stratumCode))
    if (!stratumId) {
      artifactsUnresolved.push(code)
      continue
    }
    artifactsToPut.push({
      id: uid('af'),
      stratumId,
      code,
      category: (ARTIFACT_CATEGORY_SET.has(archiveArtifact.category ?? '') ? archiveArtifact.category : '陶器') as ArtifactCategory,
      count: Math.max(1, Math.round(archiveArtifact.count || 1)),
      completeness: (COMPLETENESS_SET.has(archiveArtifact.completeness ?? '')
        ? archiveArtifact.completeness
        : '残片') as Completeness,
      x: archiveArtifact.x ?? 0,
      y: archiveArtifact.y ?? 0,
      z: archiveArtifact.z,
      date: archiveArtifact.date ?? '',
      collector: archiveArtifact.collector ?? '',
      tempLocation: archiveArtifact.tempLocation ?? ''
    })
    artifactsToCreate.push(code)
  }

  // ---- 层位关系：按单位号重挂；环路/重号/对不上的先不写 ----
  const existingTrenchRelations = local.relations.filter(
    (item) => trenchStratumIds.has(item.unitAId) || trenchStratumIds.has(item.unitBId)
  )
  const workingRelations: Relation[] = [...existingTrenchRelations]
  const relationsToPut: Relation[] = []
  const relationsToWrite: string[] = []
  const relationsSkipped: MergeSkippedRelation[] = []

  for (const archiveRelation of archive.relations) {
    const label = `${normCode(archiveRelation.unitACode)} ${archiveRelation.type} ${normCode(archiveRelation.unitBCode)}`
    if (!RELATION_TYPE_SET.has(archiveRelation.type)) {
      relationsSkipped.push({ label, reason: '关系类型无法识别' })
      continue
    }
    const unitAId = codeToId.get(normCode(archiveRelation.unitACode))
    const unitBId = codeToId.get(normCode(archiveRelation.unitBCode))
    if (!unitAId || !unitBId) {
      relationsSkipped.push({ label, reason: '单位号在工地编目中对不上，无法重挂' })
      continue
    }
    if (unitAId === unitBId) {
      relationsSkipped.push({ label, reason: '单位 A 与单位 B 相同' })
      continue
    }
    const duplicated = workingRelations.some(
      (item) => item.unitAId === unitAId && item.type === archiveRelation.type && item.unitBId === unitBId
    )
    if (duplicated) {
      relationsSkipped.push({ label, reason: '关系已存在（重号跳过）' })
      continue
    }
    const candidate = { unitAId, unitBId, type: archiveRelation.type as RelationType }
    if (wouldCreateCycle(workingRelations, candidate)) {
      relationsSkipped.push({ label, reason: '会让两个单位互相叠压或打破（环路矛盾），暂不写入' })
      continue
    }
    const row: Relation = {
      id: uid('rl'),
      unitAId,
      type: archiveRelation.type as RelationType,
      unitBId,
      basis: (RELATION_BASE_SET.has(archiveRelation.basis ?? '') ? archiveRelation.basis : '剖面观察') as RelationBasis,
      recorder: archiveRelation.recorder ?? '',
      note: archiveRelation.note ?? ''
    }
    relationsToPut.push(row)
    workingRelations.push(row)
    relationsToWrite.push(label)
  }

  // ---- 合并后核对：重算序位，核对出土物深度区间 ----
  const finalRelations = [...existingTrenchRelations, ...relationsToPut]
  const postOrder = computeStratumOrder(finalStrata, finalRelations)

  const postInverted = postOrder.inverted.map((item) => item.code)
  const postConflicts = postOrder.conflicts

  const finalStratumById = new Map(finalStrata.map((item) => [item.id, item]))
  const postOutOfBounds: MergeOutOfBounds[] = []
  const finalArtifactStratumIds = new Set(finalStrata.map((item) => item.id))
  for (const artifact of [
    ...local.artifacts.filter((item) => finalArtifactStratumIds.has(item.stratumId)),
    ...artifactsToPut
  ]) {
    const stratum = finalStratumById.get(artifact.stratumId)
    if (!stratum) continue
    if (artifact.z < stratum.topDepth || artifact.z > stratum.bottomDepth) {
      postOutOfBounds.push({
        code: artifact.code,
        z: artifact.z,
        range: `${stratum.topDepth}–${stratum.bottomDepth} m`
      })
    }
  }

  const report: MergeReport = {
    archive,
    trenchAction: createTrench ? 'create' : 'merge',
    trenchLabel,
    strataCreated,
    strataUpdated,
    strataUnmatchedLocal,
    stratumDiffs,
    artifactsToCreate,
    artifactsDuplicate,
    artifactsUnresolved,
    relationsToWrite,
    relationsSkipped,
    postInverted,
    postConflicts,
    postOutOfBounds,
    postOrder
  }

  return { report, trench, createTrench, strataToPut, artifactsToPut, relationsToPut }
}

// ---------------------------------------------------------------------------
// 写入：单事务，失败回滚，恢复原编目
// ---------------------------------------------------------------------------

/**
 * 把合并计划写入 IndexedDB。整次合并在一个读写事务内完成，
 * 任一步失败则事务中止、已写入部分全部回滚（原编目恢复到合并前）。
 */
export async function applyMerge(plan: MergePlan): Promise<void> {
  await db.transaction('rw', db.trenches, db.strata, db.artifacts, db.relations, async () => {
    if (plan.createTrench) {
      await db.trenches.put(plan.trench)
    }
    if (plan.strataToPut.length > 0) {
      await db.strata.bulkPut(plan.strataToPut)
    }
    if (plan.artifactsToPut.length > 0) {
      await db.artifacts.bulkPut(plan.artifactsToPut)
    }
    if (plan.relationsToPut.length > 0) {
      await db.relations.bulkPut(plan.relationsToPut)
    }
  })
}
