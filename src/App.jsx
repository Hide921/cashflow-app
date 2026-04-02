import React, { useState, useEffect } from 'react'
import Dashboard from './components/Dashboard.jsx'
import AccountManager from './components/AccountManager.jsx'
import TransactionManager from './components/TransactionManager.jsx'
import ReportView from './components/ReportView.jsx'
import { ToastContainer, useToast } from './components/Toast.jsx'
import { getAccounts, saveAccounts, getTransactions, saveTransactions } from './utils/storage.js'

const TABS = ['ダッシュボード', '口座管理', '取引管理', 'レポート']

export default function App() {
  const [tab, setTab] = useState(0)
  const [accounts, setAccounts] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { toasts, addToast } = useToast()

  useEffect(() => {
    Promise.all([getAccounts(), getTransactions()])
      .then(([accs, txs]) => {
        setAccounts(accs)
        setTransactions(txs)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function updateAccounts(next, successMsg) {
    setAccounts(next)
    try {
      await saveAccounts(next)
      if (successMsg) addToast(successMsg)
    } catch (e) {
      setError(e.message)
      addToast(e.message, 'error')
    }
  }

  async function updateTransactions(next, successMsg) {
    setTransactions(next)
    try {
      await saveTransactions(next)
      if (successMsg) addToast(successMsg)
    } catch (e) {
      setError(e.message)
      addToast(e.message, 'error')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">読み込み中...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800">資金管理</h1>
          <nav className="flex gap-1 flex-wrap justify-end">
            {TABS.map((label, i) => (
              <button
                key={i}
                onClick={() => setTab(i)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  tab === i
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {error && (
        <div className="max-w-5xl mx-auto px-4 pt-4">
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 flex justify-between">
            <span>エラー: {error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">✕</button>
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-6">
        {tab === 0 && (
          <Dashboard
            accounts={accounts}
            transactions={transactions}
            onTransactionAdd={tx => updateTransactions([...transactions, tx], '取引を追加しました')}
            onAccountUpdate={updated => updateAccounts(
              accounts.map(a => a.id === updated.id ? updated : a),
              '残高を更新しました'
            )}
          />
        )}
        {tab === 1 && (
          <AccountManager
            accounts={accounts}
            onChange={updateAccounts}
            addToast={addToast}
          />
        )}
        {tab === 2 && (
          <TransactionManager
            accounts={accounts}
            transactions={transactions}
            onChange={updateTransactions}
            addToast={addToast}
          />
        )}
        {tab === 3 && (
          <ReportView
            accounts={accounts}
            transactions={transactions}
          />
        )}
      </main>

      <ToastContainer toasts={toasts} />
    </div>
  )
}
