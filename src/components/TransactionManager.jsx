import React, { useState, useMemo } from 'react'
import { generateId } from '../utils/storage.js'
import { todayStr, formatDisplay } from '../utils/dateHelpers.js'
import ConfirmDialog from './ConfirmDialog.jsx'

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

function downloadCSV(transactions, accounts) {
  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]))
  const header = ['名前', '種別', 'カテゴリ', '口座', '金額', '頻度', '開始日', '終了日']
  const rows = transactions.map(tx => [
    `"${tx.label.replace(/"/g, '""')}"`,
    tx.type === 'income' ? '収入' : '支出',
    tx.category || '',
    accountMap[tx.accountId] || '',
    tx.type === 'income' ? tx.amount : -tx.amount,
    tx.recurring ? (FREQ_LABELS[tx.frequency] || tx.frequency) : '単発',
    tx.startDate || '',
    tx.endDate || '',
  ])
  const csv = [header, ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `transactions_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function TransactionManager({ accounts, transactions, onChange, addToast }) {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [editId, setEditId] = useState(null)
  const [error, setError] = useState('')
  const [confirmTarget, setConfirmTarget] = useState(null)
  const [searchText, setSearchText] = useState('')
  const [filterType, setFilterType] = useState('all') // 'all' | 'income' | 'expense'
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterAccount, setFilterAccount] = useState('all')

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
      onChange(transactions.map(t => t.id === editId ? { ...tx, id: editId } : t), '取引を更新しました')
      setEditId(null)
    } else {
      onChange([...transactions, { ...tx, id: generateId() }], '取引を追加しました')
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
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleDeleteConfirmed() {
    if (!confirmTarget) return
    onChange(transactions.filter(t => t.id !== confirmTarget.id), `「${confirmTarget.label}」を削除しました`)
    setConfirmTarget(null)
  }

  function handleCancel() {
    setEditId(null)
    setForm(DEFAULT_FORM)
    setError('')
  }

  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a]))

  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      if (filterType !== 'all' && tx.type !== filterType) return false
      if (filterCategory !== 'all' && tx.category !== filterCategory) return false
      if (filterAccount !== 'all' && tx.accountId !== filterAccount) return false
      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase()
        if (!tx.label.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [transactions, filterType, filterCategory, filterAccount, searchText])

  const hasFilter = searchText || filterType !== 'all' || filterCategory !== 'all' || filterAccount !== 'all'

  return (
    <div className="space-y-6">
      {confirmTarget && (
        <ConfirmDialog
          title="取引を削除"
          message={`「${confirmTarget.label}」を削除しますか？この操作は取り消せません。`}
          onConfirm={handleDeleteConfirmed}
          onCancel={() => setConfirmTarget(null)}
        />
      )}

      {/* 入力フォーム */}
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
              className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              {editId ? '更新' : '追加'}
            </button>
            {editId && (
              <button
                type="button"
                onClick={handleCancel}
                className="border px-5 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100 transition-colors"
              >
                キャンセル
              </button>
            )}
          </div>
        </form>
      </div>

      {/* 検索・フィルタバー */}
      <div className="bg-white rounded-xl shadow-sm border p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* テキスト検索 */}
          <div className="relative flex-1 min-w-40">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="取引名で検索..."
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
            />
          </div>

          {/* 種別フィルタ */}
          <select
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
          >
            <option value="all">全種別</option>
            <option value="income">収入のみ</option>
            <option value="expense">支出のみ</option>
          </select>

          {/* カテゴリフィルタ */}
          <select
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}
          >
            <option value="all">全カテゴリ</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* 口座フィルタ */}
          <select
            className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={filterAccount}
            onChange={e => setFilterAccount(e.target.value)}
          >
            <option value="all">全口座</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>

          {/* CSV */}
          <button
            onClick={() => downloadCSV(filteredTransactions, accounts)}
            disabled={filteredTransactions.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ml-auto"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            CSV
          </button>

          {hasFilter && (
            <button
              onClick={() => { setSearchText(''); setFilterType('all'); setFilterCategory('all'); setFilterAccount('all') }}
              className="text-xs text-blue-600 hover:underline whitespace-nowrap"
            >
              フィルタをリセット
            </button>
          )}
        </div>

        {hasFilter && (
          <p className="text-xs text-gray-500">
            {filteredTransactions.length} / {transactions.length} 件を表示中
          </p>
        )}
      </div>

      {/* 取引一覧テーブル */}
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
            {filteredTransactions.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-gray-400">
                  {transactions.length === 0 ? '取引がまだ登録されていません' : '条件に一致する取引がありません'}
                </td>
              </tr>
            )}
            {filteredTransactions.map(tx => {
              const acc = accountMap[tx.accountId]
              return (
                <tr key={tx.id} className={`hover:bg-gray-50 ${editId === tx.id ? 'bg-blue-50' : ''}`}>
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
                        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: acc.color }} />
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
                      <button onClick={() => setConfirmTarget(tx)} className="text-red-500 hover:underline text-xs">削除</button>
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
