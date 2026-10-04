<template>
  <section class="page" data-module="catering">
    <header class="page-head">
      <div>
        <h2>航空配餐管理</h2>
        <p class="page-desc">
          配送时登记份数与装载舱门；装车数超过登记份数一律拒绝。核对结论随作业持久化，刷新、重进、换页签都不丢失。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记配餐作业</button>
        <button class="btn" type="button" @click="exportRows">导出航空配餐清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>数量核对</th>
          <th>当前状态</th>
          <th>可执行动作</th>
          <th>明细</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="job in jobs" :key="job.id">
          <td>{{ job.作业编号 }}</td>
          <td>{{ job.航班号 }}</td>
          <td>{{ portionsOf(job) }}</td>
          <td>{{ job.配餐公司 }}</td>
          <td>{{ job.餐车编号 || '—' }}</td>
          <td>{{ job.装载舱门 || '—' }}</td>
          <td>{{ job.签认人 || '—' }}</td>
          <td>
            <span class="check-badge" :class="badgeClass(job.核对结果)">{{ job.核对结果 }}</span>
          </td>
          <td>{{ job.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(job)"
              :key="action.name"
              class="link"
              type="button"
              @click="action.run(job)"
            >
              {{ action.name }}
            </button>
            <span v-if="!availableActions(job).length" class="muted-text">—</span>
          </td>
          <td><button class="link" type="button" @click="openDetail(job)">查看</button></td>
        </tr>
        <tr v-if="!jobs.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无航空配餐数据，可先登记配餐作业</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ jobs.length }} 条配餐作业，份数口径统一取自领域服务（配送登记份数，未配送取餐食数量）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 登记作业 -->
    <div v-if="modal === 'create'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>登记配餐作业</h3>
        <form @submit.prevent="submitCreate">
          <label class="form-item">
            <span>作业编号</span>
            <input v-model="createForm.作业编号" placeholder="如 CATE-0101" />
          </label>
          <label class="form-item">
            <span>航班号</span>
            <input v-model="createForm.航班号" placeholder="如 CA1831" />
          </label>
          <label class="form-item">
            <span>餐食总份数</span>
            <input v-model.number="createForm.餐食数量" type="number" min="1" />
          </label>
          <label class="form-item">
            <span>配餐公司</span>
            <input v-model="createForm.配餐公司" placeholder="如 北京航食" />
          </label>
          <p v-if="modalError" class="error-text">{{ modalError }}</p>
          <div class="modal-actions">
            <button class="btn" type="button" @click="closeModal">取消</button>
            <button class="btn primary" type="submit">登记</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 开始配送：登记份数与舱门 -->
    <div v-if="modal === 'deliver'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>开始配送 · {{ activeJob?.作业编号 }}</h3>
        <p class="modal-tip">配送登记是后续数量核对的唯一依据，装车份数超过登记份数将被拒绝。</p>
        <form @submit.prevent="submitDeliver">
          <label class="form-item">
            <span>登记份数</span>
            <input v-model.number="deliverForm.登记份数" type="number" min="1" />
          </label>
          <label class="form-item">
            <span>装载舱门</span>
            <input v-model="deliverForm.装载舱门" placeholder="如 L2" />
          </label>
          <p v-if="modalError" class="error-text">{{ modalError }}</p>
          <div class="modal-actions">
            <button class="btn" type="button" @click="closeModal">取消</button>
            <button class="btn primary" type="submit">开始配送</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 数量核对：登记实际装车数 -->
    <div v-if="modal === 'check'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>数量核对 · {{ activeJob?.作业编号 }}</h3>
        <p class="modal-tip">
          登记份数 <strong>{{ activeJob ? portionsOf(activeJob) : 0 }}</strong>，舱门 {{ activeJob?.装载舱门 }}；
          装车数超过登记数一律拒绝，少装不予交接。
        </p>
        <form @submit.prevent="submitCheck">
          <label class="form-item">
            <span>实际装车份数</span>
            <input v-model.number="checkForm.装车份数" type="number" min="1" />
          </label>
          <p v-if="modalError" class="error-text">{{ modalError }}</p>
          <div class="modal-actions">
            <button class="btn" type="button" @click="closeModal">取消</button>
            <button class="btn primary" type="submit">提交核对</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 交接签认 -->
    <div v-if="modal === 'handover'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>交接签认 · {{ activeJob?.作业编号 }}</h3>
        <p class="modal-tip">
          核对结论：<span class="check-badge" :class="badgeClass(activeJob?.核对结果 ?? '未核对')">{{ activeJob?.核对结果 }}</span>
          ，交接份数 <strong>{{ activeJob ? portionsOf(activeJob) : 0 }}</strong>；交接人签认后才进入已交接，重复交接不重复记数。
        </p>
        <form @submit.prevent="submitHandover">
          <label class="form-item">
            <span>交接人签认</span>
            <input v-model="handoverForm.签认人" placeholder="签认人姓名" />
          </label>
          <p v-if="modalError" class="error-text">{{ modalError }}</p>
          <div class="modal-actions">
            <button class="btn" type="button" @click="closeModal">取消</button>
            <button class="btn primary" type="submit">确认交接</button>
          </div>
        </form>
      </div>
    </div>

    <!-- 明细：读同一份领域数据，不另行重算 -->
    <div v-if="modal === 'detail' && activeJob" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>配餐作业明细 · {{ activeJob.作业编号 }}</h3>
        <dl class="detail-grid">
          <dt>航班号</dt><dd>{{ activeJob.航班号 }}</dd>
          <dt>配餐公司</dt><dd>{{ activeJob.配餐公司 }}</dd>
          <dt>餐车编号</dt><dd>{{ activeJob.餐车编号 || '—' }}</dd>
          <dt>装载舱门</dt><dd>{{ activeJob.装载舱门 || '—' }}</dd>
          <dt>计划餐食数量</dt><dd>{{ activeJob.餐食数量 }}</dd>
          <dt>配送登记份数</dt><dd>{{ activeJob.登记份数 }}</dd>
          <dt>实际装车份数</dt><dd>{{ activeJob.装车份数 ?? '—' }}</dd>
          <dt>口径份数</dt><dd><strong>{{ portionsOf(activeJob) }}</strong></dd>
          <dt>核对结果</dt>
          <dd><span class="check-badge" :class="badgeClass(activeJob.核对结果)">{{ activeJob.核对结果 }}</span></dd>
          <dt>核对时间</dt><dd>{{ activeJob.核对时间 || '—' }}</dd>
          <dt>当前状态</dt><dd>{{ activeJob.status }}</dd>
          <dt>签认人</dt><dd>{{ activeJob.签认人 || '—' }}</dd>
          <dt>交接时间</dt><dd>{{ activeJob.交接时间 || '—' }}</dd>
        </dl>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="closeModal">关闭</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'

import {
  canonicalPortions,
  cateringStats,
  checkLoading,
  confirmHandover,
  createJob,
  listJobs,
  startDelivery,
  submitHandover as submitHandoverJob,
} from '@/api/catering-service'
import { downloadEntries } from '@/api/local-service'
import { onStoreChange } from '@/data/local-store'
import type { CateringJob, CheckResult } from '@/data/types'

const columns = ['作业编号', '航班号', '份数', '配餐公司', '餐车编号', '装载舱门', '交接人员']
const statuses = ['待配餐', '配送中', '待交接', '已交接']
const filterFields = ['作业编号', '航班号', '配餐公司']

const jobs = ref<CateringJob[]>([])
const errorMessage = ref('')
const filters = reactive<Record<string, string>>({})

// 弹窗状态：同一份作业数据在列表与明细间传递，只有 activeJob 这一份。
type ModalKind = '' | 'create' | 'deliver' | 'check' | 'handover' | 'detail'
const modal = ref<ModalKind>('')
const activeJob = ref<CateringJob | null>(null)
const modalError = ref('')
const createForm = reactive({ 作业编号: '', 航班号: '', 餐食数量: 100, 配餐公司: '' })
const deliverForm = reactive({ 登记份数: 0, 装载舱门: '' })
const checkForm = reactive({ 装车份数: 0 })
const handoverForm = reactive({ 签认人: '' })

// 统计卡片、份数、核对徽标全部调用领域服务/统一函数，页面自身不做第二份计算。
const statCards = computed(() => {
  const stats = cateringStats()
  return [
    { label: '今日配餐架次', value: stats.todayJobs },
    { label: '配送中作业', value: stats.delivering },
    { label: '餐食总份数', value: stats.totalPortions },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: jobs.value.filter((job) => job.status === status).length,
  })),
)

function portionsOf(job: CateringJob): number {
  return canonicalPortions(job)
}

function badgeClass(result: CheckResult): string {
  if (result === '一致') return 'badge-ok'
  if (result === '多装') return 'badge-danger'
  if (result === '少装') return 'badge-warn'
  return 'badge-muted'
}

// 状态机唯一推进路径：待配餐 → 配送中 → 待交接 → 已交接，越级动作直接不给入口。
function availableActions(job: CateringJob): { name: string; run: (row: CateringJob) => void }[] {
  if (job.status === '待配餐') {
    return [{ name: '开始配送', run: openDeliver }]
  }
  if (job.status === '配送中') {
    return [
      { name: '数量核对', run: openCheck },
      { name: '提交交接', run: doSubmitHandover },
    ]
  }
  if (job.status === '待交接') {
    return [{ name: '确认交接', run: openHandover }]
  }
  return []
}

function reload() {
  errorMessage.value = ''
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  const all = listJobs()
  jobs.value = pairs.length
    ? all.filter((job) => pairs.every(([field, value]) => String(job[field as keyof CateringJob] ?? '').includes(value.trim())))
    : all
}

function resetFilters() {
  for (const key of Object.keys(filters)) {
    filters[key] = ''
  }
  reload()
}

function exportRows() {
  downloadEntries('catering')
}

function closeModal() {
  modal.value = ''
  activeJob.value = null
  modalError.value = ''
}

function openCreate() {
  Object.assign(createForm, { 作业编号: '', 航班号: '', 餐食数量: 100, 配餐公司: '' })
  modalError.value = ''
  modal.value = 'create'
}

function submitCreate() {
  const result = createJob({ ...createForm })
  if (!result.ok) {
    modalError.value = result.message
    return
  }
  closeModal()
  errorMessage.value = ''
  reload()
}

function openDeliver(job: CateringJob) {
  activeJob.value = job
  Object.assign(deliverForm, { 登记份数: canonicalPortions(job), 装载舱门: '' })
  modalError.value = ''
  modal.value = 'deliver'
}

function submitDeliver() {
  if (!activeJob.value) {
    return
  }
  const result = startDelivery(activeJob.value.id, { ...deliverForm })
  if (!result.ok) {
    modalError.value = result.message
    return
  }
  closeModal()
  reload()
}

function openCheck(job: CateringJob) {
  activeJob.value = job
  Object.assign(checkForm, { 装车份数: canonicalPortions(job) })
  modalError.value = ''
  modal.value = 'check'
}

function submitCheck() {
  if (!activeJob.value) {
    return
  }
  // 超载时服务返回 ok:false，但核对结论（多装）已落库：刷新弹窗数据让明细可见。
  const result = checkLoading(activeJob.value.id, Number(checkForm.装车份数))
  reload()
  activeJob.value = listJobs().find((job) => job.id === activeJob.value?.id) ?? null
  if (!result.ok) {
    modalError.value = result.message
    return
  }
  closeModal()
}

function doSubmitHandover(job: CateringJob) {
  const result = submitHandoverJob(job.id)
  if (!result.ok) {
    errorMessage.value = result.message
  }
  reload()
}

function openHandover(job: CateringJob) {
  activeJob.value = job
  Object.assign(handoverForm, { 签认人: job.交接人员 })
  modalError.value = ''
  modal.value = 'handover'
}

function submitHandover() {
  if (!activeJob.value) {
    return
  }
  const result = confirmHandover(activeJob.value.id, handoverForm.签认人)
  if (!result.ok) {
    modalError.value = result.message
    return
  }
  closeModal()
  reload()
}

function openDetail(job: CateringJob) {
  activeJob.value = job
  modal.value = 'detail'
}

// 任意页签写入（含其他页签）后重读，保证刷新、重进、换页签看到同一份核对结果。
const unsubscribe = onStoreChange((key) => {
  if (key === 'catering' || key === '*') {
    reload()
    if (activeJob.value && modal.value === 'detail') {
      activeJob.value = listJobs().find((job) => job.id === activeJob.value?.id) ?? activeJob.value
    } else if (activeJob.value && (modal.value === 'check' || modal.value === 'handover')) {
      activeJob.value = listJobs().find((job) => job.id === activeJob.value?.id) ?? activeJob.value
    }
  }
})

onMounted(reload)
onUnmounted(unsubscribe)
</script>
