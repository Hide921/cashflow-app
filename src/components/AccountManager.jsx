import React, { useState } from 'react'
import { generateId } from '../utils/storage.js'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16']

const DEFAULT_FORM = { name: '', bankName: '', balance: '', color: COLORS[0] }

export default function AccountManager({ accounts, onChange }) {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [editId, setEditId] = useState(null)
  const [error, setError] = useState('')

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim()) { setError('口座名を入力してください'); return }
    if (form.balance === '') { setError('残高を入力してください'); return }
    setError('')

    if (editId) {
      onChange(accounts.map(a => a.id === editId ? { ...a, ...form, balance: Number(form.balance) } : a))
      setEditId(null)
    } else {
      onChange([...accounts, { id: generateId(), ...form, balance: Number(form.balance) }])
    }
    setForm(DEFAULT_FORM)
  }

  function handleEdit(acc) {
    setEditId(acc.id)
    setForm({ name: acc.name, bankName: acc.bankName, balance: String(acc.balance), color: acc.color })
  }

  function handleDelete(id) {
    onChange(accounts.filter(a => a.id !== id))
  }

  function handleCancel() {
    setEditId(null)
    setForm(DEFAULT_FORM)
    setError('')
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border p-5">
        <h2 className="text-lg font-semibold text-gray-700 mb-4">
          {editId ? '口座を編集' : '口座を追加'}
        </h2>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">口座名 *</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="例: 普通預金"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">銀行名</label>
            <input
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="例: 三菱UFJ銀行"
              value={form.bankName}
              onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">現在残高 (円) *</label>
            <input
              type="number"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              placeholder="0"
              value={form.balance}
              onChange={e => setForm(f => ({ ...f, balance: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">カラー</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, color: c }))}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${form.color === c ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {accounts.length === 0 && (
          <p className="text-gray-400 text-sm col-span-full">口座がまだ登録されていません</p>
        )}
        {accounts.map(acc => (
          <div key={acc.id} className="bg-white rounded-xl shadow-sm border p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: acc.color }} />
              <span className="font-semibold text-gray-800">{acc.name}</span>
            </div>
            {acc.bankName && <p className="text-xs text-gray-400">{acc.bankName}</p>}
            <p className="text-2xl font-bold text-gray-900">
              ¥{acc.balance.toLocaleString()}
            </p>
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => handleEdit(acc)}
                className="text-xs text-blue-600 hover:underline"
              >
                編集
              </button>
              <button
                onClick={() => handleDelete(acc.id)}
                className="text-xs text-red-500 hover:underline"
              >
                削除
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
