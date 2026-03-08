import { addDays, addWeeks, addMonths, addYears, format, parseISO, isAfter, isBefore, startOfDay } from '../utils/dateHelpers.js'

/**
 * 定期取引から指定期間内の全発生日を展開する
 */
function expandRecurring(tx, startDate, endDate) {
  const occurrences = []
  const start = startOfDay(parseISO(tx.startDate))
  const end = tx.endDate ? startOfDay(parseISO(tx.endDate)) : endDate

  let cursor = start
  const limit = Math.min(end, endDate)

  while (!isAfter(cursor, limit)) {
    if (!isBefore(cursor, startDate)) {
      occurrences.push({ date: cursor, amount: tx.type === 'income' ? tx.amount : -tx.amount, tx })
    }
    switch (tx.frequency) {
      case 'daily':   cursor = addDays(cursor, 1); break
      case 'weekly':  cursor = addWeeks(cursor, 1); break
      case 'monthly': cursor = addMonths(cursor, 1); break
      case 'yearly':  cursor = addYears(cursor, 1); break
      default: return occurrences
    }
  }
  return occurrences
}

/**
 * accounts と transactions から、今日〜endDate までの日次残高データを生成する
 * @param {Array} accounts
 * @param {Array} transactions
 * @param {Date} endDate
 * @returns {Array} - [{ date: 'YYYY-MM-DD', total: number, [accountId]: number, ... }]
 */
export function buildForecast(accounts, transactions, endDate) {
  const today = startOfDay(new Date())

  // 口座ごとの現在残高をセット
  const balances = {}
  for (const acc of accounts) {
    balances[acc.id] = acc.balance
  }

  // 全取引を発生日ごとに展開
  const events = [] // { date, amount, accountId }

  for (const tx of transactions) {
    if (tx.recurring) {
      const expanded = expandRecurring(tx, today, endDate)
      for (const e of expanded) {
        events.push({ date: e.date, amount: e.amount, accountId: tx.accountId })
      }
    } else {
      // 単発取引
      const d = startOfDay(parseISO(tx.startDate))
      if (!isBefore(d, today) && !isAfter(d, endDate)) {
        events.push({
          date: d,
          amount: tx.type === 'income' ? tx.amount : -tx.amount,
          accountId: tx.accountId,
        })
      }
    }
  }

  // 日付でソート
  events.sort((a, b) => a.date - b.date)

  // 日次データを組み立て
  const result = []
  const currentBalances = { ...balances }
  let eventIdx = 0

  let cursor = new Date(today)
  while (!isAfter(cursor, endDate)) {
    const dateStr = format(cursor)

    // この日のイベントを適用
    while (eventIdx < events.length && !isAfter(events[eventIdx].date, cursor)) {
      const ev = events[eventIdx]
      if (currentBalances[ev.accountId] !== undefined) {
        currentBalances[ev.accountId] += ev.amount
      }
      eventIdx++
    }

    const row = { date: dateStr }
    let total = 0
    for (const acc of accounts) {
      row[acc.id] = Math.round(currentBalances[acc.id])
      total += currentBalances[acc.id]
    }
    row.total = Math.round(total)
    result.push(row)

    cursor = addDays(cursor, 1)
  }

  return result
}

/**
 * 今日〜endDate までに発生する取引の明細リストを生成する
 * @returns {Array} - [{ date: 'YYYY-MM-DD', label, category, type, amount, accountId }]
 */
export function buildTransactionList(transactions, endDate) {
  const start = startOfDay(new Date())
  const events = []

  for (const tx of transactions) {
    if (tx.recurring) {
      const expanded = expandRecurring(tx, start, endDate)
      for (const e of expanded) {
        events.push({
          date: format(e.date),
          label: tx.label,
          category: tx.category,
          type: tx.type,
          amount: tx.amount,
          accountId: tx.accountId,
        })
      }
    } else {
      const d = startOfDay(parseISO(tx.startDate))
      if (!isBefore(d, start) && !isAfter(d, endDate)) {
        events.push({
          date: format(d),
          label: tx.label,
          category: tx.category,
          type: tx.type,
          amount: tx.amount,
          accountId: tx.accountId,
        })
      }
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date))
  return events
}
