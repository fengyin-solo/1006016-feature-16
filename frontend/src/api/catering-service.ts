import { listRows, saveRows } from '@/data/local-store'
import {
  CATERING_STATUSES,
  type ActionResult,
  type CateringJob,
  type CateringHandoverTodo,
  type CateringStats,
  type CateringStatus,
  type CheckOutcome,
  type CheckResult,
  type EntryRow,
} from '@/data/types'

// 航空配餐领域服务：登记配送、按数量核对、顺序状态流转、交接签认都在这一处完成。
// 页面、明细、统计、航班保障待办只能读这里的结果，不许各自重算一份。

const KEY = 'catering'

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  )
}

function toCount(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

// 老数据（还没有核对字段的记录）读出来时补齐默认值，不改动存储即可正常参与核对。
function normalize(row: EntryRow): CateringJob {
  const planned = toCount(row['餐食数量'])
  return {
    id: Number(row.id),
    status: (CATERING_STATUSES.includes(String(row.status) as CateringStatus)
      ? String(row.status)
      : '待配餐') as CateringStatus,
    pending: Boolean(row.pending),
    abnormal: Boolean(row.abnormal),
    作业编号: String(row['作业编号'] ?? ''),
    航班号: String(row['航班号'] ?? ''),
    餐食数量: planned,
    配餐公司: String(row['配餐公司'] ?? ''),
    餐车编号: String(row['餐车编号'] ?? ''),
    装载舱门: String(row['装载舱门'] ?? ''),
    交接人员: String(row['交接人员'] ?? ''),
    登记份数: row['登记份数'] === undefined ? planned : toCount(row['登记份数']),
    装车份数: row['装车份数'] === null || row['装车份数'] === undefined ? null : toCount(row['装车份数']),
    核对结果: (CHECK_RESULT_SET.has(String(row['核对结果'])) ? String(row['核对结果']) : '未核对') as CheckResult,
    核对时间: String(row['核对时间'] ?? ''),
    签认人: String(row['签认人'] ?? ''),
    交接时间: String(row['交接时间'] ?? ''),
  }
}

const CHECK_RESULT_SET = new Set<string>(['未核对', '一致', '少装', '多装'])

function persist(jobs: CateringJob[]): void {
  saveRows(KEY, jobs as unknown as EntryRow[])
}

export function listJobs(): CateringJob[] {
  return listRows(KEY).map(normalize)
}

export function getJob(id: number): CateringJob | undefined {
  return listJobs().find((job) => job.id === id)
}

// 唯一份数口径：配送时登记的份数为准；还没配送则按配餐公司登记的餐食数量。
// 任何页面展示与待办推送都走这里，禁止别处再算一遍。
export function canonicalPortions(job: CateringJob): number {
  return job.登记份数 > 0 ? job.登记份数 : job.餐食数量
}

// 核对结论也是一份口径：装车数与登记份数当场比对，结论随作业持久化。
export function compareLoading(registered: number, loaded: number): CheckOutcome {
  if (loaded > registered) {
    return { result: '多装', diff: loaded - registered }
  }
  if (loaded < registered) {
    return { result: '少装', diff: registered - loaded }
  }
  return { result: '一致', diff: 0 }
}

function requireStatus(job: CateringJob, expected: CateringStatus, action: string): ActionResult | null {
  if (job.status !== expected) {
    const order = CATERING_STATUSES.join(' → ')
    return {
      ok: false,
      message: `作业 ${job.作业编号} 当前为「${job.status}」，不能执行「${action}」；状态只能按 ${order} 顺序推进，不能跳步`,
    }
  }
  return null
}

function positiveCount(value: number, label: string): ActionResult | null {
  if (!Number.isInteger(value) || value <= 0) {
    return { ok: false, message: `${label}必须是大于 0 的整数` }
  }
  return null
}

function updateJob(id: number, patch: Partial<CateringJob>): void {
  const jobs = listJobs()
  const index = jobs.findIndex((job) => job.id === id)
  if (index < 0) {
    return
  }
  jobs[index] = { ...jobs[index], ...patch }
  persist(jobs)
}

// 登记配餐作业：落地即「待配餐」，登记份数先按餐食数量占位，配送时再正式登记。
export function createJob(input: {
  作业编号: string
  航班号: string
  餐食数量: number
  配餐公司: string
  餐车编号?: string
}): ActionResult {
  const code = input.作业编号.trim()
  const flight = input.航班号.trim()
  const company = input.配餐公司.trim()
  if (!code || !flight || !company) {
    return { ok: false, message: '作业编号、航班号、配餐公司都必须填写' }
  }
  const countError = positiveCount(input.餐食数量, '餐食数量')
  if (countError) {
    return countError
  }
  const jobs = listJobs()
  if (jobs.some((job) => job.作业编号 === code)) {
    return { ok: false, message: `作业编号 ${code} 已存在` }
  }
  const id = jobs.reduce((max, job) => Math.max(max, job.id), 0) + 1
  const job: CateringJob = {
    id,
    status: '待配餐',
    pending: true,
    abnormal: false,
    作业编号: code,
    航班号: flight,
    餐食数量: input.餐食数量,
    配餐公司: company,
    餐车编号: input.餐车编号?.trim() ?? '',
    装载舱门: '',
    交接人员: '',
    登记份数: input.餐食数量,
    装车份数: null,
    核对结果: '未核对',
    核对时间: '',
    签认人: '',
    交接时间: '',
  }
  persist([...jobs, job])
  return { ok: true, message: `配餐作业 ${code} 已登记，进入「待配餐」` }
}

// 开始配送（待配餐 → 配送中）：同时登记应发份数与装载舱门。
export function startDelivery(
  id: number,
  input: { 登记份数: number; 装载舱门: string },
): ActionResult {
  const job = getJob(id)
  if (!job) {
    return { ok: false, message: `没有找到编号为 ${id} 的配餐作业` }
  }
  const blocked = requireStatus(job, '待配餐', '开始配送')
  if (blocked) {
    return blocked
  }
  const countError = positiveCount(input.登记份数, '登记份数')
  if (countError) {
    return countError
  }
  const door = input.装载舱门.trim()
  if (!door) {
    return { ok: false, message: '配送时必须登记装载舱门' }
  }
  updateJob(id, {
    status: '配送中',
    pending: true,
    登记份数: input.登记份数,
    装载舱门: door,
  })
  return {
    ok: true,
    message: `作业 ${job.作业编号} 已开始配送，登记份数 ${input.登记份数}、舱门 ${door}`,
  }
}

// 按数量核对：装车数超过登记数量一律拒绝（记为多装并保持配送中）；
// 少装同样不能交接；一致才放行到待交接的前置条件。结论持久化，刷新不丢。
export function checkLoading(id: number, loaded: number): ActionResult {
  const job = getJob(id)
  if (!job) {
    return { ok: false, message: `没有找到编号为 ${id} 的配餐作业` }
  }
  const blocked = requireStatus(job, '配送中', '数量核对')
  if (blocked) {
    return blocked
  }
  const countError = positiveCount(loaded, '装车份数')
  if (countError) {
    return countError
  }
  const outcome = compareLoading(job.登记份数, loaded)
  const stampedAt = nowText()
  if (outcome.result === '多装') {
    updateJob(id, {
      装车份数: loaded,
      核对结果: '多装',
      核对时间: stampedAt,
      abnormal: true,
    })
    return {
      ok: false,
      message: `拒绝装车：装车 ${loaded} 份超过登记 ${job.登记份数} 份，多 ${outcome.diff} 份；请减载后重新核对`,
    }
  }
  if (outcome.result === '少装') {
    updateJob(id, {
      装车份数: loaded,
      核对结果: '少装',
      核对时间: stampedAt,
      abnormal: true,
    })
    return {
      ok: false,
      message: `核对未通过：装车 ${loaded} 份少于登记 ${job.登记份数} 份，差 ${outcome.diff} 份；补齐后重新核对`,
    }
  }
  updateJob(id, {
    装车份数: loaded,
    核对结果: '一致',
    核对时间: stampedAt,
    abnormal: false,
  })
  return { ok: true, message: `核对一致：装车 ${loaded} 份与登记份数相符，可以提交交接` }
}

// 提交交接（配送中 → 待交接）：只认领域服务里那份「一致」的核对结论。
export function submitHandover(id: number): ActionResult {
  const job = getJob(id)
  if (!job) {
    return { ok: false, message: `没有找到编号为 ${id} 的配餐作业` }
  }
  const blocked = requireStatus(job, '配送中', '提交交接')
  if (blocked) {
    return blocked
  }
  if (job.核对结果 !== '一致') {
    return {
      ok: false,
      message: `数量核对结论为「${job.核对结果}」，不能提交交接；只有装车份数与登记份数核对一致才放行`,
    }
  }
  updateJob(id, { status: '待交接', pending: true, abnormal: false })
  return { ok: true, message: `作业 ${job.作业编号} 已提交交接，等待交接人签认` }
}

// 确认交接（待交接 → 已交接）：交接人不签认进不了已交接；
// 同一作业重复交接只记一次份数——已交接的再次提交直接挡回，不产生第二条记录。
export function confirmHandover(id: number, signer: string): ActionResult {
  const job = getJob(id)
  if (!job) {
    return { ok: false, message: `没有找到编号为 ${id} 的配餐作业` }
  }
  if (job.status === '已交接') {
    return {
      ok: false,
      message: `作业 ${job.作业编号} 已交接（签认人：${job.签认人}），重复交接不再重复记数`,
    }
  }
  const blocked = requireStatus(job, '待交接', '确认交接')
  if (blocked) {
    return blocked
  }
  const name = signer.trim()
  if (!name) {
    return { ok: false, message: '交接人未签认，不能进入已交接' }
  }
  updateJob(id, {
    status: '已交接',
    pending: false,
    abnormal: false,
    签认人: name,
    交接人员: name,
    交接时间: nowText(),
  })
  return { ok: true, message: `作业 ${job.作业编号} 已交接，签认人 ${name}，份数 ${canonicalPortions(job)} 仅记一次` }
}

// 配餐统计：数字在这里算一次，页面卡片只读结果。
export function cateringStats(): CateringStats {
  const jobs = listJobs()
  return {
    todayJobs: jobs.length,
    delivering: jobs.filter((job) => job.status === '配送中').length,
    totalPortions: jobs.reduce((sum, job) => sum + canonicalPortions(job), 0),
  }
}

// 航班保障模块的配餐交接待办：份数取 canonicalPortions 这一份口径，
// 保障模块只读不算，保证两边份数永远一致。
export function listHandoverTodos(): CateringHandoverTodo[] {
  return listJobs()
    .filter((job) => job.status === '待交接' || job.status === '已交接')
    .map((job) => ({
      id: job.id,
      作业编号: job.作业编号,
      航班号: job.航班号,
      配餐公司: job.配餐公司,
      装载舱门: job.装载舱门,
      份数: canonicalPortions(job),
      状态: job.status === '待交接' ? '待签认' : '已交接',
      签认人: job.签认人,
      交接时间: job.交接时间,
    }))
}
