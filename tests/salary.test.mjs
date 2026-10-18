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

test('月給は月末、賞与は15日を基準に土日祝を前営業日へ繰り上げる', () => {
  const cases = [
    ['2026-01', 'monthly', '2026-01-30'],
    ['2026-02', 'monthly', '2026-02-27'],
    ['2026-05', 'monthly', '2026-05-29'],
    ['2024-02', 'monthly', '2024-02-29'],
    ['2026-06', 'summerBonus', '2026-06-15'],
    ['2026-08', 'summerBonus', '2026-08-14'],
    ['2026-11', 'winterBonus', '2026-11-13'],
  ];
  for (const [month, kind, expected] of cases) {
    assert.equal(evaluate(`salaryDefaultPayDate('${month}','${kind}')`), expected);
  }
  assert.equal(evaluate("salaryDefaultPayDate('2026-13','monthly')"), '');
});

test('定期収支には勤務先ごとの直近月給を含め、賞与・未来月・過去月の重複を除く', () => {
  const rows = [
    { type: 'income', recurring: true, frequency: 'monthly', amount: 50000 },
    { type: 'expense', recurring: true, frequency: 'monthly', amount: 539103 },
    { type: 'income', recurring: false, amount: 240000, salary: { month: '2026-08', kind: 'monthly', employer: 'A' } },
    { type: 'income', recurring: false, amount: 250000, salary: { month: '2026-09', kind: 'monthly', employer: 'A' } },
    { type: 'income', recurring: false, amount: 100000, salary: { month: '2026-08', kind: 'monthly', employer: 'B' } },
    { type: 'income', recurring: false, amount: 350000, salary: { month: '2026-09', kind: 'summerBonus', employer: 'A' } },
    { type: 'income', recurring: false, amount: 260000, salary: { month: '2026-10', kind: 'monthly', employer: 'A' } },
  ];
  context.runRateRows = rows;
  const result = evaluate("monthlyRunRate(runRateRows,'2026-09')");
  assert.equal(result.inc, 400000);
  assert.equal(result.exp, 539103);
  assert.equal(result.salary, 350000);
  assert.deepEqual(Array.from(result.salaryMonths), ['2026-08', '2026-09']);
  assert.equal(evaluate("monthlyRunRate(runRateRows,'2026-07').salary"), 0);
});

test('給与の手取りだけが支給日の入金として扱われる', () => {
  const payDate = evaluate('fmt(nextBizDay(addDays(todayD(), 2)))');
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

test('9月の月給から5〜8月を一括コピーするとき、登録済みの同じ勤務先だけ除外する', () => {
  context.source = { id: 'sep', type: 'income', accountId: 'bank', startDate: '2026-09-30', amount: 450000,
    salary: { month: '2026-09', kind: 'monthly', employer: '勤務先A', gross: 500000, deductions: 50000 } };
  context.existing = { id: 'july', type: 'income', salary: { month: '2026-07', kind: 'monthly', employer: '勤務先A' } };
  context.otherEmployer = { id: 'may-other', type: 'income', salary: { month: '2026-05', kind: 'monthly', employer: '勤務先B' } };
  const plan = evaluate('salaryBulkCopyPlan([source,existing,otherEmployer],source,"2026-05","2026-08")');
  assert.equal(plan.error, '');
  assert.deepEqual(Array.from(plan.rows, row => [row.month, row.payDate, row.status]), [
    ['2026-05', '2026-05-29', '作成'],
    ['2026-06', '2026-06-30', '作成'],
    ['2026-07', '2026-07-31', '登録済み'],
    ['2026-08', '2026-08-31', '作成'],
  ]);
  context.draft = evaluate('salaryDraftFromSource(source,"2026-05")');
  const copied = evaluate('salaryTransactionFromDraft(draft).transaction');
  assert.equal(copied.startDate, '2026-05-29');
  assert.equal(copied.amount, 450000);
  assert.notEqual(copied.id, context.source.id);
  assert.equal(context.source.startDate, '2026-09-30');
  assert.equal(evaluate('salaryBulkCopyPlan([source],source,"2026-09","2026-09").rows[0].status'), 'コピー元');
  assert.match(evaluate('salaryBulkCopyPlan([source],source,"2026-08","2026-05").error'), /終了月/);
  assert.match(evaluate('salaryBulkCopyPlan([source],source,"2025-01","2027-01").error'), /24か月/);
});

test('年間合計は月給・賞与と支給済み・予定に分けて集計する', () => {
  const tx = (id, month, kind, gross, deductions, amount, startDate) => ({ id, type: 'income', amount, startDate, salary: { month, kind, gross, deductions, socialInsurance: deductions } });
  const records = [
    tx('a', '2026-01', 'monthly', 300000, 60000, 240000, '2026-01-30'),
    tx('b', '2026-06', 'summerBonus', 500000, 100000, 400000, '2026-06-30'),
    tx('c', '2026-12', 'monthly', 300000, 60000, 240000, '2026-12-30'),
    tx('x', '2025-12', 'monthly', 1, 0, 1, '2025-12-30'),
  ];
  const summary = evaluate('salaryYearSummary')(records, 2026, '2026-10-07');
  assert.equal(summary.count, 3);
  assert.equal(summary.gross, 1100000);
  assert.equal(summary.deductions, 220000);
  assert.equal(summary.net, 880000);
  assert.equal(summary.monthly.net, 480000);
  assert.equal(summary.bonus.net, 400000);
  assert.equal(summary.paid.net, 640000);
  assert.equal(summary.scheduled.net, 240000);
});

test('簡易年末調整: 令和7年分と令和8年分の税制で年調年税額と還付額を計算する', () => {
  const estimate = evaluate('estimateYearEndAdjustment');
  // 給与500万円・社保75万円・源泉15万円
  // 令和7年分: 給与所得356万円、基礎控除68万円 → 課税所得213万円 → 115,500円 ×102.1% → 117,900円
  const r7 = estimate({ year: 2025, gross: 5000000, socialInsurance: 750000, withheld: 150000 });
  assert.equal(r7.salaryIncome, 3560000);
  assert.equal(r7.deductions.basic, 680000);
  assert.equal(r7.taxable, 2130000);
  assert.equal(r7.annualTax, 117900);
  assert.equal(r7.refund, 32100);
  // 令和8年分: 基礎控除104万円 → 課税所得177万円 → 88,500円 ×102.1% → 90,300円
  const r8 = estimate({ year: 2026, gross: 5000000, socialInsurance: 750000, withheld: 150000 });
  assert.equal(r8.deductions.basic, 1040000);
  assert.equal(r8.taxable, 1770000);
  assert.equal(r8.annualTax, 90300);
  assert.equal(r8.refund, 59700);
  assert.equal(r8.rulesLabel, '令和8年分');
  assert.equal(r8.fallback, false);
});

test('簡易年末調整: 給与所得の特例・4,000円単位・基礎控除の段階を国税庁の表どおりに求める', () => {
  const income = (gross, year) => evaluate('(g,y)=>nenchoSalaryIncome(g,nenchoRulesFor(y).rules)')(gross, year);
  assert.equal(income(700000, 2026), 0);
  assert.equal(income(2000000, 2026), 1260000);
  assert.equal(income(2192000, 2026), 1451000);
  assert.equal(income(2199999, 2026), 1456000);
  assert.equal(income(2203999, 2026), 1460000);
  assert.equal(income(1800000, 2025), 1150000);
  assert.equal(income(4001999, 2025), 2760000);
  assert.equal(income(7000000, 2026), 5200000);
  assert.equal(income(9000000, 2026), 7050000);
  const basic = (total, year) => evaluate('(t,y)=>nenchoBasicDeduction(t,nenchoRulesFor(y).rules)')(total, year);
  assert.equal(basic(4890000, 2026), 1040000);
  assert.equal(basic(4890001, 2026), 670000);
  assert.equal(basic(6550001, 2026), 620000);
  assert.equal(basic(3360001, 2025), 680000);
  assert.equal(basic(25000001, 2026), 0);
});

test('簡易年末調整: 保険料控除の上限・住宅ローン控除・未登録年の扱い', () => {
  const estimate = evaluate('estimateYearEndAdjustment');
  const r = estimate({ year: 2026, gross: 8000000, socialInsurance: 1200000, withheld: 500000, inputs: { lifeGeneral: 100000, lifeMedical: 100000, lifePension: 100000, earthquake: 60000, housingCredit: 100000, spouse: 'spouse', dependentsSpecific: 1 } });
  assert.equal(r.deductions.life, 120000);
  assert.equal(r.deductions.earthquake, 50000);
  assert.equal(r.deductions.spouse, 380000);
  assert.equal(r.deductions.dependents, 630000);
  // 給与所得 610万円（合計所得489万円超655万円以下 → 基礎控除67万円）
  // 所得控除 1,200,000+120,000+50,000+380,000+630,000+670,000 = 3,050,000 → 課税所得 305万円
  assert.equal(r.deductions.basic, 670000);
  assert.equal(r.taxable, 3050000);
  assert.equal(r.computedTax, 207500);
  // (207,500 − 住宅ローン控除100,000) × 102.1% = 109,757.5 → 100円未満切捨て 109,700円
  assert.equal(r.annualTax, 109700);
  const future = estimate({ year: 2030, gross: 5000000, socialInsurance: 750000, withheld: 0 });
  assert.equal(future.fallback, true);
  assert.equal(future.rulesLabel, '令和9年分');
});


test('指定日が土日・祝日・連休なら前営業日に入金し、指定日は保存する', () => {
  const create=evaluate('salaryTransactionFromDraft');
  for(const [payDate,actual] of [['2026-07-25','2026-07-24'],['2026-05-06','2026-05-01'],['2026-09-22','2026-09-18'],['2027-03-22','2027-03-19'],['2026-01-01','2025-12-31'],['2026-06-25','2026-06-25']]){
    const result=create({month:payDate.slice(0,7),payDate,gross:'300000',deductions:'50000',accountId:'bank'});
    assert.equal(result.transaction.startDate,actual);
    assert.equal(result.transaction.salary.payDate,payDate);
  }
});

test('休日で繰り上がった25日払いを翌月コピーしても24日払いに変わらない', () => {
  const create=evaluate('salaryTransactionFromDraft'),copy=evaluate('salaryDraftFromSource');
  const july=create({month:'2026-07',payDate:'2026-07-25',gross:'300000',deductions:'50000',accountId:'bank'}).transaction;
  assert.equal(july.startDate,'2026-07-24');
  const august=copy(july,'2026-08');assert.equal(august.payDate,'2026-08-25');
  assert.equal(create(august).transaction.startDate,'2026-08-25');
});

test('30日払いを2月へコピーした後も3月は30日に戻り、翌月払いも保つ', () => {
  const create=evaluate('salaryTransactionFromDraft'),copy=evaluate('salaryDraftFromSource');
  const jan=create({month:'2026-01',payDate:'2026-01-30',gross:'300000',deductions:'50000',accountId:'bank'}).transaction;
  const feb=create(copy(jan,'2026-02')).transaction;
  assert.equal(feb.salary.payDate,'2026-02-28');
  assert.equal(copy(feb,'2026-03').payDate,'2026-03-30');
  const delayed=create({month:'2026-12',payDate:'2027-01-25',gross:'300000',deductions:'50000',accountId:'bank'}).transaction;
  assert.equal(copy(delayed,'2027-01').payDate,'2027-02-25');
});

test('仮給与から予測を延ばし続けず、手動登録済みの月は重複作成しない', () => {
  const create=evaluate('salaryTransactionFromDraft'),auto=evaluate('autoSalaryEstimates');
  const source=create({month:'2026-07',payDate:'2026-07-25',gross:'300000',deductions:'50000',accountId:'bank'}).transaction;
  const estimate=auto([source],'2026-08-01');
  const list=Array.isArray(estimate)?estimate:estimate.transactions;
  assert.ok(list);
  const manual=create({month:'2026-08',payDate:'2026-08-25',gross:'310000',deductions:'50000',accountId:'bank'}).transaction;
  const next=auto([source,manual],'2026-08-01');
  assert.equal(next.filter(t=>t.salary.month==='2026-08').length,0);
  assert.equal(auto([source,...list],'2026-11-01').length,0);
});

test('東京五輪の特例休日は元の日と移動先を区別する', () => {
  assert.equal(evaluate('fmt(prevBizDay(parseISO("2021-07-23")))'),'2021-07-21');
  assert.equal(evaluate('fmt(prevBizDay(parseISO("2021-08-09")))'),'2021-08-06');
  assert.equal(evaluate('fmt(prevBizDay(parseISO("2021-07-19")))'),'2021-07-19');
});
