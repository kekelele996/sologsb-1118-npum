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
import { mergeTrenchArchive } from '@/stores/archiveStore'
import { buildTrenchArchive, ArchiveValidationError, type MergeReport } from '@/utils/archive'
import { downloadJson } from '@/utils/export'
import { uid } from '@/utils/id'

const trenchState = useStore(trenchStore)
const stratumState = useStore(stratumStore)
const artifactState = useStore(artifactStore)
const relationState = useStore(relationStore)

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const filterArea = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)
const reportVisible = ref(false)
const latestReport = ref<MergeReport | null>(null)
const activeReportPanels = ref(['depth', 'outOfRange', 'artifacts', 'relations', 'order'])

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
const reviewCount = computed(() => {
  const report = latestReport.value
  if (!report) return 0
  return (
    report.depthMismatches.length +
    report.skippedConflictingRelations.length +
    report.skippedDuplicateArtifacts.length +
    report.skippedDuplicateRelations.length +
    report.outOfRangeArtifacts.length
  )
})

function formatDepth(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000)
}

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

/** 导出一份单探方档案，供整理室带走补录 */
function exportArchive(trench: Trench): void {
  const archive = buildTrenchArchive(
    trench,
    stratumState.strata,
    artifactState.artifacts,
    relationState.relations
  )
  const filename = `${trenchKey(trench)}-archive.json`.replace(/[\\/:*?"<>|\s]+/g, '_')
  downloadJson(filename, archive)
  ElMessage.success(`已导出探方 ${trenchKey(trench)} 档案`)
}

function triggerImport(): void {
  fileInput.value?.click()
}

async function handleArchiveFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || importing.value) return

  importing.value = true
  try {
    const raw = JSON.parse(await file.text())
    const report = await mergeTrenchArchive(raw)
    latestReport.value = report
    reportVisible.value = true
    if (reviewCount.value > 0) {
      ElMessage.warning(`档案已并入，${reviewCount.value} 项需要复核`)
    } else {
      ElMessage.success('档案已并入，无需复核')
    }
  } catch (error) {
    const message =
      error instanceof SyntaxError
        ? '档案不是合法 JSON，未并入'
        : error instanceof ArchiveValidationError
          ? error.message
          : error instanceof Error
            ? `并入失败：${error.message}`
            : '并入失败，未改动当前编目'
    ElMessage.error(message)
  } finally {
    importing.value = false
  }
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
        <input
          ref="fileInput"
          type="file"
          accept="application/json,.json"
          class="archive-file-input"
          @change="handleArchiveFile"
        />
        <el-button :loading="importing" @click="triggerImport">
          <el-icon><Upload /></el-icon>并入档案
        </el-button>
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>新建探方
        </el-button>
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
          <el-button size="small" @click="exportArchive(trench)">导出档案</el-button>
          <el-button size="small" @click="trenchStore.getState().setBackfilled(trench.id, !trench.backfilled)">
            {{ trench.backfilled ? '取消回填标记' : '标记已回填' }}
          </el-button>
          <el-button size="small" type="danger" plain @click="remove(trench)">删除</el-button>
        </div>
      </el-card>
      <el-empty v-if="visible.length === 0" description="暂无探方，先新建一个探方" />
    </div>

    <el-dialog v-model="reportVisible" title="档案并入报告" width="820px" top="6vh">
      <template v-if="latestReport">
        <el-alert
          :type="reviewCount > 0 ? 'warning' : 'success'"
          :closable="false"
          show-icon
          class="report-alert"
          :title="reviewCount > 0 ? `已完成并入，有 ${reviewCount} 项需要复核` : '已完成并入，未发现需要复核的项目'"
        />

        <el-descriptions :column="3" size="small" border class="report-summary">
          <el-descriptions-item label="目标探方">{{ latestReport.trenchLabel }}</el-descriptions-item>
          <el-descriptions-item label="更新单位">{{ latestReport.updatedStrata.length }}</el-descriptions-item>
          <el-descriptions-item label="新增单位">{{ latestReport.addedStrata.length }}</el-descriptions-item>
          <el-descriptions-item label="新增出土物">{{ latestReport.addedArtifacts.length }}</el-descriptions-item>
          <el-descriptions-item label="新增关系">{{ latestReport.addedRelations.length }}</el-descriptions-item>
          <el-descriptions-item label="重算后单位数">{{ latestReport.orderedUnits.length }}</el-descriptions-item>
        </el-descriptions>

        <el-collapse v-model="activeReportPanels" class="report-collapse">
          <el-collapse-item name="depth">
            <template #title>
              <span :class="{ 'review-title': latestReport.depthMismatches.length > 0 }">
                深度上下界不一致（{{ latestReport.depthMismatches.length }}）
              </span>
            </template>
            <el-table :data="latestReport.depthMismatches" size="small" empty-text="上下界深度一致，无需复核">
              <el-table-column prop="code" label="单位号" width="110" />
              <el-table-column label="带回稿深度（未采用）" min-width="180">
                <template #default="{ row }">
                  {{ formatDepth(row.broughtTopDepth) }}–{{ formatDepth(row.broughtBottomDepth) }} m
                </template>
              </el-table-column>
              <el-table-column label="工地量得深度（已保留）" min-width="180">
                <template #default="{ row }">
                  {{ formatDepth(row.siteTopDepth) }}–{{ formatDepth(row.siteBottomDepth) }} m
                </template>
              </el-table-column>
            </el-table>
          </el-collapse-item>

          <el-collapse-item name="outOfRange">
            <template #title>
              <span :class="{ 'review-title': latestReport.outOfRangeArtifacts.length > 0 }">
                出土物深度越界（{{ latestReport.outOfRangeArtifacts.length }}）
              </span>
            </template>
            <el-table :data="latestReport.outOfRangeArtifacts" size="small" empty-text="出土物深度均在所属单位区间内">
              <el-table-column prop="code" label="器物编号" min-width="170" />
              <el-table-column prop="unitCode" label="所属单位" width="110" />
              <el-table-column label="出土深度" width="110">
                <template #default="{ row }">{{ formatDepth(row.z) }} m</template>
              </el-table-column>
              <el-table-column label="单位区间" min-width="150">
                <template #default="{ row }">
                  {{ formatDepth(row.topDepth) }}–{{ formatDepth(row.bottomDepth) }} m
                </template>
              </el-table-column>
            </el-table>
          </el-collapse-item>

          <el-collapse-item name="artifacts">
            <template #title>
              <span :class="{ 'review-title': latestReport.skippedDuplicateArtifacts.length > 0 }">
                出土物处理（新增 {{ latestReport.addedArtifacts.length }} / 重号
                {{ latestReport.skippedDuplicateArtifacts.length }}）
              </span>
            </template>
            <div v-if="latestReport.skippedDuplicateArtifacts.length > 0" class="report-section">
              <b>重号器物已跳过：</b>
              <ul>
                <li v-for="item in latestReport.skippedDuplicateArtifacts" :key="item">{{ item }}</li>
              </ul>
            </div>
            <el-empty
              v-if="latestReport.skippedDuplicateArtifacts.length === 0"
              description="出土物无重号"
              :image-size="70"
            />
          </el-collapse-item>

          <el-collapse-item name="relations">
            <template #title>
              <span :class="{ 'review-title': latestReport.skippedConflictingRelations.length > 0 }">
                层位关系处理（冲突 {{ latestReport.skippedConflictingRelations.length }} / 重号
                {{ latestReport.skippedDuplicateRelations.length }}）
              </span>
            </template>
            <div v-if="latestReport.skippedConflictingRelations.length > 0" class="report-section">
              <b>互相叠压/打破，已暂不写入：</b>
              <ul>
                <li v-for="item in latestReport.skippedConflictingRelations" :key="item">{{ item }}</li>
              </ul>
            </div>
            <div v-if="latestReport.skippedDuplicateRelations.length > 0" class="report-section">
              <b>重号关系已跳过：</b>
              <ul>
                <li v-for="item in latestReport.skippedDuplicateRelations" :key="item">{{ item }}</li>
              </ul>
            </div>
            <el-empty
              v-if="latestReport.skippedConflictingRelations.length === 0 && latestReport.skippedDuplicateRelations.length === 0"
              description="关系均已按单位号重挂，无冲突或重号"
              :image-size="70"
            />
          </el-collapse-item>

          <el-collapse-item name="order">
            <template #title>深度序位（重算后 {{ latestReport.orderedUnits.length }} 个单位）</template>
            <el-table :data="latestReport.orderedUnits" size="small" max-height="260">
              <el-table-column prop="order" label="序位" width="80" />
              <el-table-column prop="code" label="单位号" width="140" />
              <el-table-column label="深度区间" min-width="160">
                <template #default="{ row }">
                  {{ formatDepth(row.topDepth) }}–{{ formatDepth(row.bottomDepth) }} m
                </template>
              </el-table-column>
            </el-table>
          </el-collapse-item>
        </el-collapse>
      </template>
      <template #footer>
        <el-button type="primary" @click="reportVisible = false">知道了</el-button>
      </template>
    </el-dialog>

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
  </div>
</template>

<style scoped>
.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.archive-file-input {
  display: none;
}
.report-alert {
  margin-bottom: 12px;
}
.report-summary {
  margin-bottom: 12px;
}
.report-collapse {
  border-top: none;
}
.report-section {
  margin-bottom: 10px;
  line-height: 1.7;
}
.review-title {
  color: #b36a12;
  font-weight: 600;
}
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
</style>
