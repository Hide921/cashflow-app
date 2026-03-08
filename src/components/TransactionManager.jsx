import React, { useState } from 'react'
import { generateId } from '../utils/storage.js'
import { todayStr, formatDisplay } from '../utils/dateHelpers.js'

const CATEGORIES = ['給与', '家賃', '食費', '交通費', '光熱費', '保険', '娯楽', 'その他']
const FREQ_LABELS = { daily: '毎日', weekly: '毎週', monthly: '毎月', yearly: '毎年' }

const DEFAULT_FORM = {
  label: '',
  type: 'expense',
  amount: '',
  category: 'その他',
  accountId: '',
  recurring: false,
  frequency: 'monthly',
  startDate: todayStr(),
  endDate: '',
}

export default function TransactionManager({ accounts, transactions, onChange }) {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [editId, setEditId] = useState(null)
  const [error, setError] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.label.trim()) { setError('名前を入力してください'); return }
    if (!form.amount || Number(form.amount) <= 0) { setError('金額を入力してください'); return }
    if (!form.accountId) { setError('口座を選択してください'); return }
    setError('')

    const tx = {
      ...form,
      amount: Number(form.amount),
      endDate: form.endDate || null,
    }

    if (editId) {
      onChange(transactions.map(t => t.id === editId ? { ...tx, id: editId } : t))
      setEditId(null)
    } else {
      onChange([...transactions, { ...tx, id: generateId() }])
    }
    setForm({ ...DEFAULT_FORM, accountId: form.accountId })
  }

  function handleEdit(tx) {
    setEditId(tx.id)
    setForm({
      label: tx.label,
      type: tx.type,
      amount: String(tx.amount),
      category: tx.category,
      accountId: tx.accountId,
      recurring: tx.recurring,
      frequency: tx.frequency || 'monthly',
      startDate: tx.startDate,
      endDate: tx.endDate || '',
    })
  }

  function handleDelete(id) {
    onChange(transactions.filter(t => t.id !== id))
  }

  function handleCancel() {
    setEditId(null)
    setForm(DEFAULT_FORM)
    setError('')
  }

  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a]))

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border p-5">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">
          {editId ? '取引を編集' : '取引を追加'}
        </h2>
        {accounts.length === 0 && (
          <p className="text-amber-600 text-sm mb-3">先に「口座管理」タブで口座を追加してください</p>
        )}
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-sm text-gray-600 mb-1">名前 *</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="例: 月給、家賃"
              value={form.label}
              onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">種別</label>
            <div className="flex gap-2">
              {['income', 'expense'].map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, type: t }))}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    form.type === t
                      ? t === 'income' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-red-500 text-white border-red-500'
                      : 'text-gray-600 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {t === 'income' ? '収入' : '支出'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">金額 (円) *</label>
            <input
              type="number"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="0"
              min="1"
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">口座 *</label>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={form.accountId}
              onChange={e => setForm(f => ({ ...f, accountId: e.target.value }))}
            >
              <option value="">選択してください</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}{a.bankName ? ` (${a.bankName})` : ''}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">カテゴリ</label>
            <select
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
            >
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          <div className="col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              id="recurring"
              checked={form.recurring}
              onChange={e => setForm(f => ({ ...f, recurring: e.target.checked }))}
              className="w-4 h-4"
            />
            <label htmlFor="recurring" className="text-sm text-gray-600">定期取引</label>
          </div>

          {form.recurring && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">頻度</label>
              <select
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={form.frequency}
                onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}
              >
                {Object.entries(FREQ_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-600 mb-1">
              {form.recurring ? '開始日' : '日付'}
            </label>
            <input
              type="date"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              value={form.startDate}
              onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))}
            />
          </div>

          {form.recurring && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">終了日（任意）</label>
              <input
                type="date"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={form.endDate}
                onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))}
              />
            </div>
          )}

          {error && <p className="col-span-2 text-red-500 text-sm">{error}</p>}

          <div className="col-span-2 flex gap-2">
            <button
              type="submit"
              className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              {editId ? '更新' : '追加'}
            </button>
            {editId && (
              <button
                type="button"
                onClick={handleCancel}
                className="border px-5 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
              >
                キャンセル
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-4 py-3">名前</th>
              <th className="text-left px-4 py-3">種別</th>
              <th className="text-right px-4 py-3">金額</th>
              <th className="text-left px-4 py-3">口座</th>
              <th className="text-left px-4 py-3">頻度</th>
              <th className="text-left px-4 py-3">開始日</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {transactions.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-400">取引がまだ登録されていません</td>
              </tr>
            )}
            {transactions.map(tx => {
              const acc = accountMap[tx.accountId]
              return (
                <tr key={tx.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{tx.label}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      tx.type === 'income' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {tx.type === 'income' ? '収入' : '支出'}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold ${
                    tx.type === 'income' ? 'text-emerald-600' : 'text-red-600'
                  }`}>
                    {tx.type === 'income' ? '+' : '-'}¥{tx.amount.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {acc ? (
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: acc.color }} />
                        {acc.name}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {tx.recurring ? FREQ_LABELS[tx.frequency] : '単発'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{formatDisplay(tx.startDate)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => handleEdit(tx)} className="text-blue-600 hover:underline text-xs">編集</button>
                      <button onClick={() => handleDelete(tx.id)} className="text-red-500 hover:underline text-xs">削除</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
