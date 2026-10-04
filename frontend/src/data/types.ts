/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
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
  // 有序状态机：打开后只允许沿 statuses 从前到后逐站推进，越级一律挡回。
  ordered?: boolean
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

/** 配餐装车核对结论：核对时落库，页面、明细、保障待办都读这一份，不许各处重算。 */
export type CateringCheckStatus = '未核对' | '相符' | '少装'

/** 落到航班保障模块的配餐交接待办：份数直接取自配餐作业的交接份数字段，两边同源。 */
export type CateringHandoverTodo = {
  id: number
  作业编号: string
  航班号: string
  配餐公司: string
  配餐份数: number
  核对结论: CateringCheckStatus
  交接人员: string
  交接时间: string
  办结: boolean
}
