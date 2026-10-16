import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.search(/<script>\s*const \{ useState/);
const source=html.slice(html.indexOf('>',start)+1,html.indexOf('</script>',start)).replace(/ReactDOM\.createRoot[\s\S]*$/,'');
const context={React:{createElement:()=>null},supabase:{createClient:()=>({})},window:{location:{hostname:'localhost',search:''}},URLSearchParams};
runInNewContext(source,context);
const fn=name=>runInNewContext(name,context);
const today=fn('todayStr')();
const daysAgo=n=>fn('fmt')(fn('addDays')(fn('todayD')(),-n));
const loan={id:'loan',name:'カードローン',balance:300000,monthlyPayment:10000,nextPaymentDate:daysAgo(10),repaymentAccountId:'bank',payments:[]};
const bank=asOf=>[{id:'bank',name:'千葉銀',balance:500000,balanceAsOf:asOf}];

test('過ぎた定期返済を記録し、残高入力後の回だけ口座から引く',()=>{
  const result=fn('autoLoanPayments')([loan],[],bank(daysAgo(20)),today);
  assert.equal(result.records.length,1);
  assert.equal(result.records[0].date,daysAgo(10));
  assert.equal(result.loans[0].balance,290000);
  assert.equal(result.loans[0].payments[0].coversDate,daysAgo(10));
  assert.equal(result.accounts[0].balance,490000);
  assert.equal(result.records[0].reflected,true);
  // 予測上の今日の残高は自動記録の前後で変わらない
  const before=fn('buildForecast')(bank(daysAgo(20)),fn('withLoanRepaymentPlans')([],[loan],bank(daysAgo(20))),fn('todayD')(),new Set());
  const after=fn('buildForecast')(result.accounts,fn('withLoanRepaymentPlans')([],result.loans,result.accounts),fn('todayD')(),new Set());
  assert.equal(after[0].bank,before[0].bank);
});

test('返済後に入力した残高からは引かず、借入残高だけ減らす',()=>{
  const result=fn('autoLoanPayments')([loan],[],bank(daysAgo(5)),today);
  assert.equal(result.loans[0].balance,290000);
  assert.equal(result.accounts[0].balance,500000);
  assert.equal(result.records[0].reflected,false);
});

test('もう一度実行しても、近くに手動の返済記録があっても二重に記録しない',()=>{
  const first=fn('autoLoanPayments')([loan],[],bank(daysAgo(20)),today);
  assert.equal(fn('autoLoanPayments')(first.loans,[],first.accounts,today).records.length,0);
  const manual={...loan,payments:[{id:'m',amount:10000,paidAt:daysAgo(8),note:''}]};
  assert.equal(fn('autoLoanPayments')([manual],[],bank(daysAgo(20)),today).records.length,0);
});

test('返済額は借入残高を超えない',()=>{
  const result=fn('autoLoanPayments')([{...loan,balance:4000}],[],bank(daysAgo(20)),today);
  assert.equal(result.records[0].amount,4000);
  assert.equal(result.loans[0].balance,0);
});

const september={id:'sep',type:'income',category:'給与',label:'給与（A社）',amount:250000,accountId:'bank',startDate:'2026-09-30',recurring:false,
  salary:{month:'2026-09',kind:'monthly',employer:'A社',gross:300000,socialInsurance:40000,incomeTax:7000,residentTax:3000,otherDeductions:0,deductions:50000}};

test('最新の月給と同じ内容で今月・来月の仮の月給を作る',()=>{
  const created=fn('autoSalaryEstimates')([september],'2026-10-15',[]);
  assert.equal(created.map(tx=>tx.salary.month).join(),'2026-10,2026-11');
  assert.ok(created.every(tx=>tx.salary.estimated&&tx.amount===250000&&tx.accountId==='bank'));
  assert.equal(created[0].id,'salary-auto:A社:2026-10');
  assert.equal(created[0].startDate,'2026-10-30');
  assert.equal(fn('autoSalaryEstimates')([september,...created],'2026-10-15',[]).length,0);
});

test('削除した仮の月給と、3か月以上登録のない勤務先は作らない',()=>{
  assert.equal(fn('autoSalaryEstimates')([september],'2026-10-15',['A社|2026-10']).map(tx=>tx.salary.month).join(),'2026-11');
  assert.equal(fn('autoSalaryEstimates')([{...september,salary:{...september.salary,month:'2026-06'}}],'2026-10-15',[]).length,0);
});

test('月末以外の支給日は同じ日付（休日なら前営業日）にする',()=>{
  const created=fn('autoSalaryEstimates')([{...september,startDate:'2026-09-25'}],'2026-10-15',[]);
  assert.equal(created[0].startDate,'2026-10-23');
});

test('明細で編集すると仮の印が外れる',()=>{
  const [estimate]=fn('autoSalaryEstimates')([september],'2026-10-15',[]);
  const draft={...fn('salaryDraftFromSource')(estimate,'2026-10'),gross:'310000',accountId:'bank'};
  const {transaction}=fn('salaryTransactionFromDraft')(draft,estimate);
  assert.equal(transaction.id,estimate.id);
  assert.equal(transaction.salary.estimated,undefined);
});

test('今日の予定が銀行残高に反映済みなら、入力した残高がそのまま今日の見込みになる',()=>{
  const rent={id:'rent',type:'expense',label:'家賃',amount:80000,accountId:'bank',startDate:today,recurring:false};
  const shown=includes=>fn('buildForecast')([{id:'bank',balance:100000,balanceAsOf:today,balanceIncludesAsOfDay:includes}],[rent],fn('todayD')(),new Set())[0].bank;
  assert.equal(shown(true),100000);
  assert.equal(shown(false),20000);
});

test('借りたお金を口座へ入金すると今日の見込みが増え、追加借入なら借入残高も増える',()=>{
  const accounts=[{id:'bank',name:'千葉銀',balance:100000,balanceAsOf:daysAgo(3)}];
  const card={id:'c',name:'カードローン',balance:200000,originalAmount:200000};
  const only=fn('loanDeposit')(card,{amount:'200000',date:today,accountId:'bank',additional:false},accounts);
  assert.equal(only.loan.balance,200000);
  assert.equal(only.transaction.type,'income');
  assert.equal(only.loan.borrowings[0].id,only.transaction.id);
  const shown=fn('buildForecast')(accounts,[only.transaction],fn('todayD')(),new Set())[0].bank;
  assert.equal(shown,300000);
  const more=fn('loanDeposit')(card,{amount:50000,date:today,accountId:'bank',additional:true},accounts);
  assert.equal(more.loan.balance,250000);
  assert.equal(more.loan.originalAmount,250000);
  assert.match(fn('loanDeposit')(card,{amount:0,date:today,accountId:'bank'},accounts).error,/入金額/);
  assert.match(fn('loanDeposit')(card,{amount:1,date:today,accountId:'x'},accounts).error,/口座/);
});

test('定期取引はこの回だけ金額を変えられ、ほかの月はそのまま',()=>{
  const rent={id:'rent',type:'expense',amount:80000,accountId:'bank',startDate:'2026-01-27',recurring:true,frequency:'monthly'};
  const changed=fn('setOccurrenceAmount')(rent,'2026-11-27',95000);
  const events=fn('expandRec')(changed,fn('parseISO')('2026-10-01'),fn('parseISO')('2026-12-31'),new Set());
  assert.equal(events.map(e=>e.amt).join(),'-80000,-95000,-80000');
});

test('定期取引はこの回だけ日付と金額を一緒に変えられる',()=>{
  const base=fn('addDays')(fn('todayD')(),10),from=fn('fmt')(base),to=fn('fmt')(fn('addDays')(base,3));
  const rent={id:'rent',type:'expense',amount:80000,accountId:'bank',startDate:from,recurring:true,frequency:'monthly'};
  const {transaction}=fn('editOccurrence')(rent,from,{amount:95000,toDate:to});
  const events=fn('expandRec')(transaction,base,fn('addMonths')(base,1),new Set());
  assert.equal(events.map(e=>`${fn('fmt')(e.date)}:${e.amt}`).join(),`${to}:-95000,${fn('fmt')(fn('addMonths')(base,1))}:-80000`);
  assert.match(fn('editOccurrence')(rent,from,{amount:0}).error,/金額/);
  assert.match(fn('editOccurrence')(rent,from,{amount:80000,toDate:daysAgo(1)}).error,/今日以降/);
  assert.equal(fn('editOccurrence')(rent,from,{amount:80000,toDate:from}).transaction,rent);
});
