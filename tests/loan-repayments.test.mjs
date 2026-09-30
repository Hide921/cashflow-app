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
  assert.equal(txs[0],existing);
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
