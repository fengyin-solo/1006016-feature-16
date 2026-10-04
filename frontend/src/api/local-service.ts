import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  listRows,
  readJson,
  resetRows,
  saveRows,
  writeJson,
} from '@/data/local-store'
import type {
  ActionResult,
  CateringCheckStatus,
  CateringHandoverTodo,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const CATERING_KEY = 'catering'
// 配餐交接待办的办结标记只存这一份；待办本身（份数、结论）直接从配餐作业行现算，不另存副本。
const HANDOVER_DONE_KEY = 'airport-ground-ops:catering-handover-done'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  // 配餐作业有数量核对、签认等额外约束，所有流转必须走下面的专用入口，禁止绕过。
  if (key === CATERING_KEY) {
    return { ok: false, message: '配餐作业请使用「配送登记 / 装车核对 / 交接签认」专用入口' }
  }
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// ---------------------------------------------------------------------------
// 航空配餐：数量核对作业流
// 状态只允许 待配餐 → 配送中 → 待交接 → 已交接 逐站推进，任何越级都在这里挡回。
// 核对结论（数量、舱门、装车数、结论、交接份数）只落在配餐作业行上，页面、明细、
// 航班保障待办全部读这一份，不允许各自重算。
// ---------------------------------------------------------------------------

const CATERING_STATUSES = ['待配餐', '配送中', '待交接', '已交接']

function cateringRows(): EntryRow[] {
  return listRows(CATERING_KEY)
}

function findCateringRow(id: number): { row?: EntryRow; index: number; rows: EntryRow[] } {
  const rows = cateringRows()
  const index = rows.findIndex((row) => Number(row.id) === Number(id))
  return { row: rows[index], index, rows }
}

function persistCateringRow(
  rows: EntryRow[],
  index: number,
  patch: Record<string, string | number | boolean>,
): void {
  const next = [...rows]
  next[index] = { ...next[index], ...patch }
  saveRows(CATERING_KEY, next)
}

// 有序状态机守卫：只允许从紧邻的前一站进入下一站，跳步/回退一律挡回。
function assertNextStatus(row: EntryRow, expected: string, action: string): ActionResult | null {
  const current = String(row.status)
  const currentIndex = CATERING_STATUSES.indexOf(current)
  const expectedIndex = CATERING_STATUSES.indexOf(expected)
  if (currentIndex === expectedIndex - 1) {
    return null
  }
  return {
    ok: false,
    message: `作业「${row['作业编号']}」当前为「${current}」，不能越级${action}到「${expected}」，已挡回`,
  }
}

function toPositiveInt(value: unknown): number | null {
  const num = Number(value)
  if (!Number.isInteger(num) || num <= 0) {
    return null
  }
  return num
}

/** 开始配送：登记本次配送的餐食数量与装载舱门，数量为后续装车核对的唯一基准。 */
export function startCateringDelivery(
  id: number,
  payload: { mealCount: number; door: string; cartNo?: string; company?: string },
): ActionResult {
  const { row, index, rows } = findCateringRow(id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的配餐作业` }
  }
  const blocked = assertNextStatus(row, '配送中', '开始配送')
  if (blocked) {
    return blocked
  }
  const mealCount = toPositiveInt(payload.mealCount)
  if (mealCount === null) {
    return { ok: false, message: '登记餐食数量必须是大于 0 的整数' }
  }
  const door = payload.door.trim()
  if (!door) {
    return { ok: false, message: '配送必须登记装载舱门' }
  }
  persistCateringRow(rows, index, {
    餐食数量: mealCount,
    装载舱门: door,
    ...(payload.cartNo?.trim() ? { 餐车编号: payload.cartNo.trim() } : {}),
    ...(payload.company?.trim() ? { 配餐公司: payload.company.trim() } : {}),
    // 重新配送时把上一轮核对结论清空，避免读到旧口径。
    装车数量: 0,
    核对结论: '未核对' satisfies CateringCheckStatus,
    交接人员: '',
    交接份数: 0,
    status: '配送中',
    pending: true,
    abnormal: false,
  })
  return {
    ok: true,
    message: `作业「${row['作业编号']}」已开始配送：登记 ${mealCount} 份、装载舱门 ${door}`,
  }
}

/** 装车核对：装车数超过登记数量一律拒绝且不落库；少装记为异常但允许继续交接。 */
export function checkCateringLoading(id: number, loadedCount: number): ActionResult {
  const { row, index, rows } = findCateringRow(id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的配餐作业` }
  }
  if (String(row.status) !== '配送中') {
    return { ok: false, message: `只有「配送中」的作业才能装车核对，当前为「${row.status}」` }
  }
  const loaded = Number(loadedCount)
  if (!Number.isInteger(loaded) || loaded < 0) {
    return { ok: false, message: '装车数量必须是不小于 0 的整数' }
  }
  const registered = Number(row['餐食数量'])
  if (loaded > registered) {
    // 超量装车直接拒绝：不改状态、不记结论，必须减到登记数量以内再核对。
    return {
      ok: false,
      message: `装车数 ${loaded} 份超过登记数量 ${registered} 份，已拒绝装载`,
    }
  }
  const conclusion: CateringCheckStatus = loaded === registered ? '相符' : '少装'
  persistCateringRow(rows, index, {
    装车数量: loaded,
    核对结论: conclusion,
    abnormal: conclusion === '少装',
  })
  return conclusion === '相符'
    ? { ok: true, message: `装车核对相符：${loaded}/${registered} 份，可提交交接` }
    : {
        ok: true,
        message: `装车核对为少装：实装 ${loaded} 份，登记 ${registered} 份，差 ${registered - loaded} 份`,
      }
}

/** 提交交接：必须已完成装车核对（相符或少装），未核对不许进入待交接。 */
export function submitCateringHandover(id: number): ActionResult {
  const { row, index, rows } = findCateringRow(id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的配餐作业` }
  }
  const blocked = assertNextStatus(row, '待交接', '提交交接')
  if (blocked) {
    return blocked
  }
  const conclusion = String(row['核对结论'] ?? '未核对')
  if (conclusion === '未核对') {
    return { ok: false, message: '尚未完成装车数量核对，不能提交交接' }
  }
  persistCateringRow(rows, index, { status: '待交接', pending: true })
  return { ok: true, message: `作业「${row['作业编号']}」已提交交接，等待交接人签认` }
}

/** 确认交接：交接人未签认进不了已交接；交接份数只在签认时记一次，重复交接不重复计数。 */
export function confirmCateringHandover(id: number, receiver: string): ActionResult {
  const { row, index, rows } = findCateringRow(id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的配餐作业` }
  }
  if (String(row.status) === '已交接') {
    return {
      ok: false,
      message: `作业「${row['作业编号']}」已交接，交接份数 ${row['交接份数']} 只记一次，不能重复交接`,
    }
  }
  const blocked = assertNextStatus(row, '已交接', '确认交接')
  if (blocked) {
    return blocked
  }
  const signer = receiver.trim()
  if (!signer) {
    return { ok: false, message: '交接人没有签认，不能进入已交接' }
  }
  const conclusion = String(row['核对结论'] ?? '未核对')
  if (conclusion === '未核对') {
    return { ok: false, message: '尚未完成装车数量核对，不能确认交接' }
  }
  // 交接份数取核对后的装车数量，与待办清单同源；只在这一次签认写入，之后不再变化。
  const handedPortions = Number(row['装车数量'] ?? 0)
  const handoverTime = new Date().toLocaleString('zh-CN', { hour12: false })
  persistCateringRow(rows, index, {
    status: '已交接',
    pending: false,
    交接人员: signer,
    交接份数: handedPortions,
    交接时间: handoverTime,
  })
  return {
    ok: true,
    message: `作业「${row['作业编号']}」经 ${signer} 签认交接，登记份数 ${handedPortions}，已进入保障待办`,
  }
}

/**
 * 配餐交接待办：份数、核对结论直接从已交接的配餐作业行现算，保障模块不另存份数，
 * 因此保障那边读到的配餐份数不可能与配餐作业不一致。办结标记单独持久化。
 */
export function listCateringHandoverTodos(): CateringHandoverTodo[] {
  const doneIds = readJson<number[]>(HANDOVER_DONE_KEY)
  return cateringRows()
    .filter((row) => String(row.status) === '已交接')
    .map((row) => ({
      id: Number(row.id),
      作业编号: String(row['作业编号'] ?? ''),
      航班号: String(row['航班号'] ?? ''),
      配餐公司: String(row['配餐公司'] ?? ''),
      配餐份数: Number(row['交接份数'] ?? row['装车数量'] ?? 0),
      核对结论: (String(row['核对结论'] ?? '未核对')) as CateringCheckStatus,
      交接人员: String(row['交接人员'] ?? ''),
      交接时间: String(row['交接时间'] ?? ''),
      办结: doneIds.includes(Number(row.id)),
    }))
}

/** 保障侧办结待办；只改办结标记，份数始终以配餐作业行为准。 */
export function completeCateringHandoverTodo(id: number): ActionResult {
  const doneIds = readJson<number[]>(HANDOVER_DONE_KEY)
  if (doneIds.includes(Number(id))) {
    return { ok: false, message: '该配餐交接待办已办结，无需重复操作' }
  }
  writeJson(HANDOVER_DONE_KEY, [...doneIds, Number(id)])
  return { ok: true, message: `配餐作业 ${id} 的交接待办已办结` }
}

/** 配餐作业唯一统计口径：页面卡片与任何明细都从这里读，不允许页面自己累加。 */
export function cateringStats(): { label: string; value: number }[] {
  const rows = cateringRows()
  const handedRows = rows.filter((row) => String(row.status) === '已交接')
  return [
    { label: '今日配餐架次', value: rows.length },
    { label: '配送中作业', value: rows.filter((row) => String(row.status) === '配送中').length },
    // 只统计已签认交接的份数；同一作业只会交接一次，份数天然不重复。
    { label: '餐食总份数', value: handedRows.reduce((sum, row) => sum + Number(row['交接份数'] ?? 0), 0) },
  ]
}
