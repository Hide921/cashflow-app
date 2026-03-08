import React, { useState, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { buildForecast, buildTransactionList } from '../utils/forecast.js'
import { addMonths, addYears, today, format } from '../utils/dateHelpers.js'

const PERIODS = [
  { label: '1ヶ月', months: 1 },
  { label: '3ヶ月', months: 3 },
  { label: '6ヶ月', months: 6 },
  { label: '1年', months: 12 },
]

function formatYen(v) {
  if (Math.abs(v) >= 1_000_000) return `¥${(v / 10000).toFixed(0)}万`
  return `¥${v.toLocaleString()}`
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border rounded-lg shadow p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: ¥{Number(p.value).toLocaleString()}
        </p>
      ))}
    </div>
  )
}

const PAGE_SIZE = 20

export default function Dashboard({ accounts, transactions }) {
  const [periodIdx, setPeriodIdx] = useState(1)
  const [showDetails, setShowDetails] = useState(false)
  const [detailPage, setDetailPage] = useState(0)

  const endDate = useMemo(() => {
    const t = today()
    return addMonths(t, PERIODS[periodIdx].months)
  }, [periodIdx])

  const txList = useMemo(() => {
    if (accounts.length === 0 || transactions.length === 0) return []
    return buildTransactionList(transactions, endDate)
  }, [accounts, transactions, endDate])

  const forecastData = useMemo(() => {
    if (accounts.length === 0) return []
    const full = buildForecast(accounts, transactions, endDate)
    // 間引き: 1ヶ月は毎日, それ以上は週次
    const step = PERIODS[periodIdx].months <= 1 ? 1 : 7
    return full.filter((_, i) => i % step === 0)
  }, [accounts, transactions, endDate, periodIdx])

  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0)

  // 今月の収入・支出（単発 + 定期）
  const thisMonthIncome = useMemo(() => {
    const now = today()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    // 定期取引のみ: 今月内に発生する回数 × 金額
    return transactions
      .filter(tx => tx.type === 'income' && tx.recurring)
      .reduce((s, tx) => {
        // 毎月なら1回カウント
        if (tx.frequency === 'monthly') return s + tx.amount
        if (tx.frequency === 'yearly') return s + tx.amount / 12
        if (tx.frequency === 'weekly') return s + tx.amount * 4
        if (tx.frequency === 'daily') return s + tx.amount * 30
        return s
      }, 0)
  }, [transactions])

  const thisMonthExpense = useMemo(() => {
    return transactions
      .filter(tx => tx.type === 'expense' && tx.recurring)
      .reduce((s, tx) => {
        if (tx.frequency === 'monthly') return s + tx.amount
        if (tx.frequency === 'yearly') return s + tx.amount / 12
        if (tx.frequency === 'weekly') return s + tx.amount * 4
        if (tx.frequency === 'daily') return s + tx.amount * 30
        return s
      }, 0)
  }, [transactions])

  return (
    <div className="space-y-6">
      {/* サマリーカード */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <p className="text-sm text-gray-500 mb-1">総資産</p>
          <p className="text-3xl font-bold text-gray-900">¥{totalBalance.toLocaleString()}</p>
          <p className="text-xs text-gray-400 mt-1">{accounts.length}口座</p>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <p className="text-sm text-gray-500 mb-1">月間収入（定期）</p>
          <p className="text-2xl font-bold text-emerald-600">+¥{Math.round(thisMonthIncome).toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <p className="text-sm text-gray-500 mb-1">月間支出（定期）</p>
          <p className="text-2xl font-bold text-red-500">-¥{Math.round(thisMonthExpense).toLocaleString()}</p>
          <p className={`text-xs mt-1 ${thisMonthIncome - thisMonthExpense >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            月次収支: {thisMonthIncome - thisMonthExpense >= 0 ? '+' : ''}¥{Math.round(thisMonthIncome - thisMonthExpense).toLocaleString()}
          </p>
        </div>
      </div>

      {/* 口座一覧 */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {accounts.map(acc => (
            <div key={acc.id} className="bg-white rounded-lg border shadow-sm p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: acc.color }} />
                <span className="text-xs text-gray-500 truncate">{acc.name}</span>
              </div>
              <p className="font-bold text-gray-800">¥{acc.balance.toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}

      {/* 将来予測グラフ */}
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-700">口座別残高推移</h2>
          <div className="flex gap-1">
            {PERIODS.map((p, i) => (
              <button
                key={i}
                onClick={() => setPeriodIdx(i)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  periodIdx === i ? 'bg-blue-600 text-white' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {accounts.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
            口座を追加するとグラフが表示されます
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={forecastData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={v => v.slice(5)} // MM-DD
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={formatYen}
                width={70}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              {/* 合計 */}
              <Line
                type="monotone"
                dataKey="total"
                name="合計"
                stroke="#1e40af"
                strokeWidth={2.5}
                dot={false}
              />
              {/* 口座別 */}
              {accounts.map(acc => (
                <Line
                  key={acc.id}
                  type="monotone"
                  dataKey={acc.id}
                  name={acc.name}
                  stroke={acc.color}
                  strokeWidth={1.5}
                  dot={false}
                  strokeDasharray="4 2"
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 明細テーブル */}
      {accounts.length > 0 && (
        <div className="bg-white rounded-xl border shadow-sm">
          <button
            onClick={() => { setShowDetails(v => !v); setDetailPage(0) }}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
          >
            <span className="text-lg font-semibold text-gray-700">
              予定明細
              {txList.length > 0 && (
                <span className="ml-2 text-xs font-normal text-gray-400">
                  {PERIODS[periodIdx].label}間 {txList.length}件
                </span>
              )}
            </span>
            <span className="text-gray-400 text-sm">{showDetails ? '▲ 閉じる' : '▼ 開く'}</span>
          </button>

          {showDetails && (
            <>
              {txList.length === 0 ? (
                <p className="text-center py-8 text-gray-400 text-sm">この期間に予定された取引はありません</p>
              ) : (
                <>
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
                        {txList.slice(0, (detailPage + 1) * PAGE_SIZE).map((ev, i) => {
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
                  </div>
                  {txList.length > (detailPage + 1) * PAGE_SIZE && (
                    <div className="px-5 py-3 border-t text-center">
                      <button
                        onClick={() => setDetailPage(p => p + 1)}
                        className="text-sm text-blue-600 hover:underline"
                      >
                        もっと見る（残り {txList.length - (detailPage + 1) * PAGE_SIZE} 件）
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
