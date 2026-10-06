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
const accounts=[{id:'bank',name:'千葉銀',balance:500000},{id:'other',name:'別口座',balance:100000}];
const loan={id:'loan',name:'カードローン',balance:300000,monthlyPayment:10000,nextPaymentDate:'2026-10-01',repaymentAccountId:'bank'};

test('既存の20万円返済は千葉銀だけを減らし、繰り返し反映しても二重に減らさない',()=>{
  const payment={id:'paid',amount:200000,paidAt:fn('todayStr')()};
  const result=fn('reflectLoanPayment')(accounts,loan,payment,'bank');
  assert.equal(result[0].balance,300000);
  assert.equal(result[1].balance,100000);
  assert.equal(accounts[0].balance,500000);
  assert.equal(fn('reflectLoanPayment')(result,loan,payment,'other'),result);
  const restored=fn('undoLoanPayment')(result,loan.id,payment.id);
  assert.equal(restored[0].balance,500000);
  assert.equal(restored[0].loanRepayments.length,0);
  assert.equal(fn('undoLoanPayment')(restored,loan.id,payment.id)[0].balance,500000);
});

test('反映済みの返済は明細に残り、予測で二度引かず同日の定期返済を置き換える',()=>{
  const date=fn('todayStr')(),payment={id:'paid',amount:200000,paidAt:date};
  const configured={...loan,nextPaymentDate:date};
  const bank=fn('reflectLoanPayment')(accounts,configured,payment,'bank');
  const txs=fn('withLoanRepaymentPlans')([],[configured],bank);
  const plan=txs.find(tx=>tx.loanPlan),actual=txs.find(tx=>tx.loanPayment);
  assert.equal(actual.amount,200000);
  assert.equal(fn('expandRec')(plan,fn('todayD')(),fn('todayD')(),new Set()).length,0);
  const rows=fn('buildForecast')(bank,txs,fn('addDays')(fn('todayD')(),1),new Set());
  assert.equal(rows[0].bank,300000);
  assert.equal(rows[1].bank,300000);
  const events=fn('buildTxList')(txs,fn('todayD')(),new Set());
  assert.equal(events.length,1);
  assert.equal(events[0].amount,200000);
  assert.ok(fn('moveScheduledTransaction')(actual,date,fn('fmt')(fn('addDays')(fn('todayD')(),1))).error);
});

test('登録済みの返済取引も実際の返済と同日は重複せず、翌月の予定は残る',()=>{
  const date=fn('todayStr')(),payment={id:'paid',amount:200000,paidAt:date};
  const existing={id:'existing',type:'expense',recurring:true,frequency:'monthly',amount:10000,accountId:'bank',startDate:date};
  const linked={...loan,repaymentTransactionId:'existing'};
  const bank=fn('reflectLoanPayment')(accounts,linked,payment,'bank');
  const txs=fn('withLoanRepaymentPlans')([existing],[linked],bank);
  const events=fn('expandRec')(txs[0],fn('todayD')(),fn('addMonths')(fn('todayD')(),1),new Set());
  assert.equal(events.length,1);
  assert.equal(fn('fmt')(events[0].date),fn('fmt')(fn('addMonths')(fn('todayD')(),1)));
});

test('返済の反映は不正な額・日付・未設定口座を拒否する',()=>{
  const reflect=fn('reflectLoanPayment'),date=fn('todayStr')();
  for(const payment of [{id:'p',amount:0,paidAt:date},{id:'p',amount:1.5,paidAt:date},{id:'p',amount:100,paidAt:'2026-02-30'},{id:'p',amount:100,paidAt:'2999-01-01'}])assert.throws(()=>reflect(accounts,loan,payment,'bank'));
  assert.throws(()=>reflect(accounts,loan,{id:'p',amount:100,paidAt:date},'deleted'));
});

test('借入の月額・次回日・口座から支出予定を作り、毎月残高を減らす',()=>{
  const today=fn('todayD')();
  const date=fn('fmt')(fn('addDays')(today,1));
  const configured={...loan,nextPaymentDate:date};
  const original=JSON.stringify(configured);
  const txs=fn('withLoanRepaymentPlans')([], [configured], accounts);
  assert.equal(txs.length,1);
  assert.equal(txs[0].accountId,'bank');
  assert.equal(txs[0].category,'返済');
  const end=fn('addMonths')(fn('parseISO')(date),2);
  const rows=fn('buildForecast')(accounts,txs,end,new Set());
  assert.equal(rows[0].bank,500000);
  assert.equal(rows.at(-1).bank,470000);
  assert.equal(rows.at(-1).other,100000);
  assert.equal(JSON.stringify(configured),original);
});

test('借入の編集は予定に即反映し、完済・借入削除で自動予定を止める',()=>{
  const build=fn('withLoanRepaymentPlans');
  const changed=build([],[{...loan,monthlyPayment:20000,repaymentAccountId:'other'}],accounts)[0];
  assert.equal(changed.amount,20000);
  assert.equal(changed.accountId,'other');
  assert.equal(build([],[{...loan,balance:0}],accounts).length,0);
  assert.equal(build([],[],accounts).length,0);
});

test('未設定・無効な日付・削除済み口座は残高を変更せず設定案内を出す',()=>{
  const build=fn('withLoanRepaymentPlans'),status=fn('loanRepaymentStatus');
  for(const item of [{...loan,repaymentAccountId:''},{...loan,repaymentAccountId:'deleted'},{...loan,nextPaymentDate:'2026-02-30'}]){
    assert.equal(build([],[item],accounts).length,0);
    assert.equal(status(item,[],accounts).ready,false);
  }
});

test('登録済み返済取引を選ぶと同じ支出予定を二重に追加しない',()=>{
  const existing={id:'existing',type:'expense',recurring:true,frequency:'monthly',amount:10000,accountId:'bank',startDate:'2026-10-01'};
  const linked={...loan,repaymentTransactionId:'existing'};
  const txs=fn('withLoanRepaymentPlans')([existing],[linked],accounts);
  assert.equal(txs.length,1);
  assert.equal(txs[0].id,'existing');
  assert.equal(txs[0].untilDate,'2029-04-01');
  assert.equal(fn('loanRepaymentStatus')(linked,[existing],accounts).ready,true);
  assert.equal(fn('loanRepaymentStatus')(linked,[],accounts).ready,false);
});

test('借入予定の確定額と日付移動を適用し、支払済みはその回だけ除外する',()=>{
  const configured={...loan,repaymentOverrides:{'2026-10-05':12000},repaymentDateMoves:{'2026-10-01':'2026-10-05'}};
  const tx=fn('withLoanRepaymentPlans')([],[configured],accounts)[0];
  const start=fn('parseISO')('2026-10-01'),end=fn('parseISO')('2026-11-30');
  const events=fn('expandRec')(tx,start,end,new Set());
  assert.deepEqual(Array.from(events,event=>[fn('fmt')(event.date),event.amt]),[['2026-10-05',-12000],['2026-11-01',-10000]]);
  const skipped=fn('expandRec')(tx,start,end,new Set([`${tx.id}_2026-10-05`]));
  assert.equal(skipped.length,1);
  assert.equal(fn('fmt')(skipped[0].date),'2026-11-01');
});

test('期日前の返済は対象の定期返済を消し込み、二重に引かない',()=>{
  const today=fn('todayD')(),due=fn('fmt')(fn('addDays')(today,3)),paidAt=fn('todayStr')();
  const configured={...loan,nextPaymentDate:due};
  const candidate=fn('nextLoanOccurrence')(configured,[configured],[],accounts,paidAt);
  assert.equal(candidate,due);
  const payment={id:'early',amount:10000,paidAt,coversDate:candidate};
  const paidLoan={...configured,balance:290000,payments:[payment]};
  const reflected=fn('reflectLoanPayment')(accounts,paidLoan,payment,'bank');
  const txs=fn('withLoanRepaymentPlans')([],[paidLoan],reflected);
  const rows=fn('buildForecast')(reflected,txs,fn('addDays')(today,10),new Set());
  assert.equal(rows.at(-1).bank,490000);
  const extra={...payment,id:'extra',coversDate:''};
  const extraTxs=fn('withLoanRepaymentPlans')([],[{...paidLoan,payments:[extra]}],accounts);
  assert.equal(fn('expandRec')(extraTxs[0],today,fn('addDays')(today,10),new Set()).length,1);
});

test('返済予定は借入残高で終わり、最終回は残額になる',()=>{
  const start=fn('fmt')(fn('addDays')(fn('todayD')(),1));
  const small={...loan,balance:25000,nextPaymentDate:start};
  const tx=fn('withLoanRepaymentPlans')([],[small],accounts)[0];
  const events=fn('expandRec')(tx,fn('todayD')(),fn('addMonths')(fn('todayD')(),12),new Set());
  assert.deepEqual(Array.from(events,event=>-event.amt),[10000,10000,5000]);
  const cleaned=fn('stripLoanScheduleFields')(tx);
  assert.equal(cleaned.untilDate,undefined);
  assert.deepEqual(Object.keys(cleaned.overrides),[]);
});
