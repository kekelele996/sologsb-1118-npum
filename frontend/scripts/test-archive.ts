import { exportArchive, parseArchive, computeMergePlan, type LocalData } from '../src/utils/archive'
import type { Artifact, Relation, Stratum, Trench } from '../src/types'

let failures = 0
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    console.log(`  PASS ${name}`)
  } else {
    failures += 1
    console.log(`  FAIL ${name} ${extra}`)
  }
}

// ---- 本地（工地）编目 ----
const localTrench: Trench = {
  id: 'tr_1', code: 'T0501', area: 'Ⅱ区', size: '5×5 米',
  basePoint: 'N1200 / E3000', openLayer: '第①层', startDate: '2026-09-01', endDate: '',
  leader: '方铭', wallNote: '', backfilled: false
}
const localStrata: Stratum[] = [
  { id: 'st_l1', trenchId: 'tr_1', code: 'L01', type: '地层', openLayer: '第①层', topDepth: 0, bottomDepth: 0.35, soil: '本地土', inclusions: ['陶片'], formation: '耕土层', date: '2026-09-01', drawingNo: '' },
  { id: 'st_l2', trenchId: 'tr_1', code: 'L02', type: '地层', openLayer: '第②层', topDepth: 0.3, bottomDepth: 0.7, soil: '本地土2', inclusions: ['骨'], formation: '汉代文化层', date: '2026-09-01', drawingNo: '' },
  { id: 'st_h1', trenchId: 'tr_1', code: 'H01', type: '灰坑', openLayer: '第②层下', topDepth: 0.7, bottomDepth: 1.2, soil: '本地灰坑土', inclusions: ['炭屑'], formation: '生活垃圾坑', date: '2026-09-01', drawingNo: '' }
]
const localArtifacts: Artifact[] = [
  { id: 'af_1', stratumId: 'st_l1', code: 'T0501①:1', category: '陶器', count: 1, completeness: '残片', x: 1, y: 1, z: 0.15, date: '2026-09-01', collector: '甲', tempLocation: '' },
  { id: 'af_2', stratumId: 'st_l2', code: 'T0501②:1', category: '陶器', count: 1, completeness: '残片', x: 1, y: 1, z: 0.5, date: '2026-09-01', collector: '甲', tempLocation: '' }
]
const localRelations: Relation[] = [
  { id: 'rl_1', unitAId: 'st_l1', type: '叠压', unitBId: 'st_l2', basis: '剖面观察', recorder: '方铭', note: '' }
]

const local: LocalData = { trenches: [localTrench], strata: localStrata, artifacts: localArtifacts, relations: localRelations }

// ---- 整理室带回来的档案 ----
const archive = {
  format: 'gbtrenchlog-archive',
  version: 1,
  exportedAt: '2026-09-29T10:00:00.000Z',
  trench: { code: 'T0501', area: 'Ⅱ区' },
  strata: [
    { code: 'L01', type: '地层', openLayer: '第①层', topDepth: 0, bottomDepth: 0.3, soil: '整理室补的土色', inclusions: ['陶片', '炭屑'], formation: '耕土层', date: '2026-09-01', drawingNo: '' },
    { code: 'L02', type: '地层', openLayer: '第②层', topDepth: 0.3, bottomDepth: 0.7, soil: '整理室补的土色2', inclusions: ['骨', '石器'], formation: '汉代堆积层', date: '2026-09-01', drawingNo: '' },
    { code: 'H02', type: '灰坑', openLayer: '第②层下', topDepth: 1.2, bottomDepth: 1.8, soil: '新灰坑土', inclusions: ['陶片'], formation: '生活垃圾坑', date: '2026-09-01', drawingNo: '' }
  ],
  artifacts: [
    { code: 'T0501①:2', stratumCode: 'L01', category: '陶器', count: 1, completeness: '残片', x: 1, y: 1, z: 0.2, date: '2026-09-01', collector: '乙', tempLocation: '' },
    { code: 'T0501②:1', stratumCode: 'L02', category: '陶器', count: 1, completeness: '残片', x: 1, y: 1, z: 0.5, date: '2026-09-01', collector: '乙', tempLocation: '' },
    { code: 'T0501H02:1', stratumCode: 'H02', category: '陶器', count: 1, completeness: '残片', x: 1, y: 1, z: 1.5, date: '2026-09-01', collector: '乙', tempLocation: '' },
    { code: 'T0501H02:2', stratumCode: 'H02', category: '陶器', count: 1, completeness: '残片', x: 1, y: 1, z: 2.0, date: '2026-09-01', collector: '乙', tempLocation: '' },
    { code: 'T0501XX:1', stratumCode: 'XX', category: '陶器', count: 1, completeness: '残片', x: 1, y: 1, z: 0.5, date: '2026-09-01', collector: '乙', tempLocation: '' }
  ],
  relations: [
    { unitACode: 'L01', type: '叠压', unitBCode: 'L02', basis: '剖面观察', recorder: '方铭', note: '' },
    { unitACode: 'L02', type: '叠压', unitBCode: 'H02', basis: '剖面观察', recorder: '方铭', note: '' },
    { unitACode: 'H02', type: '打破', unitBCode: 'L02', basis: '剖面观察', recorder: '方铭', note: '' },
    { unitACode: 'L01', type: '叠压', unitBCode: 'H02', basis: '剖面观察', recorder: '方铭', note: '' },
    { unitACode: 'XX', type: '叠压', unitBCode: 'L01', basis: '剖面观察', recorder: '方铭', note: '' }
  ]
}

console.log('== 档案解析 ==')
const parsed = parseArchive(JSON.stringify(archive))
check('解析出 1 个探方', parsed.trench.code === 'T0501' && parsed.trench.area === 'Ⅱ区')
check('解析出 3 个地层单位', parsed.strata.length === 3)
check('解析出 5 件出土物', parsed.artifacts.length === 5)
check('解析出 5 条层位关系', parsed.relations.length === 5)

console.log('== 导出 ==')
const exported = exportArchive(localTrench, localStrata, localArtifacts, localRelations)
check('导出含探方', exported.trench.code === 'T0501')
check('导出 3 地层 / 2 出土物 / 1 关系', exported.strata.length === 3 && exported.artifacts.length === 2 && exported.relations.length === 1)
check('导出不含本地 id', JSON.stringify(exported).includes('st_l1') === false && JSON.stringify(exported).includes('af_1') === false)

console.log('== 合并计划 ==')
const plan = computeMergePlan(parsed, local)
const r = plan.report
check('探方已存在（合入）', r.trenchAction === 'merge')
check('新增单位 H02', r.strataCreated.length === 1 && r.strataCreated[0] === 'H02', JSON.stringify(r.strataCreated))
check('按单位号合并 L01/L02', r.strataUpdated.length === 2, JSON.stringify(r.strataUpdated))
check('工地独有 H01 保留', r.strataUnmatchedLocal.length === 1 && r.strataUnmatchedLocal[0] === 'H01')
check('字段差异列出 L02 堆积成因', r.stratumDiffs.some((d) => d.code === 'L02' && d.field === '堆积成因'), JSON.stringify(r.stratumDiffs))

// 深度留工地值：L01 本地 bottom 0.35，档案 0.3 → 合并后应为 0.35
const l01Put = plan.strataToPut.find((s) => s.code === 'L01')
check('上下界深度留工地值（L01 bottom=0.35）', l01Put?.bottomDepth === 0.35, `got ${l01Put?.bottomDepth}`)
const l01Updated = plan.strataToPut.find((s) => s.code === 'L01')
check('土质土色取带回值', l01Updated?.soil === '整理室补的土色', l01Updated?.soil)
check('包含物取带回值', JSON.stringify(l01Updated?.inclusions) === JSON.stringify(['陶片', '炭屑']), JSON.stringify(l01Updated?.inclusions))

console.log('== 出土物合并 ==')
check('新增 3 件（①:2、H02:1、H02:2）', r.artifactsToCreate.length === 3, JSON.stringify(r.artifactsToCreate))
check('重号跳过 1 件（②:1）', r.artifactsDuplicate.length === 1 && r.artifactsDuplicate[0] === 'T0501②:1')
check('单位号对不上跳过 1 件（XX:1）', r.artifactsUnresolved.length === 1 && r.artifactsUnresolved[0] === 'T0501XX:1')

console.log('== 层位关系重挂 ==')
check('写入 2 条（L02→H02、L01→H02）', r.relationsToWrite.length === 2, JSON.stringify(r.relationsToWrite))
check('跳过 3 条', r.relationsSkipped.length === 3, JSON.stringify(r.relationsSkipped))
check('重号跳过 L01→L02', r.relationsSkipped.some((s) => s.label === 'L01 叠压 L02' && s.reason.includes('重号')), JSON.stringify(r.relationsSkipped))
check('互相叠压/打破跳过 H02→L02', r.relationsSkipped.some((s) => s.label === 'H02 打破 L02' && s.reason.includes('互相叠压或打破')), JSON.stringify(r.relationsSkipped))
check('单位号对不上跳过 XX→L01', r.relationsSkipped.some((s) => s.label === 'XX 叠压 L01' && s.reason.includes('对不上')), JSON.stringify(r.relationsSkipped))

console.log('== 合并后核对 ==')
check('无层序倒置', r.postInverted.length === 0, JSON.stringify(r.postInverted))
check('无关系与深度矛盾', r.postConflicts.length === 0, JSON.stringify(r.postConflicts))
check('出土物越界列出 H02:2', r.postOutOfBounds.length === 1 && r.postOutOfBounds[0].code === 'T0501H02:2' && r.postOutOfBounds[0].z === 2 && r.postOutOfBounds[0].range === '1.2–1.8 m', JSON.stringify(r.postOutOfBounds))
check('重算序位 H02 排第 4', r.postOrder.indexOf.get(plan.strataToPut.find((s) => s.code === 'H02')?.id ?? '') === 4)

console.log('== 幂等：同一份档案并两次 ==')
// 模拟第一次合并写入后的本地编目
const appliedStrata: Stratum[] = [
  ...localStrata.map((s) => {
    const put = plan.strataToPut.find((p) => p.id === s.id)
    return put ?? s
  }),
  ...plan.strataToPut.filter((p) => !localStrata.some((s) => s.id === p.id))
]
const appliedArtifacts: Artifact[] = [...localArtifacts, ...plan.artifactsToPut]
const appliedRelations: Relation[] = [...localRelations, ...plan.relationsToPut]
const local2: LocalData = { trenches: [localTrench], strata: appliedStrata, artifacts: appliedArtifacts, relations: appliedRelations }
const plan2 = computeMergePlan(parsed, local2)
check('第二次无新增地层', plan2.report.strataCreated.length === 0, JSON.stringify(plan2.report.strataCreated))
check('第二次无新增出土物', plan2.report.artifactsToCreate.length === 0, JSON.stringify(plan2.report.artifactsToCreate))
check('第二次无写入关系', plan2.report.relationsToWrite.length === 0, JSON.stringify(plan2.report.relationsToWrite))
check('第二次出土物无重复（总数不变）', appliedArtifacts.length + plan2.artifactsToPut.length === 5)

console.log('== 新建探方（本地无此探方） ==')
const emptyLocal: LocalData = { trenches: [], strata: [], artifacts: [], relations: [] }
const plan3 = computeMergePlan(parsed, emptyLocal)
check('标记新建探方', plan3.report.trenchAction === 'create' && plan3.createTrench === true)
check('新探方 id 已生成', plan3.trench.id.length > 0)
check('3 个单位全部新建', plan3.report.strataCreated.length === 3)
check('5 件出土物中 4 件可归并（1 件单位号对不上）', plan3.report.artifactsToCreate.length === 4 && plan3.report.artifactsUnresolved.length === 1)
check('5 条关系中 3 条写入（1 重号? 无重号；1 环路；1 对不上）', plan3.report.relationsToWrite.length === 3 && plan3.report.relationsSkipped.length === 2, JSON.stringify(plan3.report.relationsToWrite))

console.log('== 非法档案 ==')
let threw = false
try { parseArchive('not json') } catch { threw = true }
check('非 JSON 抛错', threw)
threw = false
try { parseArchive(JSON.stringify({ format: 'wrong', version: 1, trench: { code: 'T1', area: 'Ⅰ区' }, strata: [], artifacts: [], relations: [] })) } catch { threw = true }
check('错误格式标记抛错', threw)
threw = false
try { parseArchive(JSON.stringify({ format: 'gbtrenchlog-archive', version: 1, trench: { code: '', area: '' }, strata: [], artifacts: [], relations: [] })) } catch { threw = true }
check('缺探方信息抛错', threw)

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
