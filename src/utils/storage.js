import { supabase } from './supabase.js'

export async function getAccounts() {
  const { data, error } = await supabase
    .from('accounts')
    .select('*')
    .order('created_at')
  if (error) throw error
  return data.map(row => ({
    id: row.id,
    name: row.name,
    bankName: row.bank_name,
    balance: row.balance,
    color: row.color,
  }))
}

export async function saveAccounts(accounts) {
  const { data: existing } = await supabase.from('accounts').select('id')
  const existingIds = new Set((existing || []).map(r => r.id))
  const newIds = new Set(accounts.map(a => a.id))

  const toDelete = [...existingIds].filter(id => !newIds.has(id))
  if (toDelete.length) {
    const { error } = await supabase.from('accounts').delete().in('id', toDelete)
    if (error) throw error
  }

  if (accounts.length) {
    const rows = accounts.map(a => ({
      id: a.id,
      name: a.name,
      bank_name: a.bankName,
      balance: a.balance,
      color: a.color,
    }))
    const { error } = await supabase.from('accounts').upsert(rows)
    if (error) throw error
  }
}

export async function getTransactions() {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .order('created_at')
  if (error) throw error
  return data.map(row => ({
    id: row.id,
    label: row.label,
    type: row.type,
    amount: row.amount,
    category: row.category,
    accountId: row.account_id,
    recurring: row.recurring,
    frequency: row.frequency,
    startDate: row.start_date,
    endDate: row.end_date,
  }))
}

export async function saveTransactions(transactions) {
  const { data: existing } = await supabase.from('transactions').select('id')
  const existingIds = new Set((existing || []).map(r => r.id))
  const newIds = new Set(transactions.map(t => t.id))

  const toDelete = [...existingIds].filter(id => !newIds.has(id))
  if (toDelete.length) {
    const { error } = await supabase.from('transactions').delete().in('id', toDelete)
    if (error) throw error
  }

  if (transactions.length) {
    const rows = transactions.map(t => ({
      id: t.id,
      label: t.label,
      type: t.type,
      amount: t.amount,
      category: t.category,
      account_id: t.accountId,
      recurring: t.recurring,
      frequency: t.frequency,
      start_date: t.startDate,
      end_date: t.endDate,
    }))
    const { error } = await supabase.from('transactions').upsert(rows)
    if (error) throw error
  }
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}
