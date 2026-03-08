/**
 * シンプルな日付ユーティリティ（date-fnsの代わりに自前実装）
 */

export function startOfDay(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

export function parseISO(str) {
  // 'YYYY-MM-DD' → Date
  const [y, m, d] = str.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function format(date, pattern = 'YYYY-MM-DD') {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function formatDisplay(date) {
  if (typeof date === 'string') date = parseISO(date)
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

export function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function addWeeks(date, n) {
  return addDays(date, n * 7)
}

export function addMonths(date, n) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + n)
  return d
}

export function addYears(date, n) {
  const d = new Date(date)
  d.setFullYear(d.getFullYear() + n)
  return d
}

export function isAfter(a, b) {
  return a.getTime() > b.getTime()
}

export function isBefore(a, b) {
  return a.getTime() < b.getTime()
}

export function today() {
  return startOfDay(new Date())
}

export function todayStr() {
  return format(today())
}
