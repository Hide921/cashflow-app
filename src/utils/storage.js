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

function isMissingTableError(error, tableName) {
  const message = error?.message || ''
  return error?.code === '42P01'
    || error?.code === 'PGRST205' && message.includes(tableName)
    || message.includes(`relation "${tableName}" does not exist`)
}

export async function getLoans() {
  const { data, error } = await supabase
    .from('loans')
    .select('*')
    .order('created_at')
  if (error) {
    // マイグレーション前でも既存機能は利用できるようにする
    if (isMissingTableError(error, 'loans')) return []
    throw error
  }
  return data.map(row => ({
    id: row.id,
    name: row.name,
    lender: row.lender,
    loanType: row.loan_type,
    originalAmount: row.original_amount,
    balance: row.balance,
    interestRate: row.interest_rate,
    monthlyPayment: row.monthly_payment,
    nextPaymentDate: row.next_payment_date,
    notes: row.notes,
    color: row.color,
  }))
}

export async function saveLoans(loans) {
  const { data: existing, error: existingError } = await supabase.from('loans').select('id')
  if (existingError) throw existingError
  const existingIds = new Set((existing || []).map(r => r.id))
  const newIds = new Set(loans.map(loan => loan.id))

  const toDelete = [...existingIds].filter(id => !newIds.has(id))
  if (toDelete.length) {
    const { error } = await supabase.from('loans').delete().in('id', toDelete)
    if (error) throw error
  }

  if (loans.length) {
    const rows = loans.map(loan => ({
      id: loan.id,
      name: loan.name,
      lender: loan.lender,
      loan_type: loan.loanType,
      original_amount: loan.originalAmount,
      balance: loan.balance,
      interest_rate: loan.interestRate,
      monthly_payment: loan.monthlyPayment,
      next_payment_date: loan.nextPaymentDate || null,
      notes: loan.notes || null,
      color: loan.color,
    }))
    const { error } = await supabase.from('loans').upsert(rows)
    if (error) throw error
  }
}

export async function getLoanPayments() {
  const { data, error } = await supabase
    .from('loan_payments')
    .select('*')
    .order('paid_at', { ascending: false })
  if (error) {
    if (isMissingTableError(error, 'loan_payments')) return []
    throw error
  }
  return data.map(row => ({
    id: row.id,
    loanId: row.loan_id,
    amount: row.amount,
    paidAt: row.paid_at,
    note: row.note,
  }))
}

export async function saveLoanPayments(payments) {
  const { data: existing, error: existingError } = await supabase.from('loan_payments').select('id')
  if (existingError) throw existingError
  const existingIds = new Set((existing || []).map(r => r.id))
  const newIds = new Set(payments.map(payment => payment.id))

  const toDelete = [...existingIds].filter(id => !newIds.has(id))
  if (toDelete.length) {
    const { error } = await supabase.from('loan_payments').delete().in('id', toDelete)
    if (error) throw error
  }

  if (payments.length) {
    const rows = payments.map(payment => ({
      id: payment.id,
      loan_id: payment.loanId,
      amount: payment.amount,
      paid_at: payment.paidAt,
      note: payment.note || null,
    }))
    const { error } = await supabase.from('loan_payments').upsert(rows)
    if (error) throw error
  }
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}
