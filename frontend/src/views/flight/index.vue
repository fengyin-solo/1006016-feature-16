<template>
  <section class="page" data-module="flight">
    <header class="page-head">
      <div>
        <h2>航班保障管理</h2>
        <p class="page-desc">维护航班保障任务，围绕保障编号、航班号、机型、计划到达做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记航班保障任务</button>
        <button class="btn" type="button" @click="exportRows">导出航班保障清单</button>
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

    <!-- 配餐交接待办：直接读配餐领域服务，份数与航空配餐页同一份口径，不在这里重算 -->
    <section class="todo-board">
      <header class="todo-head">
        <h3>配餐交接待办</h3>
        <span class="page-desc">
          待签认 {{ pendingTodos.length }} 单 · 已交接 {{ handedTodos.length }} 单；份数以配餐作业核对口径为准
        </span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>作业编号</th>
            <th>航班号</th>
            <th>配餐公司</th>
            <th>装载舱门</th>
            <th>配餐份数</th>
            <th>交接状态</th>
            <th>签认人</th>
            <th>交接时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in cateringTodos" :key="item.id">
            <td>{{ item.作业编号 }}</td>
            <td>{{ item.航班号 }}</td>
            <td>{{ item.配餐公司 }}</td>
            <td>{{ item.装载舱门 || '—' }}</td>
            <td><strong>{{ item.份数 }}</strong></td>
            <td>
              <span class="check-badge" :class="item.状态 === '待签认' ? 'badge-warn' : 'badge-ok'">
                {{ item.状态 }}
              </span>
            </td>
            <td>{{ item.签认人 || '—' }}</td>
            <td>{{ item.交接时间 || '—' }}</td>
          </tr>
          <tr v-if="!cateringTodos.length">
            <td colspan="8" class="empty-state">暂无配餐交接待办</td>
          </tr>
        </tbody>
      </table>
    </section>

    <table class="data-table" style="margin-top: 12px">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无航班保障数据，可先登记航班保障任务</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条航班保障记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { listHandoverTodos } from '@/api/catering-service'
import { onStoreChange } from '@/data/local-store'
import type { CateringHandoverTodo, EntryRow } from '@/data/types'

const meta = moduleMeta('flight')
const columns = ["保障编号", "航班号", "机型", "计划到达", "机位号", "保障等级", "保障班组", "保障状态"]
const actions = ["接收任务", "开始保障", "确认完成"]
const statuses = ["待接收", "保障中", "保障完成", "已终止"]
const stats = [{"label": "今日保障任务", "value": 0}, {"label": "保障中任务", "value": 0}, {"label": "保障完成率", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const cateringTodos = ref<CateringHandoverTodo[]>([])
const pendingTodos = computed(() => cateringTodos.value.filter((item) => item.状态 === '待签认'))
const handedTodos = computed(() => cateringTodos.value.filter((item) => item.状态 === '已交接'))
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '航班保障任务登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '航班保障列表读取失败'
  }
}

// 配餐待办只读领域服务，份数不在保障模块二次计算。
function reloadCateringTodos() {
  cateringTodos.value = listHandoverTodos()
}

const unsubscribe = onStoreChange((key) => {
  if (key === 'catering' || key === '*') {
    reloadCateringTodos()
  }
})

onMounted(() => {
  reload()
  reloadCateringTodos()
})
onUnmounted(unsubscribe)
</script>
