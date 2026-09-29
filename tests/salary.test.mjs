import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.search(/<script>\s*const \{ useState/);
const end = html.indexOf('</script>', start);
const source = html.slice(html.indexOf('>', start) + 1, end)
  .replace(/ReactDOM\.createRoot[\s\S]*$/, '');
const context = {
  React: { createElement: () => null },
  supabase: { createClient: () => ({}) },
  window: { location: { hostname: 'localhost', search: '' } },
  URLSearchParams,
};
runInNewContext(source, context);
const evaluate = code => runInNewContext(code, context);

test('給与の手取りだけが支給日の入金として扱われる', () => {
  const payDate = evaluate('fmt(addDays(todayD(), 2))');
  context.draft = { month: payDate.slice(0, 7), payDate, employer: '勤務先', gross: '30万', deductions: '50000', accountId: 'bank' };
  const { error, transaction: tx } = evaluate('salaryTransactionFromDraft(draft)');
  assert.equal(error, undefined);
  assert.equal(tx.amount, 250000);
  assert.equal(tx.type, 'income');
  assert.equal(tx.recurring, false);
  assert.equal(tx.salary.gross, 300000);
  assert.equal(tx.salary.deductions, 50000);
  context.tx = tx;
  context.payDate = payDate;
  const rows = evaluate('buildForecast([{id:"bank",balance:1000}], [tx], parseISO(payDate), new Set())');
  assert.equal(rows.at(-1).bank, 251000);
});

test('給与編集でIDを維持し、年別集計は対象月を使う', () => {
  context.draft = { month: '2026-12', payDate: '2027-01-05', employer: '', gross: '400000', deductions: '100000', accountId: 'bank' };
  context.old = { id: 'salary-1', salary: { month: '2026-11' }, amount: 1 };
  const { transaction: tx } = evaluate('salaryTransactionFromDraft(draft,old)');
  assert.equal(tx.id, 'salary-1');
  assert.equal(tx.amount, 300000);
  context.tx = tx;
  assert.deepEqual(JSON.parse(JSON.stringify(evaluate('salaryYearTotals([tx],2026)'))), { gross: 400000, socialInsurance: 0, incomeTax: 0, residentTax: 0, otherDeductions: 100000, deductions: 100000, net: 300000 });
  assert.equal(evaluate('salaryYearTotals([tx],2027).net'), 0);
});

test('不正な控除額や日付は給与として保存できない', () => {
  context.draft = { month: '2026-02', payDate: '2026-02-30', gross: '300000', deductions: '0', accountId: 'bank' };
  assert.match(evaluate('salaryTransactionFromDraft(draft).error'), /支給日/);
  context.draft.payDate = '2026-02-28';
  context.draft.deductions = '300000';
  assert.match(evaluate('salaryTransactionFromDraft(draft).error'), /控除額/);
  context.draft.deductions = '-1';
  assert.match(evaluate('salaryTransactionFromDraft(draft).error'), /控除/);
});

test('社保・税金から振込額を計算し、賞与を月給とは別の行に集計する', () => {
  context.draft = { month: '2026-06', payDate: '2026-06-25', kind: 'summerBonus', gross: '500000', socialInsurance: '70000', incomeTax: '40000', residentTax: '0', otherDeductions: '5000', accountId: 'bank' };
  const { transaction: bonus } = evaluate('salaryTransactionFromDraft(draft)');
  assert.equal(bonus.amount, 385000);
  assert.equal(bonus.label, '夏季賞与');
  assert.equal(bonus.salary.deductions, 115000);
  context.bonus = bonus;
  const rows = evaluate('salaryAnnualRows([bonus],2026)');
  assert.equal(rows.length, 14);
  assert.equal(rows[5].items.length, 0);
  assert.equal(rows[12].label, '夏季賞与');
  assert.equal(rows[12].net, 385000);
  assert.equal(rows[13].net, 0);
});

test('従来の控除合計はその他控除として表示できる', () => {
  context.legacy = { amount: 250000, salary: { month: '2026-04', gross: 300000, deductions: 50000 } };
  const parts = evaluate('salaryBreakdown(legacy)');
  assert.equal(parts.otherDeductions, 50000);
  assert.equal(parts.net, 250000);
});

test('前月の月給を翌月の入力欄へコピーし、元データは変更しない', () => {
  context.previous = { id: 'salary-dec', type: 'income', accountId: 'bank', startDate: '2027-01-25', amount: 255000,
    salary: { month: '2026-12', kind: 'monthly', employer: '勤務先', gross: 300000, socialInsurance: 30000, incomeTax: 10000, residentTax: 5000, otherDeductions: 0, deductions: 45000 } };
  const draft = evaluate('salaryDraftFromPrevious(previous,"2027-01")');
  assert.equal(draft.month, '2027-01');
  assert.equal(draft.payDate, '2027-02-25');
  assert.equal(draft.gross, '300000');
  assert.equal(draft.socialInsurance, '30000');
  assert.equal(draft.accountId, 'bank');
  assert.equal(draft.id, undefined);
  assert.equal(context.previous.salary.month, '2026-12');
  context.copied = draft;
  assert.equal(evaluate('salaryTransactionFromDraft(copied).transaction.amount'), 255000);
  assert.equal(evaluate('salaryDraftFromPrevious(previous,"2027-02")'), null);
});

test('賞与は前月の月給としてコピーしない', () => {
  context.bonusPrevious = { startDate: '2026-06-25',salary: {month:'2026-06',kind:'summerBonus',gross:500000,deductions:50000} };
  assert.equal(evaluate('salaryDraftFromPrevious(bonusPrevious,"2026-07")'), null);
});
