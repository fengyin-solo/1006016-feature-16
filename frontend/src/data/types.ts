/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean | null
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// ===== 航空配餐：按数量核对的领域类型 =====

/** 配餐作业状态只能按此顺序推进，不许跳步。 */
export const CATERING_STATUSES = ['待配餐', '配送中', '待交接', '已交接'] as const
export type CateringStatus = (typeof CATERING_STATUSES)[number]

/** 数量核对结论：一份口径，页面、明细、待办都读这个，不各自重算。 */
export const CHECK_RESULTS = ['未核对', '一致', '少装', '多装'] as const
export type CheckResult = (typeof CHECK_RESULTS)[number]

/** 配餐作业：配送登记与核对结论都挂在作业上，随记录一起持久化。 */
export type CateringJob = {
  id: number
  status: CateringStatus
  pending: boolean
  abnormal: boolean
  作业编号: string
  航班号: string
  /** 配餐公司登记的计划餐食数量（总份数）。 */
  餐食数量: number
  配餐公司: string
  餐车编号: string
  装载舱门: string
  交接人员: string
  /** 开始配送时登记的应发份数；未配送时与餐食数量一致。 */
  登记份数: number
  /** 实际装车份数（核对时登记）。 */
  装车份数: number | null
  核对结果: CheckResult
  核对时间: string
  /** 交接签认人：为空说明还没签认，进不了已交接。 */
  签认人: string
  交接时间: string
}

/** 核对结论的归一化结果。 */
export type CheckOutcome = {
  result: CheckResult
  diff: number
}

/** 航班保障模块读取的配餐交接待办项，份数取自领域服务唯一口径。 */
export type CateringHandoverTodo = {
  id: number
  作业编号: string
  航班号: string
  配餐公司: string
  装载舱门: string
  份数: number
  状态: '待签认' | '已交接'
  签认人: string
  交接时间: string
}

/** 配餐统计卡片：数字全部由领域服务计算。 */
export type CateringStats = {
  todayJobs: number
  delivering: number
  totalPortions: number
}
