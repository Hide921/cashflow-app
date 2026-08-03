import React, { useMemo, useState } from 'react'
import ConfirmDialog from './ConfirmDialog.jsx'
import { generateId } from '../utils/storage.js'
import { todayStr } from '../utils/dateHelpers.js'

const COLORS = ['#f97316', '#8b5cf6', '#0ea5e9', '#10b981', '#ef4444', '#64748b']
const LOAN_TYPES = { card: 'カードローン', personal: '個人間借入', other: 'その他' }

const DEFAULT_FORM = {
  name: '', lender: '', loanType: 'card', originalAmount: '', balance: '',
  interestRate: '', monthlyPayment: '', nextPaymentDate: '', notes: '', color: COLORS[0],
}

const DEFAULT_PAYMENT_FORM = { loanId: '', amount: '', paidAt: todayStr(), note: '' }

const PRESETS = {
  chiba: { name: '千葉銀カードローン', lender: '千葉銀行', loanType: 'card', color: COLORS[0] },
  wife: { name: '嫁からの借入', lender: '嫁', loanType: 'personal', color: COLORS[1] },
}

function yen(value) {
  return `¥${Number(value || 0).toLocaleString()}`
}

function toNumber(value) {
  return value === '' ? 0 : Number(value)
}

export default function LoanManager({ loans, payments, onLoansChange, onPaymentsChange, addToast }) {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [paymentForm, setPaymentForm] = useState(DEFAULT_PAYMENT_FORM)
  const [editId, setEditId] = useState(null)
  const [error, setError] = useState('')
  const [paymentError, setPaymentError] = useState('')
  const [confirmTarget, setConfirmTarget] = useState(null)

  const totalBalance = useMemo(() => loans.reduce((sum, loan) => sum + loan.balance, 0), [loans])
  const totalMonthlyPayment = useMemo(() => loans.reduce((sum, loan) => sum + loan.monthlyPayment, 0), [loans])
  const totalPaid = useMemo(() => payments.reduce((sum, payment) => sum + payment.amount, 0), [payments])
  const paymentsByLoan = useMemo(() => {
    return payments.reduce((map, payment) => {
      map[payment.loanId] = (map[payment.loanId] || 0) + payment.amount
      return map
    }, {})
  }, [payments])

  function applyPreset(key) {
    setEditId(null)
    setError('')
    setForm({ ...DEFAULT_FORM, ...PRESETS[key] })
  }

  function handleLoanSubmit(event) {
    event.preventDefault()
    const balance = toNumber(form.balance)
    const originalAmount = form.originalAmount === '' ? balance : toNumber(form.originalAmount)
    if (!form.name.trim()) { setError('借入名を入力してください'); return }
    if (form.balance === '' || balance < 0) { setError('現在残高を入力してください'); return }
    if (originalAmount < balance) { setError('借入総額は現在残高以上で入力してください'); return }
    if (toNumber(form.interestRate) < 0 || toNumber(form.monthlyPayment) < 0) { setError('金額・金利は0以上で入力してください'); return }
    setError('')

    const loan = {
      ...form,
      name: form.name.trim(),
      lender: form.lender.trim(),
      originalAmount,
      balance,
      interestRate: toNumber(form.interestRate),
      monthlyPayment: toNumber(form.monthlyPayment),
      nextPaymentDate: form.nextPaymentDate || null,
      notes: form.notes.trim(),
    }

    if (editId) {
      onLoansChange(loans.map(item => item.id === editId ? { ...loan, id: editId } : item), '借入を更新しました')
      setEditId(null)
    } else {
      onLoansChange([...loans, { ...loan, id: generateId() }], '借入を追加しました')
    }
    setForm(DEFAULT_FORM)
  }

  function handleEdit(loan) {
    setEditId(loan.id)
    setForm({
      name: loan.name,
      lender: loan.lender || '',
      loanType: loan.loanType || 'other',
      originalAmount: String(loan.originalAmount || ''),
      balance: String(loan.balance),
      interestRate: String(loan.interestRate || ''),
      monthlyPayment: String(loan.monthlyPayment || ''),
      nextPaymentDate: loan.nextPaymentDate || '',
      notes: loan.notes || '',
      color: loan.color || COLORS[0],
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleCancel() {
    setEditId(null)
    setForm(DEFAULT_FORM)
    setError('')
  }

  function handleDeleteLoan(loan) {
    onLoansChange(loans.filter(item => item.id !== loan.id), '借入を削除しました')
    onPaymentsChange(payments.filter(payment => payment.loanId !== loan.id))
    setConfirmTarget(null)
  }

  function handlePaymentSubmit(event) {
    event.preventDefault()
    const loan = loans.find(item => item.id === paymentForm.loanId)
    const amount = toNumber(paymentForm.amount)
    if (!loan) { setPaymentError('借入を選択してください'); return }
    if (!amount || amount <= 0) { setPaymentError('返済額を入力してください'); return }
    if (amount > loan.balance) { setPaymentError('返済額が現在残高を超えています'); return }
    setPaymentError('')

    onLoansChange(
      loans.map(item => item.id === loan.id ? { ...item, balance: item.balance - amount } : item),
    )
    onPaymentsChange([
      ...payments,
      { id: generateId(), loanId: loan.id, amount, paidAt: paymentForm.paidAt, note: paymentForm.note.trim() },
    ], '返済を記録しました')
    setPaymentForm({ ...DEFAULT_PAYMENT_FORM, loanId: loan.id, paidAt: todayStr() })
  }

  function handleDeletePayment(payment) {
    const loan = loans.find(item => item.id === payment.loanId)
    if (loan) {
      onLoansChange(loans.map(item => item.id === loan.id ? { ...item, balance: item.balance + payment.amount } : item))
    }
    onPaymentsChange(payments.filter(item => item.id !== payment.id), '返済記録を削除しました')
    setConfirmTarget(null)
  }

  return (
    <div className="space-y-6">
      {confirmTarget?.kind === 'loan' && (
        <ConfirmDialog
          title="借入を削除"
          message={`「${confirmTarget.item.name}」と返済履歴を削除しますか？`}
          onConfirm={() => handleDeleteLoan(confirmTarget.item)}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
      {confirmTarget?.kind === 'payment' && (
        <ConfirmDialog
          title="返済記録を削除"
          message={`${yen(confirmTarget.item.amount)}の返済記録を削除し、借入残高を元に戻しますか？`}
          onConfirm={() => handleDeletePayment(confirmTarget.item)}
          onCancel={() => setConfirmTarget(null)}
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <p className="text-sm text-gray-500 mb-1">借入残高合計</p>
          <p className="text-2xl font-bold text-orange-600">{yen(totalBalance)}</p>
          <p className="text-xs text-gray-400 mt-1">{loans.length}件の借入</p>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <p className="text-sm text-gray-500 mb-1">月間返済予定</p>
          <p className="text-2xl font-bold text-gray-800">{yen(totalMonthlyPayment)}</p>
        </div>
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <p className="text-sm text-gray-500 mb-1">これまでの返済累計</p>
          <p className="text-2xl font-bold text-emerald-600">{yen(totalPaid)}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-700">{editId ? '借入を編集' : '借入を追加'}</h2>
            <p className="text-xs text-gray-400 mt-1">よく使う借入先はボタンから入力できます</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => applyPreset('chiba')} className="border border-orange-200 text-orange-600 px-3 py-1.5 rounded-lg text-xs hover:bg-orange-50">千葉銀カードローン</button>
            <button type="button" onClick={() => applyPreset('wife')} className="border border-purple-200 text-purple-600 px-3 py-1.5 rounded-lg text-xs hover:bg-purple-50">嫁からの借入</button>
          </div>
        </div>
        <form onSubmit={handleLoanSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">借入名 *</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="例: 千葉銀カードローン" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">借入先</label>
            <input className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="例: 千葉銀行、嫁" value={form.lender} onChange={e => setForm(f => ({ ...f, lender: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">種類</label>
            <select className="w-full border rounded-lg px-3 py-2 text-sm" value={form.loanType} onChange={e => setForm(f => ({ ...f, loanType: e.target.value }))}>
              {Object.entries(LOAN_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">借入総額（円）</label>
            <input type="number" min="0" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="例: 500000" value={form.originalAmount} onChange={e => setForm(f => ({ ...f, originalAmount: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">現在残高（円） *</label>
            <input type="number" min="0" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="例: 300000" value={form.balance} onChange={e => setForm(f => ({ ...f, balance: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">金利（年率 %）</label>
            <input type="number" min="0" step="0.01" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="例: 14.8" value={form.interestRate} onChange={e => setForm(f => ({ ...f, interestRate: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">月間返済額（円）</label>
            <input type="number" min="0" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="例: 10000" value={form.monthlyPayment} onChange={e => setForm(f => ({ ...f, monthlyPayment: e.target.value }))} />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">次回返済日</label>
            <input type="date" className="w-full border rounded-lg px-3 py-2 text-sm" value={form.nextPaymentDate} onChange={e => setForm(f => ({ ...f, nextPaymentDate: e.target.value }))} />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm text-gray-600 mb-1">メモ</label>
            <textarea rows="2" className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="契約番号や返済条件など" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="sm:col-span-2 flex gap-2">
            <button type="submit" className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">{editId ? '更新' : '追加'}</button>
            {editId && <button type="button" onClick={handleCancel} className="border px-5 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100">キャンセル</button>}
          </div>
          {error && <p className="sm:col-span-2 text-red-500 text-sm">{error}</p>}
        </form>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {loans.length === 0 && <p className="text-gray-400 text-sm lg:col-span-2">借入がまだ登録されていません。上のボタンから登録できます。</p>}
        {loans.map(loan => {
          const repaid = paymentsByLoan[loan.id] || 0
          const progress = loan.originalAmount > 0 ? Math.min(100, Math.round((repaid / loan.originalAmount) * 100)) : 0
          return (
            <div key={loan.id} className="bg-white rounded-xl shadow-sm border p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <span className="w-3 h-3 rounded-full mt-1.5" style={{ backgroundColor: loan.color }} />
                  <div>
                    <h3 className="font-semibold text-gray-800">{loan.name}</h3>
                    <p className="text-xs text-gray-400">{loan.lender || '借入先未設定'} ・ {LOAN_TYPES[loan.loanType] || LOAN_TYPES.other}</p>
                  </div>
                </div>
                <div className="flex gap-2 text-xs">
                  <button onClick={() => handleEdit(loan)} className="text-blue-600 hover:underline">編集</button>
                  <button onClick={() => setConfirmTarget({ kind: 'loan', item: loan })} className="text-red-500 hover:underline">削除</button>
                </div>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <div><p className="text-xs text-gray-400">現在残高</p><p className="text-2xl font-bold text-orange-600">{yen(loan.balance)}</p></div>
                <div className="text-right text-xs text-gray-500">{loan.interestRate ? `年 ${loan.interestRate}%` : '金利未設定'}<br />月 {yen(loan.monthlyPayment)}</div>
              </div>
              {loan.originalAmount > 0 && <div className="mt-3"><div className="flex justify-between text-xs text-gray-400 mb-1"><span>返済進捗</span><span>{progress}%</span></div><div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 rounded-full" style={{ width: `${progress}%` }} /></div></div>}
              {loan.nextPaymentDate && <p className="text-xs text-gray-500 mt-3">次回返済日: {loan.nextPaymentDate}</p>}
              {loan.notes && <p className="text-xs text-gray-400 mt-2 whitespace-pre-wrap">{loan.notes}</p>}
            </div>
          )
        })}
      </div>

      <div className="bg-white rounded-xl shadow-sm border p-5">
        <h2 className="text-lg font-semibold text-gray-700 mb-1">返済を記録</h2>
        <p className="text-xs text-gray-400 mb-4">記録した金額を借入残高から自動で差し引きます</p>
        <form onSubmit={handlePaymentSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <select className="border rounded-lg px-3 py-2 text-sm" value={paymentForm.loanId} onChange={e => setPaymentForm(f => ({ ...f, loanId: e.target.value }))}>
            <option value="">借入を選択</option>
            {loans.map(loan => <option key={loan.id} value={loan.id}>{loan.name}（残高 {yen(loan.balance)}）</option>)}
          </select>
          <input type="number" min="1" className="border rounded-lg px-3 py-2 text-sm" placeholder="返済額（円）" value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} />
          <input type="date" className="border rounded-lg px-3 py-2 text-sm" value={paymentForm.paidAt} onChange={e => setPaymentForm(f => ({ ...f, paidAt: e.target.value }))} />
          <input className="border rounded-lg px-3 py-2 text-sm" placeholder="メモ（任意）" value={paymentForm.note} onChange={e => setPaymentForm(f => ({ ...f, note: e.target.value }))} />
          <div className="sm:col-span-4 flex items-center gap-3"><button type="submit" disabled={loans.length === 0} className="bg-emerald-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-40">返済を記録</button>{paymentError && <p className="text-red-500 text-sm">{paymentError}</p>}</div>
        </form>
      </div>

      {payments.length > 0 && <div className="bg-white rounded-xl shadow-sm border overflow-hidden"><div className="px-5 py-4 border-b"><h2 className="text-lg font-semibold text-gray-700">返済履歴</h2></div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50 text-gray-500 text-xs"><tr><th className="text-left px-4 py-3">日付</th><th className="text-left px-4 py-3">借入</th><th className="text-right px-4 py-3">返済額</th><th className="text-left px-4 py-3">メモ</th><th className="px-4 py-3" /></tr></thead><tbody className="divide-y">{payments.map(payment => <tr key={payment.id}><td className="px-4 py-3 text-gray-500">{payment.paidAt}</td><td className="px-4 py-3 font-medium text-gray-700">{loans.find(loan => loan.id === payment.loanId)?.name || '削除済みの借入'}</td><td className="px-4 py-3 text-right font-semibold text-emerald-600">{yen(payment.amount)}</td><td className="px-4 py-3 text-gray-500">{payment.note || '—'}</td><td className="px-4 py-3 text-right"><button onClick={() => setConfirmTarget({ kind: 'payment', item: payment })} className="text-xs text-red-500 hover:underline">削除</button></td></tr>)}</tbody></table></div></div>}
    </div>
  )
}
