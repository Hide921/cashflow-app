import React, { useState, useEffect } from 'react'
import Dashboard from './components/Dashboard.jsx'
import AccountManager from './components/AccountManager.jsx'
import TransactionManager from './components/TransactionManager.jsx'
import { getAccounts, saveAccounts, getTransactions, saveTransactions } from './utils/storage.js'

const TABS = ['ダッシュボード', '口座管理', '取引管理']

export default function App() {
  const [tab, setTab] = useState(0)
  const [accounts, setAccounts] = useState([])
  const [transactions, setTransactions] = useState([])

  useEffect(() => {
    setAccounts(getAccounts())
    setTransactions(getTransactions())
  }, [])

  function updateAccounts(next) {
    setAccounts(next)
    saveAccounts(next)
  }

  function updateTransactions(next) {
    setTransactions(next)
    saveTransactions(next)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800">資金管理</h1>
          <nav className="flex gap-1">
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

      <main className="max-w-5xl mx-auto px-4 py-6">
        {tab === 0 && (
          <Dashboard accounts={accounts} transactions={transactions} />
        )}
        {tab === 1 && (
          <AccountManager accounts={accounts} onChange={updateAccounts} />
        )}
        {tab === 2 && (
          <TransactionManager
            accounts={accounts}
            transactions={transactions}
            onChange={updateTransactions}
          />
        )}
      </main>
    </div>
  )
}
