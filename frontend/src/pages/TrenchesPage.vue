<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { Trench } from '@/types'
import { TRENCH_SIZES, findTrenchConflict, trenchKey } from '@/types'
import TrenchTag from '@/components/common/TrenchTag.vue'
import { useStore } from '@/hooks/usePersistentStore'
import { trenchStore } from '@/stores/trenchStore'
import { stratumStore } from '@/stores/stratumStore'
import { artifactStore } from '@/stores/artifactStore'
import { relationStore } from '@/stores/relationStore'
import { exportArchive, parseArchive, computeMergePlan, applyMerge, ArchiveError, type MergePlan } from '@/utils/archive'
import { downloadJson } from '@/utils/export'
import { uid } from '@/utils/id'

const trenchState = useStore(trenchStore)
const stratumState = useStore(stratumStore)
const artifactState = useStore(artifactStore)
const relationState = useStore(relationStore)

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const filterArea = ref('')

const form = reactive({
  code: '',
  area: '',
  size: '5×5 米' as Trench['size'],
  basePoint: '',
  openLayer: '第①层',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
  leader: '',
  wallNote: '',
  backfilled: false
})

const areas = computed(() => Array.from(new Set(trenchState.trenches.map((item) => item.area))))
const visible = computed(() =>
  filterArea.value ? trenchState.trenches.filter((item) => item.area === filterArea.value) : trenchState.trenches
)

watch(
  () => trenchState.trenches.length,
  () => {
    if (!form.area && trenchState.trenches.length > 0) {
      form.area = trenchState.trenches[0].area
    }
  },
  { immediate: true }
)

/** 单位数与出土物件数 */
function unitsOf(trenchId: string): number {
  return stratumState.strata.filter((item) => item.trenchId === trenchId).length
}

function artifactsOf(trenchId: string): number {
  const unitIds = stratumState.strata.filter((item) => item.trenchId === trenchId).map((item) => item.id)
  return artifactState.artifacts.filter((item) => unitIds.includes(item.stratumId)).reduce((sum, item) => sum + item.count, 0)
}

function relationsOf(trenchId: string): number {
  const unitIds = stratumState.strata.filter((item) => item.trenchId === trenchId).map((item) => item.id)
  return relationState.relations.filter((item) => unitIds.includes(item.unitAId) || unitIds.includes(item.unitBId)).length
}

/** 发掘进度状态 */
function progressOf(trench: Trench): { label: string; type: 'success' | 'warning' | 'info' } {
  if (trench.backfilled) return { label: '已回填', type: 'info' }
  if (unitsOf(trench.id) === 0) return { label: '待发掘', type: 'warning' }
  if (trench.endDate) return { label: '发掘完成', type: 'success' }
  return { label: '发掘中', type: 'success' }
}

function resetForm(): void {
  editingId.value = null
  form.code = ''
  form.area = trenchState.trenches[0]?.area ?? ''
  form.size = '5×5 米'
  form.basePoint = ''
  form.openLayer = '第①层'
  form.startDate = new Date().toISOString().slice(0, 10)
  form.endDate = ''
  form.leader = ''
  form.wallNote = ''
  form.backfilled = false
}

function openCreate(): void {
  resetForm()
  dialogVisible.value = true
}

function openEdit(trench: Trench): void {
  editingId.value = trench.id
  Object.assign(form, {
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
  })
  dialogVisible.value = true
}

async function submit(): Promise<void> {
  if (!form.code.trim() || !form.area.trim()) {
    ElMessage.warning('探方号与发掘区必填')
    return
  }
  const candidate = { id: editingId.value ?? uid('tr'), area: form.area.trim(), code: form.code.trim().toUpperCase() }
  const conflict = findTrenchConflict(trenchState.trenches, candidate)
  if (conflict) {
    ElMessage.error(`「${trenchKey(candidate)}」已存在（同发掘区探方号必须唯一）`)
    return
  }
  const row: Trench = {
    id: candidate.id,
    code: candidate.code,
    area: candidate.area,
    size: form.size,
    basePoint: form.basePoint.trim(),
    openLayer: form.openLayer.trim(),
    startDate: form.startDate,
    endDate: form.endDate,
    leader: form.leader.trim(),
    wallNote: form.wallNote.trim(),
    backfilled: form.backfilled
  }
  await trenchStore.getState().save(row)
  ElMessage.success(`探方 ${trenchKey(row)} 已保存`)
  dialogVisible.value = false
}

async function remove(trench: Trench): Promise<void> {
  const units = unitsOf(trench.id)
  if (units > 0) {
    ElMessage.error(`${trenchKey(trench)} 下仍有 ${units} 个地层单位，请先清理下级记录`)
    return
  }
  await ElMessageBox.confirm(`确认删除探方「${trenchKey(trench)}」？`, '删除确认', { type: 'warning' })
  await trenchStore.getState().remove(trench.id)
  ElMessage.success('探方已删除')
}

// ---- 档案对传（导出 / 导入合并） ----

const fileInput = ref<HTMLInputElement | null>(null)
const mergePlan = ref<MergePlan | null>(null)
const mergeDialogVisible = ref(false)
const mergeDone = ref(false)
const merging = ref(false)

/** 一个探方导出成一份档案（业务键，不含本地 id） */
function exportTrenchArchive(trench: Trench): void {
  const strata = stratumState.strata.filter((item) => item.trenchId === trench.id)
  const stratumIds = new Set(strata.map((item) => item.id))
  const artifacts = artifactState.artifacts.filter((item) => stratumIds.has(item.stratumId))
  const relations = relationState.relations.filter(
    (item) => stratumIds.has(item.unitAId) && stratumIds.has(item.unitBId)
  )
  const archive = exportArchive(trench, strata, artifacts, relations)
  downloadJson(`探方档案_${trench.area}_${trench.code}.json`, archive)
  ElMessage.success(`已导出 ${trenchKey(trench)} 的探方档案`)
}

function triggerImport(): void {
  fileInput.value?.click()
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const text = await file.text()
    const archive = parseArchive(text)
    const plan = computeMergePlan(archive, {
      trenches: trenchState.trenches,
      strata: stratumState.strata,
      artifacts: artifactState.artifacts,
      relations: relationState.relations
    })
    mergePlan.value = plan
    mergeDone.value = false
    mergeDialogVisible.value = true
  } catch (err) {
    ElMessage.error(err instanceof ArchiveError ? err.message : '档案解析失败，请确认文件未损坏')
  }
}

async function confirmMerge(): Promise<void> {
  if (!mergePlan.value) return
  merging.value = true
  try {
    await applyMerge(mergePlan.value)
    await Promise.all([
      trenchStore.getState().hydrate(),
      stratumStore.getState().hydrate(),
      artifactStore.getState().hydrate(),
      relationStore.getState().hydrate()
    ])
    mergeDone.value = true
    ElMessage.success('档案合并完成')
  } catch (err) {
    ElMessage.error(`合并失败，已恢复原编目（${err instanceof Error ? err.message : '未知错误'}）`)
    mergeDialogVisible.value = false
  } finally {
    merging.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2 class="page-title">探方清单</h2>
        <p class="page-sub">
          按「发掘区-探方号」校验唯一性；卡片展示地层单位数、出土物件数、层位关系数与发掘进度状态。
        </p>
      </div>
      <div class="head-actions">
        <el-button @click="triggerImport">
          <el-icon><Upload /></el-icon>导入档案
        </el-button>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>新建探方
        </el-button>
        <input ref="fileInput" type="file" accept="application/json,.json" style="display: none" @change="onFileChange" />
      </div>
    </div>

    <div class="toolbar">
      <el-select v-model="filterArea" placeholder="全部发掘区" clearable style="width: 180px">
        <el-option v-for="area in areas" :key="area" :label="area" :value="area" />
      </el-select>
      <el-tag effect="plain">命中 {{ visible.length }} / {{ trenchState.trenches.length }} 个探方</el-tag>
    </div>

    <div class="card-grid">
      <el-card v-for="trench in visible" :key="trench.id" shadow="hover" class="trench-card">
        <div class="card-top">
          <TrenchTag :trench="trench" />
          <el-tag :type="progressOf(trench).type" size="small" effect="plain">{{ progressOf(trench).label }}</el-tag>
        </div>
        <div class="metrics">
          <div class="metric"><span>地层单位</span><b>{{ unitsOf(trench.id) }}</b></div>
          <div class="metric"><span>出土物件数</span><b>{{ artifactsOf(trench.id) }}</b></div>
          <div class="metric"><span>层位关系</span><b>{{ relationsOf(trench.id) }}</b></div>
          <div class="metric"><span>规格</span><b>{{ trench.size }}</b></div>
        </div>
        <el-descriptions :column="1" size="small" border class="desc">
          <el-descriptions-item label="基点坐标">{{ trench.basePoint || '—' }}</el-descriptions-item>
          <el-descriptions-item label="开口层位">{{ trench.openLayer || '—' }}</el-descriptions-item>
          <el-descriptions-item label="发掘日期">
            {{ trench.startDate }} ~ {{ trench.endDate || '进行中' }}
          </el-descriptions-item>
          <el-descriptions-item label="负责人">{{ trench.leader || '—' }}</el-descriptions-item>
          <el-descriptions-item label="四壁方向备注">{{ trench.wallNote || '—' }}</el-descriptions-item>
        </el-descriptions>
        <div class="card-actions">
          <el-button size="small" @click="openEdit(trench)">编辑</el-button>
          <el-button size="small" @click="exportTrenchArchive(trench)">导出档案</el-button>
          <el-button size="small" @click="trenchStore.getState().setBackfilled(trench.id, !trench.backfilled)">
            {{ trench.backfilled ? '取消回填标记' : '标记已回填' }}
          </el-button>
          <el-button size="small" type="danger" plain @click="remove(trench)">删除</el-button>
        </div>
      </el-card>
      <el-empty v-if="visible.length === 0" description="暂无探方，先新建一个探方" />
    </div>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑探方' : '新建探方'" width="640px">
      <el-form label-width="110px">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="发掘区" required>
              <el-input v-model="form.area" placeholder="如 Ⅱ区" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="探方号" required>
              <el-input v-model="form.code" placeholder="如 T0501" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="规格">
              <el-select v-model="form.size" style="width: 100%">
                <el-option v-for="item in TRENCH_SIZES" :key="item" :label="item" :value="item" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="基点坐标">
              <el-input v-model="form.basePoint" placeholder="如 N1200 / E3000" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="开口层位">
              <el-input v-model="form.openLayer" placeholder="如 第①层" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="负责人">
              <el-input v-model="form.leader" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="发掘起始">
              <el-date-picker v-model="form.startDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="发掘结束">
              <el-date-picker v-model="form.endDate" type="date" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="四壁备注">
          <el-input v-model="form.wallNote" type="textarea" :rows="2" placeholder="如 北壁、东壁保存较好；南壁被现代扰坑破坏" />
        </el-form-item>
        <el-form-item label="是否已回填">
          <el-switch v-model="form.backfilled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="mergeDialogVisible"
      :title="mergeDone ? '档案合并结果' : '档案合并预览'"
      width="780px"
      :close-on-click-modal="false"
    >
      <template v-if="mergePlan">
        <el-alert
          v-if="mergeDone"
          class="merge-alert"
          type="success"
          :closable="false"
          show-icon
          title="档案已合并完成，未产生重复编号。同一份档案可重复导入，不会产生重复数据。"
        />
        <el-alert
          v-else
          class="merge-alert"
          type="info"
          :closable="false"
          show-icon
          title="请核对合并计划：同一地层单位按单位号并成一条，土质土色与包含物取带回来的记录，上下界深度保留工地量的值；确认后写入。"
        />

        <div class="merge-section">
          <h4>档案概要</h4>
          <p class="merge-line">
            探方：<b>{{ mergePlan.report.trenchLabel }}</b>
            <span class="muted">（导出时间 {{ mergePlan.report.archive.exportedAt || '—' }}）</span>
          </p>
          <p class="merge-line">
            探方处理：
            <el-tag size="small" :type="mergePlan.report.trenchAction === 'create' ? 'warning' : 'success'" effect="plain">
              {{ mergePlan.report.trenchAction === 'create' ? '本地无此探方，将新建探方' : '探方已存在，合入现有探方' }}
            </el-tag>
          </p>
        </div>

        <div class="merge-section">
          <h4>地层单位（按单位号合并）</h4>
          <p class="merge-line">
            新增 <b>{{ mergePlan.report.strataCreated.length }}</b> 条 · 按单位号合并
            <b>{{ mergePlan.report.strataUpdated.length }}</b> 条（土质土色/包含物取带回值，深度留工地值）· 工地独有
            <b>{{ mergePlan.report.strataUnmatchedLocal.length }}</b> 条（保留不动）
          </p>
          <p v-if="mergePlan.report.strataCreated.length" class="merge-line muted">
            新增单位：{{ mergePlan.report.strataCreated.join('、') }}
          </p>
          <p v-if="mergePlan.report.strataUnmatchedLocal.length" class="merge-line muted">
            工地有、档案无（请复核是否漏记）：{{ mergePlan.report.strataUnmatchedLocal.join('、') }}
          </p>
          <template v-if="mergePlan.report.stratumDiffs.length">
            <p class="merge-line sub-title">字段差异复核（不覆盖，仅列出）：</p>
            <ul class="merge-list">
              <li v-for="(diff, index) in mergePlan.report.stratumDiffs" :key="index">
                <span class="mono">{{ diff.code }}</span> · {{ diff.field }}：工地「{{ diff.local }}」→ 带回「{{ diff.archive }}」
              </li>
            </ul>
          </template>
          <el-empty
            v-if="
              mergePlan.report.strataCreated.length === 0 &&
              mergePlan.report.stratumDiffs.length === 0 &&
              mergePlan.report.strataUnmatchedLocal.length === 0
            "
            description="地层单位全部按单位号匹配，无新增或差异"
            :image-size="40"
          />
        </div>

        <div class="merge-section">
          <h4>出土物（按器物编号合并，重号跳过）</h4>
          <p class="merge-line">
            新增 <b>{{ mergePlan.report.artifactsToCreate.length }}</b> 件 · 重号跳过
            <b>{{ mergePlan.report.artifactsDuplicate.length }}</b> 件 · 单位号对不上跳过
            <b>{{ mergePlan.report.artifactsUnresolved.length }}</b> 件
          </p>
          <p v-if="mergePlan.report.artifactsToCreate.length" class="merge-line muted">
            新增：{{ mergePlan.report.artifactsToCreate.join('、') }}
          </p>
          <p v-if="mergePlan.report.artifactsDuplicate.length" class="merge-line muted">
            重号跳过：{{ mergePlan.report.artifactsDuplicate.join('、') }}
          </p>
          <p v-if="mergePlan.report.artifactsUnresolved.length" class="merge-line muted">
            单位号对不上：{{ mergePlan.report.artifactsUnresolved.join('、') }}
          </p>
        </div>

        <div class="merge-section">
          <h4>层位关系（按单位号重挂）</h4>
          <p class="merge-line">
            写入 <b>{{ mergePlan.report.relationsToWrite.length }}</b> 条 · 跳过
            <b>{{ mergePlan.report.relationsSkipped.length }}</b> 条（互相叠压/打破、重号或单位号对不上）
          </p>
          <p v-if="mergePlan.report.relationsToWrite.length" class="merge-line muted">
            写入：{{ mergePlan.report.relationsToWrite.join('；') }}
          </p>
          <template v-if="mergePlan.report.relationsSkipped.length">
            <p class="merge-line sub-title">暂不写入（请复核）：</p>
            <ul class="merge-list">
              <li v-for="(item, index) in mergePlan.report.relationsSkipped" :key="index">
                <span class="mono">{{ item.label }}</span> — {{ item.reason }}
              </li>
            </ul>
          </template>
        </div>

        <div class="merge-section">
          <h4>合并后核对（重算序位）</h4>
          <el-alert
            v-if="mergePlan.report.postInverted.length === 0 && mergePlan.report.postConflicts.length === 0 && mergePlan.report.postOutOfBounds.length === 0"
            type="success"
            :closable="false"
            show-icon
            title="层序、关系与出土物深度核对通过"
          />
          <el-alert
            v-else
            type="warning"
            :closable="false"
            show-icon
            title="以下问题需复核"
          >
            <ul class="merge-list">
              <li v-for="(code, index) in mergePlan.report.postInverted" :key="`inv-${index}`">
                <span class="mono">{{ code }}</span> 层序倒置（上界深度大于下界深度）
              </li>
              <li v-for="(conflict, index) in mergePlan.report.postConflicts" :key="`cf-${index}`">{{ conflict }}</li>
              <li v-for="(item, index) in mergePlan.report.postOutOfBounds" :key="`ob-${index}`">
                <span class="mono">{{ item.code }}</span> 出土深度 {{ item.z }} m 不在所属单位区间 {{ item.range }} 内
              </li>
            </ul>
          </el-alert>
        </div>
      </template>
      <template #footer>
        <el-button @click="mergeDialogVisible = false">{{ mergeDone ? '完成' : '取消' }}</el-button>
        <el-button v-if="!mergeDone" type="primary" :loading="merging" @click="confirmMerge">确认合并并写入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.trench-card {
  border-radius: 12px;
}
.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.metrics {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}
.metric {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f7f4ee;
  font-size: 12px;
  color: #7d7264;
}
.metric b {
  font-size: 14px;
  color: #3c2f1f;
}
.desc {
  margin-bottom: 12px;
}
.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.head-actions {
  display: flex;
  gap: 8px;
}
.merge-alert {
  margin-bottom: 12px;
}
.merge-section {
  padding: 10px 0;
  border-bottom: 1px dashed #e6ded0;
}
.merge-section:last-of-type {
  border-bottom: none;
}
.merge-section h4 {
  margin: 0 0 6px;
  font-size: 14px;
  color: #3c2f1f;
}
.merge-line {
  margin: 2px 0;
  font-size: 13px;
  line-height: 1.7;
}
.merge-line.sub-title {
  margin-top: 6px;
  color: #7d7264;
}
.merge-list {
  margin: 4px 0 0;
  padding-left: 20px;
  font-size: 12px;
  line-height: 1.8;
  color: #5c452b;
}
</style>
