import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-ops:entries'

type Unsubscribe = () => void

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

// 数据变更订阅：别的页签改了 localStorage（storage 事件）或本页签保存后，
// 页面都能重新读到同一份数据，刷新、退出重进、换页签看到的核对结果一致。
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}

export function subscribeStore(listener: () => void): Unsubscribe {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('storage', (event) => {
    // 其他页签改了主表或任意键值数据：清掉对应缓存并通知页面重读同一份数据。
    if (event.key === null || event.key === STORAGE_KEY) {
      cache = null
    }
    if (event.key && event.key !== STORAGE_KEY) {
      extraCache.delete(event.key)
    }
    notify()
  })
}

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  notify()
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

// 通用键值持久化：配餐交接待办等条目数据与作业主表分开存，读写仍走同一套缓存口径。
const extraCache = new Map<string, unknown>()
const extraFallback = new Map<string, () => unknown>()

export function readJson<T>(key: string): T {
  if (extraCache.has(key)) {
    return extraCache.get(key) as T
  }
  let value: T
  if (typeof window === 'undefined' || !window.localStorage) {
    value = clone((extraFallback.get(key)?.() ?? []) as T)
  } else {
    const raw = window.localStorage.getItem(key)
    if (!raw) {
      value = clone((extraFallback.get(key)?.() ?? []) as T)
      window.localStorage.setItem(key, JSON.stringify(value))
    } else {
      try {
        value = JSON.parse(raw) as T
      } catch {
        value = clone((extraFallback.get(key)?.() ?? []) as T)
        window.localStorage.setItem(key, JSON.stringify(value))
      }
    }
  }
  extraCache.set(key, value)
  return value
}

export function writeJson<T>(key: string, value: T): void {
  extraCache.set(key, value)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
  notify()
}
