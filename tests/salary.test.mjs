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
  assert.deepEqual(JSON.parse(JSON.stringify(evaluate('salaryYearTotals([tx],2026)'))), { gross: 400000, deductions: 100000, net: 300000 });
  assert.equal(evaluate('salaryYearTotals([tx],2027).net'), 0);
});

test('不正な控除額や日付は給与として保存できない', () => {
  context.draft = { month: '2026-02', payDate: '2026-02-30', gross: '300000', deductions: '0', accountId: 'bank' };
  assert.match(evaluate('salaryTransactionFromDraft(draft).error'), /支給日/);
  context.draft.payDate = '2026-02-28';
  context.draft.deductions = '300000';
  assert.match(evaluate('salaryTransactionFromDraft(draft).error'), /控除額/);
  context.draft.deductions = '-1';
  assert.match(evaluate('salaryTransactionFromDraft(draft).error'), /控除額/);
});
