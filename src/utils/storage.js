const KEYS = {
  accounts: 'cf_accounts',
  transactions: 'cf_transactions',
}

export function getAccounts() {
  const raw = localStorage.getItem(KEYS.accounts)
  return raw ? JSON.parse(raw) : []
}

export function saveAccounts(accounts) {
  localStorage.setItem(KEYS.accounts, JSON.stringify(accounts))
}

export function getTransactions() {
  const raw = localStorage.getItem(KEYS.transactions)
  return raw ? JSON.parse(raw) : []
}

export function saveTransactions(transactions) {
  localStorage.setItem(KEYS.transactions, JSON.stringify(transactions))
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}
