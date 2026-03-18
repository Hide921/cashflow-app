import React, { useState, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { buildForecast, buildTransactionList } from '../utils/forecast.js'
import { addMonths, today } from '../utils/dateHelpers.js'
import { generateId } from '../utils/storage.js'

const PERIODS = [
  { label: '1ヶ月', months: 1 },
  { label: '3ヶ月', months: 3 },
  { label: '6ヶ月', months: 6 },
  { label: '1年', months: 12 },
]

const CATEGORIES = ['給与', '家賃', '食費', '交通費', '光熱費', '保険', '娯楽', 'その他']

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
      <p className="mt-1.5 text-blue-500 font-medium">クリックして取引を追加</p>
    </div>
  )
}

function AddTransactionModal({ date, accounts, onSave, onClose }) {
  const [form, setForm] = useState({
    label: '',
    type: 'expense',
    amount: '',
    category: 'その他',
    accountId: accounts[0]?.id || '',
  })
  const [error, setError] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.label.trim()) { setError('名前を入力してください'); return }
    if (!form.amount || Number(form.amount) <= 0) { setError('金額を入力してください'); return }
    if (!form.accountId) { setError('口座を選択してください'); return }
    onSave({
      id: generateId(),
      label: form.label.trim(),
      type: form.type,
      amount: Number(form.amount),
      category: form.category,
      accountId: form.accountId,
      recurring: false,
      frequency: 'monthly',
      startDate: date,
      endDate: null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-800">取引を追加</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <p className="text-xs text-gray-500 mb-4">日付: {date}</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">名前 *</label>
            <input
              autoFocus
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="例: 食費、給与"
              value={form.label}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
            />
          </div>

          <div className="flex gap-2">
            {['income', 'expense'].map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setForm(f => ({ ...f, type: t }))}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  form.type === t
                    ? t === 'income' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-red-500 text-white border-red-500'
                    : 'text-gray-600 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {t === 'income' ? '収入' : '支出'}
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">金額 (円) *</label>
            <input
              type="number"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="0"
              min="1"
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-600 mb-1">口座 *</label>
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={form.accountId}
                onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}
              >
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">カテゴリ</label>
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              >
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {error && <p className="text-red-500 text-xs">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              追加
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              キャンセル
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const PAGE_SIZE = 20

export default function Dashboard({ accounts, transactions, onTransactionAdd, onAccountUpdate }) {
  const [periodIdx, setPeriodIdx] = useState(1)
  const [showDetails, setShowDetails] = useState(false)
  const [detailPage, setDetailPage] = useState(0)
  const [addModalDate, setAddModalDate] = useState(null)
  const [editingAccountId, setEditingAccountId] = useState(null)
  const [editingBalance, setEditingBalance] = useState('')

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
    const step = PERIODS[periodIdx].months <= 1 ? 1 : 7
    return full.filter((_, i) => i % step === 0)
  }, [accounts, transactions, endDate, periodIdx])

  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0)

  const thisMonthIncome = useMemo(() => {
    return transactions
      .filter(tx => tx.type === 'income' && tx.recurring)
      .reduce((s, tx) => {
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

  function handleChartClick(data) {
    if (!data?.activeLabel || accounts.length === 0) return
    // activeLabel は "MM-DD" 形式なので今年と組み合わせる
    const year = new Date().getFullYear()
    const fullDate = `${year}-${data.activeLabel}`
    setAddModalDate(fullDate)
  }

  function handleAccountCardClick(acc) {
    setEditingAccountId(acc.id)
    setEditingBalance(String(acc.balance))
  }

  function handleBalanceSave(acc) {
    const newBalance = Number(editingBalance)
    if (isNaN(newBalance)) return
    onAccountUpdate({ ...acc, balance: newBalance })
    setEditingAccountId(null)
  }

  return (
    <div className="space-y-6">
      {/* 取引追加モーダル */}
      {addModalDate && (
        <AddTransactionModal
          date={addModalDate}
          accounts={accounts}
          onSave={tx => {
            onTransactionAdd(tx)
            setAddModalDate(null)
          }}
          onClose={() => setAddModalDate(null)}
        />
      )}

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

      {/* 口座一覧（クリックで残高インライン編集） */}
      {accounts.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {accounts.map(acc => (
            <div
              key={acc.id}
              className="bg-white rounded-lg border shadow-sm p-3 cursor-pointer hover:border-blue-300 hover:shadow-md transition-all group"
              onClick={() => editingAccountId !== acc.id && handleAccountCardClick(acc)}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: acc.color }} />
                <span className="text-xs text-gray-500 truncate flex-1">{acc.name}</span>
                <span className="text-xs text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity">✎</span>
              </div>
              {editingAccountId === acc.id ? (
                <div className="flex items-center gap-1 mt-1" onClick={e => e.stopPropagation()}>
                  <span className="text-sm text-gray-500">¥</span>
                  <input
                    autoFocus
                    type="number"
                    className="w-full border rounded px-1.5 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={editingBalance}
                    onChange={e => setEditingBalance(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleBalanceSave(acc)
                      if (e.key === 'Escape') setEditingAccountId(null)
                    }}
                  />
                  <button
                    onClick={() => handleBalanceSave(acc)}
                    className="text-blue-600 text-xs font-medium hover:underline whitespace-nowrap"
                  >
                    保存
                  </button>
                </div>
              ) : (
                <p className="font-bold text-gray-800">¥{acc.balance.toLocaleString()}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 将来予測グラフ */}
      <div className="bg-white rounded-xl border shadow-sm p-5">
        <div className="flex items-center justify-between mb-1">
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
        <p className="text-xs text-gray-400 mb-4">グラフをクリックするとその日付で取引を追加できます</p>

        {accounts.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-gray-400 text-sm">
            口座を追加するとグラフが表示されます
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart
              data={forecastData}
              margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
              onClick={handleChartClick}
              style={{ cursor: 'crosshair' }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11 }}
                tickFormatter={v => v.slice(5)}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={formatYen}
                width={70}
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend />
              <Line
                type="monotone"
                dataKey="total"
                name="合計"
                stroke="#1e40af"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 6, cursor: 'pointer' }}
              />
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
                  activeDot={{ r: 5, cursor: 'pointer' }}
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
