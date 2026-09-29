import { uid } from '@/utils/id'
import {
  ARTIFACT_CATEGORIES,
  COMPLETENESS,
  INCLUSIONS,
  RELATION_BASES,
  RELATION_TYPES,
  TRENCH_SIZES,
  UNIT_TYPES,
  trenchKey,
  type Artifact,
  type Inclusion,
  type Relation,
  type RelationType,
  type Stratum,
  type Trench
} from '@/types'

export const ARCHIVE_KIND = 'gbtrenchlog.trench-archive'
export const ARCHIVE_VERSION = 1
const DEPTH_EPSILON = 1e-9

export interface TrenchArchive {
  kind: typeof ARCHIVE_KIND
  version: typeof ARCHIVE_VERSION
  exportedAt: string
  trench: Trench
  strata: Stratum[]
  artifacts: Artifact[]
  relations: Relation[]
}

export interface DepthMismatch {
  code: string
  siteTopDepth: number
  siteBottomDepth: number
  broughtTopDepth: number
  broughtBottomDepth: number
}

export interface OutOfRangeArtifact {
  code: string
  unitCode: string
  z: number
  topDepth: number
  bottomDepth: number
}

export interface OrderedUnit {
  order: number
  code: string
  topDepth: number
  bottomDepth: number
}

export interface MergeReport {
  trenchId: string
  trenchLabel: string
  updatedStrata: string[]
  addedStrata: string[]
  addedArtifacts: string[]
  skippedDuplicateArtifacts: string[]
  addedRelations: string[]
  skippedDuplicateRelations: string[]
  skippedConflictingRelations: string[]
  depthMismatches: DepthMismatch[]
  outOfRangeArtifacts: OutOfRangeArtifact[]
  orderedUnits: OrderedUnit[]
}

export interface MergeCollection {
  trenches: Trench[]
  strata: Stratum[]
  artifacts: Artifact[]
  relations: Relation[]
}

export interface MergePlan extends MergeReport {
  strataToPut: Stratum[]
  artifactsToPut: Artifact[]
  relationsToPut: Relation[]
}

export class ArchiveValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArchiveValidationError'
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ArchiveValidationError(`档案字段「${field}」必须是非空字符串`)
  }
  return value
}

const optionalString = (value: unknown, field: string): string => {
  if (typeof value !== 'string') throw new ArchiveValidationError(`档案字段「${field}」必须是字符串`)
  return value
}

const finiteNumber = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ArchiveValidationError(`档案字段「${field}」必须是有限数字`)
  }
  return value
}

const enumValue = <T extends string>(value: unknown, values: readonly T[], field: string): T => {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new ArchiveValidationError(`档案字段「${field}」取值无效`)
  }
  return value as T
}

const normalizeUnitCode = (code: string): string => code.trim().toUpperCase()
const sameDepth = (a: number, b: number): boolean => Math.abs(a - b) <= DEPTH_EPSILON

function sanitizeTrench(value: unknown): Trench {
  if (!isObject(value)) throw new ArchiveValidationError('档案中的探方必须是对象')
  const size = enumValue(value.size, TRENCH_SIZES, '探方规格')
  return {
    id: requiredString(value.id, '探方 ID'),
    code: requiredString(value.code, '探方号').trim().toUpperCase(),
    area: requiredString(value.area, '发掘区').trim(),
    size,
    basePoint: optionalString(value.basePoint ?? '', '基点坐标').trim(),
    openLayer: optionalString(value.openLayer ?? '', '开口层位').trim(),
    startDate: optionalString(value.startDate ?? '', '发掘起始日期'),
    endDate: optionalString(value.endDate ?? '', '发掘结束日期'),
    leader: optionalString(value.leader ?? '', '负责人').trim(),
    wallNote: optionalString(value.wallNote ?? '', '四壁备注').trim(),
    backfilled: typeof value.backfilled === 'boolean' ? value.backfilled : false
  }
}

function sanitizeStratum(value: unknown): Stratum {
  if (!isObject(value)) throw new ArchiveValidationError('档案中的地层单位必须是对象')
  const rawInclusions = value.inclusions
  if (!Array.isArray(rawInclusions)) throw new ArchiveValidationError('档案字段「包含物」必须是数组')
  const inclusions = rawInclusions.map((item) => enumValue<Inclusion>(item, INCLUSIONS, '包含物'))
  return {
    id: requiredString(value.id, '地层单位 ID'),
    trenchId: requiredString(value.trenchId, '地层单位所属探方 ID'),
    code: requiredString(value.code, '单位号').trim().toUpperCase(),
    type: enumValue(value.type, UNIT_TYPES, '单位类型'),
    openLayer: optionalString(value.openLayer ?? '', '开口层位').trim(),
    topDepth: finiteNumber(value.topDepth, '上界深度'),
    bottomDepth: finiteNumber(value.bottomDepth, '下界深度'),
    soil: optionalString(value.soil ?? '', '土质土色').trim(),
    inclusions,
    formation: optionalString(value.formation ?? '', '堆积成因').trim(),
    date: optionalString(value.date ?? '', '记录日期'),
    drawingNo: optionalString(value.drawingNo ?? '', '绘图拍照号').trim()
  }
}

function sanitizeArtifact(value: unknown): Artifact {
  if (!isObject(value)) throw new ArchiveValidationError('档案中的出土物必须是对象')
  const count = finiteNumber(value.count, '件数')
  if (!Number.isInteger(count) || count <= 0) throw new ArchiveValidationError('出土物件数必须是正整数')
  return {
    id: requiredString(value.id, '出土物 ID'),
    stratumId: requiredString(value.stratumId, '出土物所属单位 ID'),
    code: requiredString(value.code, '器物编号').trim(),
    category: enumValue(value.category, ARTIFACT_CATEGORIES, '器物类别'),
    count,
    completeness: enumValue(value.completeness, COMPLETENESS, '残整程度'),
    x: finiteNumber(value.x, 'X 坐标'),
    y: finiteNumber(value.y, 'Y 坐标'),
    z: finiteNumber(value.z, '出土深度 Z'),
    date: optionalString(value.date ?? '', '出土日期'),
    collector: optionalString(value.collector ?? '', '提取人').trim(),
    tempLocation: optionalString(value.tempLocation ?? '', '临时存放位置').trim()
  }
}

function sanitizeRelation(value: unknown): Relation {
  if (!isObject(value)) throw new ArchiveValidationError('档案中的层位关系必须是对象')
  return {
    id: requiredString(value.id, '层位关系 ID'),
    unitAId: requiredString(value.unitAId, '层位关系单位 A'),
    type: enumValue(value.type, RELATION_TYPES, '层位关系类型'),
    unitBId: requiredString(value.unitBId, '层位关系单位 B'),
    basis: enumValue(value.basis, RELATION_BASES, '判定依据'),
    recorder: optionalString(value.recorder ?? '', '记录人').trim(),
    note: optionalString(value.note ?? '', '备注').trim()
  }
}

/** 解析并校验一份单探方档案。 */
export function parseTrenchArchive(data: unknown): TrenchArchive {
  if (!isObject(data)) throw new ArchiveValidationError('档案必须是 JSON 对象')
  if (data.kind !== ARCHIVE_KIND) throw new ArchiveValidationError('不是本系统导出的单探方档案')
  if (data.version !== ARCHIVE_VERSION) throw new ArchiveValidationError(`不支持的档案版本：${String(data.version)}`)

  const trench = sanitizeTrench(data.trench)
  if (!Array.isArray(data.strata) || !Array.isArray(data.artifacts) || !Array.isArray(data.relations)) {
    throw new ArchiveValidationError('档案必须包含 strata、artifacts、relations 三个数组')
  }

  const strata = data.strata.map(sanitizeStratum)
  const artifacts = data.artifacts.map(sanitizeArtifact)
  const relations = data.relations.map(sanitizeRelation)

  strata.forEach((item) => {
    if (item.trenchId !== trench.id) {
      throw new ArchiveValidationError(`单位「${item.code}」不属于档案探方，不能并入单探方档案`)
    }
  })

  const stratumIds = new Set(strata.map((item) => item.id))
  const unitCodes = new Map<string, string>()
  strata.forEach((item) => {
    const key = normalizeUnitCode(item.code)
    if (unitCodes.has(key)) throw new ArchiveValidationError(`档案内单位号「${item.code}」重复`)
    unitCodes.set(key, item.id)
  })

  artifacts.forEach((item) => {
    if (!stratumIds.has(item.stratumId)) {
      throw new ArchiveValidationError(`出土物「${item.code}」引用了档案中不存在的单位`)
    }
  })
  const artifactCodes = new Set<string>()
  artifacts.forEach((item) => {
    if (artifactCodes.has(item.code)) throw new ArchiveValidationError(`档案内器物编号「${item.code}」重复`)
    artifactCodes.add(item.code)
  })

  relations.forEach((item) => {
    if (!stratumIds.has(item.unitAId) || !stratumIds.has(item.unitBId)) {
      throw new ArchiveValidationError('档案中存在引用缺失单位的层位关系')
    }
    if (item.unitAId === item.unitBId) throw new ArchiveValidationError('层位关系的两个单位不能相同')
  })

  return {
    kind: ARCHIVE_KIND,
    version: ARCHIVE_VERSION,
    exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
    trench,
    strata,
    artifacts,
    relations
  }
}

/** 导出一个探方及其全部地层单位、出土物与单位间关系。 */
export function buildTrenchArchive(
  trench: Trench,
  strata: Stratum[],
  artifacts: Artifact[],
  relations: Relation[]
): TrenchArchive {
  const trenchStrata = strata.filter((item) => item.trenchId === trench.id)
  const unitIds = new Set(trenchStrata.map((item) => item.id))
  const trenchArtifacts = artifacts.filter((item) => unitIds.has(item.stratumId))
  const trenchRelations = relations.filter(
    (item) => unitIds.has(item.unitAId) && unitIds.has(item.unitBId)
  )

  return {
    kind: ARCHIVE_KIND,
    version: ARCHIVE_VERSION,
    exportedAt: new Date().toISOString(),
    trench,
    strata: trenchStrata,
    artifacts: trenchArtifacts,
    relations: trenchRelations
  }
}

function relationKey(aId: string, type: RelationType, bId: string): string {
  return type === '共存' ? `共存:${[aId, bId].sort().join('|')}` : `${type}:${aId}|${bId}`
}

/**
 * 计算单探方档案的合并方案：
 * - 单位按单位号合并，只取带回稿的土质土色与包含物，深度保留工地值；
 * - 关系按单位号重新挂接，互斥的叠压/打破不写入；
 * - 出土物按器物编号追加，重号跳过；
 * - 最后重排深度序位并检查出土物是否仍位于所属单位区间。
 */
export function planTrenchArchiveMerge(
  current: MergeCollection,
  archiveInput: unknown,
  generateId: (prefix: string) => string = uid
): MergePlan {
  const archive = parseTrenchArchive(archiveInput)
  const targetKey = trenchKey(archive.trench)
  const targets = current.trenches.filter((item) => trenchKey(item) === targetKey)
  if (targets.length === 0) {
    throw new ArchiveValidationError(`工地编目中找不到探方「${targetKey}」，无法并入`)
  }
  if (targets.length > 1) {
    throw new ArchiveValidationError(`工地编目中探方「${targetKey}」有 ${targets.length} 条记录，请先处理重复探方`)
  }
  const target = targets[0]

  const currentStrata = current.strata.filter((item) => item.trenchId === target.id)
  const currentUnitIds = new Set(currentStrata.map((item) => item.id))
  const currentArtifacts = current.artifacts.filter((item) => currentUnitIds.has(item.stratumId))
  // 关系参与去重/互斥判断，但跨探方档案本身不会导出或写入跨探方关系。
  const currentRelations = current.relations.filter(
    (item) => currentUnitIds.has(item.unitAId) || currentUnitIds.has(item.unitBId)
  )

  const currentByCode = new Map<string, Stratum>()
  currentStrata.forEach((item) => {
    const key = normalizeUnitCode(item.code)
    if (currentByCode.has(key)) {
      throw new ArchiveValidationError(`工地编目内单位号「${item.code}」重复，无法安全合并`)
    }
    currentByCode.set(key, item)
  })

  const currentArtifactCodes = new Set<string>()
  currentArtifacts.forEach((item) => {
    if (currentArtifactCodes.has(item.code)) {
      throw new ArchiveValidationError(`工地编目内器物编号「${item.code}」重复，无法安全合并`)
    }
    currentArtifactCodes.add(item.code)
  })

  const report: MergePlan = {
    trenchId: target.id,
    trenchLabel: trenchKey(target),
    updatedStrata: [],
    addedStrata: [],
    addedArtifacts: [],
    skippedDuplicateArtifacts: [],
    addedRelations: [],
    skippedDuplicateRelations: [],
    skippedConflictingRelations: [],
    depthMismatches: [],
    outOfRangeArtifacts: [],
    orderedUnits: [],
    strataToPut: [],
    artifactsToPut: [],
    relationsToPut: []
  }

  const mergedStrata: Stratum[] = []
  const importedIdToMergedId = new Map<string, string>()
  const mergedCodeToId = new Map<string, string>()

  archive.strata.forEach((incoming) => {
    const key = normalizeUnitCode(incoming.code)
    const existing = currentByCode.get(key)
    if (existing) {
      importedIdToMergedId.set(incoming.id, existing.id)
      mergedCodeToId.set(key, existing.id)
      if (!sameDepth(existing.topDepth, incoming.topDepth) || !sameDepth(existing.bottomDepth, incoming.bottomDepth)) {
        report.depthMismatches.push({
          code: existing.code,
          siteTopDepth: existing.topDepth,
          siteBottomDepth: existing.bottomDepth,
          broughtTopDepth: incoming.topDepth,
          broughtBottomDepth: incoming.bottomDepth
        })
      }
      const merged: Stratum = {
        ...existing,
        soil: incoming.soil,
        inclusions: [...incoming.inclusions]
      }
      mergedStrata.push(merged)
      report.strataToPut.push(merged)
      report.updatedStrata.push(existing.code)
    } else {
      const id = generateId('st')
      const merged: Stratum = {
        ...incoming,
        id,
        trenchId: target.id
      }
      importedIdToMergedId.set(incoming.id, id)
      mergedCodeToId.set(key, id)
      mergedStrata.push(merged)
      report.strataToPut.push(merged)
      report.addedStrata.push(merged.code)
    }
  })

  // 工地原有但档案未带回的单位继续保留，不参与土质土色更新。
  currentStrata.forEach((item) => {
    const key = normalizeUnitCode(item.code)
    if (!mergedCodeToId.has(key)) {
      mergedCodeToId.set(key, item.id)
      mergedStrata.push(item)
    }
  })

  const mergedStratumIds = new Set(mergedStrata.map((item) => item.id))
  const mergedArtifacts: Artifact[] = [...currentArtifacts]
  archive.artifacts.forEach((incoming) => {
    if (currentArtifactCodes.has(incoming.code)) {
      report.skippedDuplicateArtifacts.push(incoming.code)
      return
    }
    const stratumId = importedIdToMergedId.get(incoming.stratumId)
    if (!stratumId) throw new ArchiveValidationError(`出土物「${incoming.code}」的单位重挂失败`)
    const merged: Artifact = {
      ...incoming,
      id: generateId('af'),
      stratumId
    }
    mergedArtifacts.push(merged)
    report.artifactsToPut.push(merged)
    report.addedArtifacts.push(merged.code)
    currentArtifactCodes.add(merged.code)
  })

  const mergedById = new Map(mergedStrata.map((item) => [item.id, item]))
  const incomingRelationKeys = new Set<string>()
  const existingRelationKeys = new Set(
    currentRelations.map((item) => relationKey(item.unitAId, item.type, item.unitBId))
  )
  const directedEdges = new Map<string, Set<string>>()
  const addDirectedEdge = (from: string, to: string): void => {
    const list = directedEdges.get(from) ?? new Set<string>()
    list.add(to)
    directedEdges.set(from, list)
  }
  mergedStrata.forEach((item) => directedEdges.set(item.id, new Set<string>()))
  currentRelations
    .filter((item) => item.type !== '共存')
    .forEach((item) => addDirectedEdge(item.unitAId, item.unitBId))

  archive.relations.forEach((incoming) => {
    const unitAId = importedIdToMergedId.get(incoming.unitAId)
    const unitBId = importedIdToMergedId.get(incoming.unitBId)
    if (!unitAId || !unitBId || !mergedStratumIds.has(unitAId) || !mergedStratumIds.has(unitBId)) {
      throw new ArchiveValidationError('层位关系按单位号重挂时找不到目标单位')
    }
    const key = relationKey(unitAId, incoming.type, unitBId)
    if (existingRelationKeys.has(key) || incomingRelationKeys.has(key)) {
      report.skippedDuplicateRelations.push(
        `${mergedById.get(unitAId)?.code} ${incoming.type} ${mergedById.get(unitBId)?.code}`
      )
      return
    }

    if (incoming.type !== '共存' && directedEdges.get(unitBId)?.has(unitAId)) {
      report.skippedConflictingRelations.push(
        `${mergedById.get(unitAId)?.code} ${incoming.type} ${mergedById.get(unitBId)?.code}：两个单位会互相叠压/打破，未写入`
      )
      return
    }

    const merged: Relation = {
      ...incoming,
      id: generateId('rl'),
      unitAId,
      unitBId
    }
    report.relationsToPut.push(merged)
    report.addedRelations.push(`${mergedById.get(unitAId)?.code} ${incoming.type} ${mergedById.get(unitBId)?.code}`)
    incomingRelationKeys.add(key)
    if (incoming.type !== '共存') addDirectedEdge(unitAId, unitBId)
  })

  const ordered = [...mergedStrata].sort((a, b) => {
    if (!sameDepth(a.topDepth, b.topDepth)) return a.topDepth - b.topDepth
    if (!sameDepth(a.bottomDepth, b.bottomDepth)) return a.bottomDepth - b.bottomDepth
    return a.code.localeCompare(b.code, 'zh-Hans-CN', { numeric: true })
  })
  ordered.forEach((item, index) => {
    report.orderedUnits.push({
      order: index + 1,
      code: item.code,
      topDepth: item.topDepth,
      bottomDepth: item.bottomDepth
    })
  })

  mergedArtifacts.forEach((artifact) => {
    const unit = mergedById.get(artifact.stratumId)
    if (!unit) return
    const minDepth = Math.min(unit.topDepth, unit.bottomDepth)
    const maxDepth = Math.max(unit.topDepth, unit.bottomDepth)
    if (artifact.z < minDepth - DEPTH_EPSILON || artifact.z > maxDepth + DEPTH_EPSILON) {
      report.outOfRangeArtifacts.push({
        code: artifact.code,
        unitCode: unit.code,
        z: artifact.z,
        topDepth: unit.topDepth,
        bottomDepth: unit.bottomDepth
      })
    }
  })

  return report
}
