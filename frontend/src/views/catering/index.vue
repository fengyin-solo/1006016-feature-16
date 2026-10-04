<template>
  <section class="page" data-module="catering">
    <header class="page-head">
      <div>
        <h2>航空配餐管理</h2>
        <p class="page-desc">配送登记餐食数量与装载舱门，装车按登记数量核对：多装一律拒绝；交接人签认后方可进入已交接。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="exportRows">导出航空配餐清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
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
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ displayCell(row, column) }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="String(row.status) === '待配餐'"
              class="link"
              type="button"
              @click="openDelivery(row)"
            >
              开始配送（登记数量/舱门）
            </button>
            <button
              v-if="String(row.status) === '配送中'"
              class="link"
              type="button"
              @click="openLoading(row)"
            >
              装车核对
            </button>
            <button
              v-if="String(row.status) === '配送中' && String(row['核对结论']) !== '未核对'"
              class="link"
              type="button"
              @click="submitHandover(row)"
            >
              提交交接
            </button>
            <button
              v-if="String(row.status) === '待交接'"
              class="link"
              type="button"
              @click="openSignoff(row)"
            >
              交接签认
            </button>
            <span v-if="String(row.status) === '已交接'" class="muted-text">
              已签认 · 交接 {{ row['交接份数'] }} 份
            </span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无符合条件的配餐作业</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条配餐作业 · 核对结果与交接份数以本表为唯一口径，刷新、重进或换页签均保持一致</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="okMessage" class="ok-text">{{ okMessage }}</span>
    </footer>

    <div v-if="dialog !== 'none'" class="modal-mask" @click.self="closeDialog">
      <div class="modal-card">
        <template v-if="dialog === 'delivery'">
          <h3>开始配送 · 登记数量与装载舱门</h3>
          <p class="modal-hint">登记数量是装车核对的唯一基准，作业「{{ activeRow?.['作业编号'] }}」</p>
          <label class="form-item">
            <span>餐食数量（份）</span>
            <input v-model.number="deliveryForm.mealCount" type="number" min="1" step="1" />
          </label>
          <label class="form-item">
            <span>装载舱门</span>
            <input v-model="deliveryForm.door" placeholder="如 L1 / R2" />
          </label>
          <label class="form-item">
            <span>餐车编号（可留空）</span>
            <input v-model="deliveryForm.cartNo" />
          </label>
          <label class="form-item">
            <span>配餐公司（可留空）</span>
            <input v-model="deliveryForm.company" />
          </label>
        </template>

        <template v-else-if="dialog === 'loading'">
          <h3>装车核对</h3>
          <p class="modal-hint">
            作业「{{ activeRow?.['作业编号'] }}」登记
            <strong>{{ activeRow?.['餐食数量'] }}</strong> 份 · 舱门
            <strong>{{ activeRow?.['装载舱门'] }}</strong>
          </p>
          <label class="form-item">
            <span>本次装车数量（份）</span>
            <input v-model.number="loadingForm.loadedCount" type="number" min="0" step="1" />
          </label>
          <p class="modal-hint">装车数超过登记数量将被拒绝；少装会标记异常，仍可提交交接。</p>
        </template>

        <template v-else-if="dialog === 'signoff'">
          <h3>交接签认</h3>
          <p class="modal-hint">
            作业「{{ activeRow?.['作业编号'] }}」核对结论为
            <strong>{{ activeRow?.['核对结论'] }}</strong>，实装
            <strong>{{ activeRow?.['装车数量'] }}</strong> /
            登记 {{ activeRow?.['餐食数量'] }} 份
          </p>
          <label class="form-item">
            <span>交接人签认（必填）</span>
            <input v-model="signoffForm.receiver" placeholder="交接人姓名，不签认不能进入已交接" />
          </label>
        </template>

        <div class="modal-actions">
          <button class="btn" type="button" @click="closeDialog">取消</button>
          <button class="btn primary" type="button" @click="confirmDialog">确认</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  cateringStats,
  checkCateringLoading,
  confirmCateringHandover,
  downloadEntries,
  listEntries,
  moduleMeta,
  startCateringDelivery,
  submitCateringHandover,
} from '@/api/local-service'
import { subscribeStore } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('catering')
// 列定义只保留作业明细列，状态与动作单独成列；核对相关列由数据层统一供给。
const columns = [
  '作业编号',
  '航班号',
  '餐食数量',
  '配餐公司',
  '餐车编号',
  '装载舱门',
  '装车数量',
  '核对结论',
  '交接人员',
  '交接份数',
]
const statuses = ['待配餐', '配送中', '待交接', '已交接']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const okMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['作业编号', '航班号', '配餐公司']

// 统计卡片直接读服务层的唯一口径，页面不再自行累加。
const stats = ref(cateringStats())

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

type DialogKind = 'none' | 'delivery' | 'loading' | 'signoff'
const dialog = ref<DialogKind>('none')
const activeRow = ref<EntryRow | null>(null)
const deliveryForm = ref({ mealCount: 0, door: '', cartNo: '', company: '' })
const loadingForm = ref({ loadedCount: 0 })
const signoffForm = ref({ receiver: '' })

let flashTimer: ReturnType<typeof setTimeout> | undefined

function flash(message: string, ok: boolean) {
  okMessage.value = ok ? message : ''
  errorMessage.value = ok ? '' : message
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    okMessage.value = ''
    errorMessage.value = ''
  }, 4000)
}

function displayCell(row: EntryRow, column: string): string | number {
  const value = row[column]
  if (value === undefined || value === null || value === '') {
    return '—'
  }
  return value as string | number
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openDelivery(row: EntryRow) {
  activeRow.value = row
  deliveryForm.value = {
    mealCount: Number(row['餐食数量']) || 0,
    door: String(row['装载舱门'] ?? ''),
    cartNo: String(row['餐车编号'] ?? ''),
    company: String(row['配餐公司'] ?? ''),
  }
  dialog.value = 'delivery'
}

function openLoading(row: EntryRow) {
  activeRow.value = row
  loadingForm.value = { loadedCount: Number(row['装车数量']) || 0 }
  dialog.value = 'loading'
}

function openSignoff(row: EntryRow) {
  activeRow.value = row
  signoffForm.value = { receiver: '' }
  dialog.value = 'signoff'
}

function closeDialog() {
  dialog.value = 'none'
  activeRow.value = null
}

function confirmDialog() {
  if (!activeRow.value) {
    return
  }
  const id = Number(activeRow.value.id)
  let result: { ok: boolean; message: string }
  if (dialog.value === 'delivery') {
    result = startCateringDelivery(id, { ...deliveryForm.value })
  } else if (dialog.value === 'loading') {
    result = checkCateringLoading(id, loadingForm.value.loadedCount)
  } else {
    result = confirmCateringHandover(id, signoffForm.value.receiver)
  }
  flash(result.message, result.ok)
  // 装车核对成功/失败都保留弹窗，便于直接改数重新核对；其余动作成功后关闭弹窗。
  if (result.ok && dialog.value !== 'loading') {
    closeDialog()
  }
}

function submitHandover(row: EntryRow) {
  const result = submitCateringHandover(Number(row.id))
  flash(result.message, result.ok)
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = cateringStats()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '航空配餐列表读取失败'
  }
}

// 订阅数据层变更：本页签保存或别的页签签认/核对后，列表与统计立刻读到同一份。
const unsubscribe = subscribeStore(reload)

onMounted(reload)
onUnmounted(() => {
  unsubscribe()
  clearTimeout(flashTimer)
})
</script>
