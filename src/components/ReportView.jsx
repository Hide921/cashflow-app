import React, { useState, useMemo } from 'react'
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { buildPastTransactionList } from '../utils/forecast.js'
import { format, addMonths, startOfDay, parseISO } from '../utils/dateHelpers.js'

const PERIOD_OPTIONS = ['今月', '先月', '過去3ヶ月', '過去6ヶ月', '今年']

const CATEGORY_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
]

function getPeriodDates(period) {
  const now = new Date()
  const todayStr = format(startOfDay(now))

  if (period === '今月') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    return { startDateStr: format(start), endDateStr: todayStr }
  }
  if (period === '先月') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const end = new Date(now.getFullYear(), now.getMonth(), 0)
    return { startDateStr: format(start), endDateStr: format(end) }
  }
  if (period === '過去3ヶ月') {
    const start = addMonths(startOfDay(now), -3)
    return { startDateStr: format(start), endDateStr: todayStr }
  }
  if (period === '過去6ヶ月') {
    const start = addMonths(startOfDay(now), -6)
    return { startDateStr: format(start), endDateStr: todayStr }
  }
  if (period === '今年') {
    const start = new Date(now.getFullYear(), 0, 1)
    return { startDateStr: format(start), endDateStr: todayStr }
  }
  return { startDateStr: todayStr, endDateStr: todayStr }
}

function downloadCSV(events, accounts) {
  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]))
  const header = ['日付', '名前', '種別', 'カテゴリ', '口座', '金額']
  const rows = events.map(ev => [
    ev.date,
    `"${ev.label.replace(/"/g, '""')}"`,
    ev.type === 'income' ? '収入' : '支出',
    ev.category || '',
    accountMap[ev.accountId] || '',
    ev.type === 'income' ? ev.amount : -ev.amount,
  ])
  const csv = [header, ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `cashflow_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function formatYen(v) {
  if (Math.abs(v) >= 1_000_000) return `¥${(v / 10000).toFixed(0)}万`
  return `¥${v.toLocaleString()}`
}

const RADIAN = Math.PI / 180
function PieLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }) {
  if (percent < 0.05) return null
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight="600">
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

export default function ReportView({ accounts, transactions }) {
  const [period, setPeriod] = useState('今月')

  const { startDateStr, endDateStr } = useMemo(() => getPeriodDates(period), [period])

  const events = useMemo(() => {
    if (transactions.length === 0) return []
    const start = parseISO(startDateStr)
    const all = buildPastTransactionList(transactions, start)
    return all.filter(ev => ev.date >= startDateStr && ev.date <= endDateStr)
  }, [transactions, startDateStr, endDateStr])

  const totalIncome = useMemo(() =>
    events.filter(e => e.type === 'income').reduce((s, e) => s + e.amount, 0),
    [events])

  const totalExpense = useMemo(() =>
    events.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0),
    [events])

  const categoryData = useMemo(() => {
    const map = {}
    events.filter(e => e.type === 'expense').forEach(e => {
      const cat = e.category || 'その他'
      map[cat] = (map[cat] || 0) + e.amount
    })
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
  }, [events])

  const monthlyData = useMemo(() => {
    const map = {}
    events.forEach(e => {
      const month = e.date.slice(0, 7)
      if (!map[month]) map[month] = { month, income: 0, expense: 0 }
      if (e.type === 'income') map[month].income += e.amount
      else map[month].expense += e.amount
    })
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month))
  }, [events])

  const net = totalIncome - totalExpense

  return (
    <div className="space-y-6">
      {/* 期間選択 */}
      <div className="flex flex-wrap items-center gap-2">
        {PERIOD_OPTIONS.map(label => (
          <button
            key={label}
            onClick={() => setPeriod(label)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              period === label
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100 border border-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => downloadCSV(events, accounts)}
          disabled={events.length === 0}
          className="ml-auto flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium border border-gray-200 text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          CSVエクスポート
        </button>
      </div>

      {/* サマリーカード */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <p className="text-sm text-gray-500 mb-1">合計収入</p>
          <p className="text-2xl font-bold text-emerald-600">+¥{totalIncome.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <p className="text-sm text-gray-500 mb-1">合計支出</p>
          <p className="text-2xl font-bold text-red-500">-¥{totalExpense.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <p className="text-sm text-gray-500 mb-1">純収支</p>
          <p className={`text-2xl font-bold ${net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {net >= 0 ? '+' : ''}¥{net.toLocaleString()}
          </p>
          <p className="text-xs text-gray-400 mt-1">{events.length}件の取引</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* カテゴリ別支出 */}
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-700 mb-4">カテゴリ別支出</h2>
          {categoryData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
              この期間に支出データがありません
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={PieLabel}
                    outerRadius={85}
                    dataKey="value"
                  >
                    {categoryData.map((_, i) => (
                      <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={v => [`¥${v.toLocaleString()}`, '金額']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-4 space-y-2">
                {categoryData.map((item, i) => (
                  <div key={item.name} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                      <span className="text-gray-600">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400 text-xs">
                        {totalExpense > 0 ? ((item.value / totalExpense) * 100).toFixed(1) : 0}%
                      </span>
                      <span className="font-semibold text-red-600 w-28 text-right">
                        ¥{item.value.toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
                <div className="flex items-center justify-between text-sm pt-2 border-t font-semibold">
                  <span className="text-gray-700">合計</span>
                  <span className="text-red-600">¥{totalExpense.toLocaleString()}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* 月別収支 */}
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-700 mb-4">月別収支</h2>
          {monthlyData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
              この期間に取引データがありません
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={formatYen} width={72} />
                <Tooltip formatter={v => `¥${v.toLocaleString()}`} />
                <Legend />
                <Bar dataKey="income" name="収入" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="expense" name="支出" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* 取引明細 */}
      {events.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-700">取引明細</h2>
            <span className="text-sm text-gray-400">{events.length}件</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-3">日付</th>
                  <th className="text-left px-4 py-3">名前</th>
                  <th className="text-left px-4 py-3">カテゴリ</th>
                  <th className="text-left px-4 py-3">口座</th>
                  <th className="text-right px-4 py-3">金額</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {events.slice(0, 50).map((ev, i) => {
                  const acc = accounts.find(a => a.id === ev.accountId)
                  return (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">
                        {ev.date.slice(5).replace('-', '/')}
                      </td>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{ev.label}</td>
                      <td className="px-4 py-2.5 text-gray-500">{ev.category || '—'}</td>
                      <td className="px-4 py-2.5">
                        {acc ? (
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: acc.color }} />
                            <span className="text-gray-600">{acc.name}</span>
                          </span>
                        ) : '—'}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${
                        ev.type === 'income' ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        {ev.type === 'income' ? '+' : '-'}¥{ev.amount.toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {events.length > 50 && (
              <p className="text-center py-3 text-xs text-gray-400 border-t">
                表示は上位50件です。CSVエクスポートで全{events.length}件を取得できます
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
