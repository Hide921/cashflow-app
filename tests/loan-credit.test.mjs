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
const shift=n=>fn('fmt')(fn('addDays')(fn('todayD')(),n));

test('日割り利息は円未満を切り捨てる',()=>{
  assert.equal(fn('loanInterest')(100000,18,51),2515);
  assert.equal(fn('loanInterest')(100000,0,30),0);
  assert.equal(fn('loanInterest')(0,18,30),0);
});

test('カードの締め日・支払日から返済日を求め、休日は翌営業日にする',()=>{
  assert.equal(fn('cardPaymentDate')('2026-10-05',15,10),'2026-11-10');
  assert.equal(fn('cardPaymentDate')('2026-10-20',15,10),'2026-12-10');
  assert.equal(fn('cardPaymentDate')('2026-10-31',31,26),'2026-11-26');
  // 2027/1/10は日曜、1/11は成人の日
  assert.equal(fn('cardPaymentDate')('2026-11-20',15,10),'2027-01-12');
});

test('利用限度額を超える追加借入は止め、空き枠を返す',()=>{
  const accounts=[{id:'bank',name:'千葉銀',balance:0}];
  const loan={id:'l',name:'千葉銀行カードローン',balance:450000,creditLimit:500000};
  assert.equal(fn('loanAvailable')(loan),50000);
  assert.equal(fn('loanAvailable')({balance:1}),null);
  assert.match(fn('loanDeposit')(loan,{amount:60000,date:today,accountId:'bank',additional:true},accounts).error,/利用限度額/);
  assert.equal(fn('loanDeposit')(loan,{amount:50000,date:today,accountId:'bank',additional:true},accounts).loan.balance,500000);
});

test('キャッシングは締め日で区切って支払日にまとめ、借りた日からの利息を加える',()=>{
  const accounts=[{id:'bank',name:'千葉銀',balance:0}];
  const cashing={id:'c',name:'三井住友カード キャッシング',balance:0,creditLimit:300000,interestRate:18,repaymentMethod:'lumpSum',closingDay:15,paymentDay:10,repaymentAccountId:'bank'};
  const first=fn('loanDeposit')(cashing,{amount:100000,date:'2026-10-20',accountId:'bank',additional:true},accounts).loan;
  const second=fn('loanDeposit')(first,{amount:50000,date:'2026-11-10',accountId:'bank',additional:true},accounts).loan;
  const dues=fn('lumpSumDues')(second);
  assert.equal(dues.length,1);
  assert.equal(dues[0].date,'2026-12-10');
  assert.equal(dues[0].principal,150000);
  assert.equal(dues[0].interest,fn('loanInterest')(100000,18,51)+fn('loanInterest')(50000,18,30));
  const plan=fn('withLoanRepaymentPlans')([],[second],accounts).find(tx=>tx.loanPlan);
  assert.equal(plan.startDate,'2026-12-10');
  assert.equal(plan.amount,dues[0].amount);
  assert.equal(plan.recurring,false);
});

test('キャッシングの返済日を過ぎたら元金と利息を記録し、その借入を返済済みにする',()=>{
  const accounts=[{id:'bank',name:'千葉銀',balance:300000,balanceAsOf:shift(-20)}];
  const due=shift(-3);
  const loan={id:'c',name:'キャッシング',balance:100000,interestRate:18,repaymentMethod:'lumpSum',closingDay:15,paymentDay:10,repaymentAccountId:'bank',payments:[],
    borrowings:[{id:'b1',amount:100000,date:shift(-33),due,additional:true}]};
  const result=fn('autoLoanPayments')([loan],[],accounts,today);
  const interest=fn('loanInterest')(100000,18,30);
  assert.equal(result.records.length,1);
  assert.equal(result.loans[0].balance,0);
  assert.equal(result.loans[0].payments[0].interest,interest);
  assert.equal(result.loans[0].payments[0].amount,100000+interest);
  assert.equal(result.loans[0].borrowings[0].settled,true);
  assert.equal(result.accounts[0].balance,300000-100000-interest);
  assert.equal(fn('autoLoanPayments')(result.loans,[],result.accounts,today).records.length,0);
  assert.equal(fn('lumpSumDues')(result.loans[0]).length,0);
});

test('毎月返済は利息を先に払い、残りで元金を減らす',()=>{
  const loan={id:'l',name:'カードローン',balance:300000,interestRate:14.6,monthlyPayment:10000,payments:[{id:'p',amount:10000,paidAt:'2026-09-27'}]};
  const split=fn('splitLoanPayment')(loan,10000,'2026-10-27');
  assert.equal(split.interest,fn('loanInterest')(300000,14.6,30));
  assert.equal(split.principal,10000-split.interest);
  const plan=fn('loanPayoffPlan')(loan);
  assert.ok(plan.months>30&&plan.totalInterest>0);
  assert.match(fn('loanPayoffPlan')({...loan,monthlyPayment:3000}).error,/利息以下/);
});

test('手動で返した元金の分だけ、返済日の早い借入から返済済みにする',()=>{
  const loan={borrowings:[{id:'a',amount:30000,date:'2026-10-01',due:'2026-11-10'},{id:'b',amount:20000,date:'2026-10-20',due:'2026-12-10'}]};
  const settled=fn('settleLumpSum')(loan,30000,'pay');
  assert.equal(settled.find(item=>item.id==='a').settled,true);
  assert.equal(settled.find(item=>item.id==='b').settled,undefined);
});

test('残高不足には、余裕のある口座からの振替と、空き枠のある借入を金利の低い順に提案する',()=>{
  const accounts=[{id:'a',name:'三菱UFJ'},{id:'b',name:'千葉銀'},{id:'c',name:'SBI'}];
  const d=n=>shift(n);
  const forecast=[0,1,2,3,4,5].map(n=>({date:d(n),a:n>=3?-23400:10000,b:n>=3?80000:100000,c:5000}));
  const loans=[
    {id:'cash',name:'キャッシング',balance:0,creditLimit:300000,interestRate:18,repaymentMethod:'lumpSum',closingDay:15,paymentDay:10},
    {id:'card',name:'千葉銀行カードローン',balance:480000,creditLimit:500000,interestRate:14.6},
    {id:'full',name:'満額',balance:100000,creditLimit:100000,interestRate:10}
  ];
  const result=fn('shortfallRemedies')({account:accounts[0],date:d(3),shortage:23400},accounts,forecast,loans,today);
  assert.equal(result.needed,23400);
  const kinds=result.options.map(item=>item.type==='transfer'?`振替:${item.from.name}:${item.amount}`:`借入:${item.loan.name}:${item.amount}`);
  // SBIは残高が足りず、カードローンは空き枠2万円で3万円に届かず、満額の借入は空き枠なし
  assert.equal(kinds.join(),'振替:千葉銀:24000,借入:キャッシング:30000');
  assert.ok(result.date>=today&&result.date<d(3));
  const cheaper=[{...loans[1],balance:0}];
  assert.equal(fn('shortfallRemedies')({account:accounts[0],date:d(3),shortage:23400},[accounts[0]],forecast,[loans[0],...cheaper],today).options.map(item=>item.loan.name).join(),'千葉銀行カードローン,キャッシング');
});

test('千葉銀行の返済額表: 返済日前日の残高で返済額が決まる',()=>{
  const loan={paymentTiers:fn('CHIBABANK_CARDLOAN_TIERS')};
  const pay=balance=>fn('tieredPayment')(loan,balance);
  assert.equal(pay(50000),2000);
  assert.equal(pay(100000),2000);
  assert.equal(pay(100001),4000);
  assert.equal(pay(500000),10000);
  assert.equal(pay(500001),15000);
  assert.equal(pay(1000000),15000);
  assert.equal(pay(1000001),20000);
  assert.equal(pay(5000001),60000);
  assert.equal(pay(8000000),70000);
  assert.equal(pay(9000000),70000);
  // 利息は100円未満を切り捨てた残高で計算
  assert.equal(fn('loanInterest')(100099,14.6,30,100),fn('loanInterest')(100000,14.6,30));
});

test('残高スライドの返済予定は、残高が減ると返済額も下がり、完済の回で止まる',()=>{
  const accounts=[{id:'bank',name:'千葉銀',balance:0}];
  const loan={id:'cb',name:'千葉銀行カードローン',balance:202000,interestRate:14.8,monthlyPayment:6000,paymentTable:'chibabank',
    paymentTiers:fn('CHIBABANK_CARDLOAN_TIERS'),interestUnit:100,nextPaymentDate:shift(5),repaymentAccountId:'bank',payments:[]};
  const plan=fn('withLoanRepaymentPlans')([],[loan],accounts).find(tx=>tx.loanPlan);
  const events=fn('expandRec')(plan,fn('todayD')(),fn('addMonths')(fn('todayD')(),3),new Set());
  assert.equal(events[0].amt,-6000);
  assert.equal(events[1].amt,-4000);
  // 計算で入れた回ごとの額は保存しない
  const clean=fn('stripLoanScheduleFields')(plan);
  assert.equal(Object.keys(clean.overrides).length,0);
  // 自分で確定した回は残す
  const date=fn('fmt')(events[1].date);
  const edited=fn('stripLoanScheduleFields')({...plan,overrides:{...plan.overrides,[date]:9000}});
  assert.equal(edited.overrides[date],9000);
  // 残高が少なければ残り全額（利息込み）で終わる
  const small=fn('withLoanRepaymentPlans')([],[{...loan,balance:3000}],accounts).find(tx=>tx.loanPlan);
  const last=fn('expandRec')(small,fn('todayD')(),fn('addMonths')(fn('todayD')(),6),new Set());
  assert.equal(last.length,2);
  assert.equal(last[0].amt,-2000);
  assert.ok(-last[1].amt>1000&&-last[1].amt<1100);
});

test('残高スライドの完済見込みは返済額の変化を反映する',()=>{
  const loan={balance:300000,interestRate:14.8,paymentTiers:fn('CHIBABANK_CARDLOAN_TIERS'),interestUnit:100};
  const plan=fn('loanPayoffPlan')(loan);
  const fixed=fn('loanPayoffPlan')({...loan,paymentTiers:[],monthlyPayment:6000});
  assert.ok(plan.months>fixed.months);
  assert.ok(plan.totalInterest>fixed.totalInterest);
});

test('千葉銀行カードローンは、返済額の決め方を選んでいなくても銀行の表を使う',()=>{
  const accounts=[{id:'bank',name:'千葉銀',balance:0}];
  const old={id:'old',name:'カードローン',lender:'千葉銀行',loanType:'card',balance:320000,interestRate:14.8,monthlyPayment:10000,nextPaymentDate:shift(3),repaymentAccountId:'bank',payments:[]};
  assert.equal(fn('loanPaymentTable')(old),'chibabank');
  assert.equal(fn('tieredPayment')(old,320000),8000);
  assert.equal(fn('loanInterestUnit')(old),100);
  const plan=fn('withLoanRepaymentPlans')([],[old],accounts).find(tx=>tx.loanPlan);
  assert.equal(plan.adjustBizDay,'next');
  // 「毎月同じ額」を選んだら固定のまま
  const fixed={...old,paymentTable:'fixed'};
  assert.equal(fn('loanPaymentTable')(fixed),null);
  assert.equal(fn('tieredPayment')(fixed,320000),10000);
  // ほかの銀行やキャッシングは自動で表を使わない
  assert.equal(fn('loanPaymentTable')({...old,lender:'三井住友銀行',name:'カードローン'}),null);
  assert.equal(fn('loanPaymentTable')({...old,loanType:'cashing'}),null);
  // 次に下がる回が分かる
  const step=fn('loanNextStepDown')({...old,balance:302000},[],accounts);
  assert.equal(step.current,8000);
  assert.equal(step.amount,6000);
  assert.ok(step.date>step.firstDate);
});

test('明日以降の返済は予定として残高表に入り、日付が過ぎたら返済履歴と口座に記録する',()=>{
  const accounts=[{id:'sbi',name:'SBI',balance:200000,balanceAsOf:shift(-3)}];
  const loan={id:'p',name:'個人からの借入',loanType:'personal',balance:55000,interestRate:0,
    scheduledPayments:[{id:'s1',amount:55000,date:shift(-1),accountId:'sbi',note:''}]};
  const plans=fn('withLoanRepaymentPlans')([],[loan],accounts);
  const planned=plans.find(tx=>tx.scheduledPayment);
  assert.equal(planned.startDate,shift(-1));
  assert.equal(planned.amount,55000);
  assert.equal(planned.accountId,'sbi');
  // 予定の日付が来るまでは記録しない。定期返済の自動記録とも混ざらない。
  assert.equal(fn('settleScheduledPayments')([loan],accounts,shift(-1)).records.length,0);
  assert.equal(fn('autoLoanPayments')([loan],[],accounts,today).records.length,0);
  const settled=fn('settleScheduledPayments')([loan],accounts,today);
  assert.equal(settled.records.length,1);
  assert.equal(settled.loans[0].balance,0);
  assert.equal(settled.loans[0].scheduledPayments.length,0);
  assert.equal(settled.loans[0].payments[0].paidAt,shift(-1));
  assert.equal(settled.accounts[0].balance,145000);
  // 返済日より後に入力した残高には反映済みとみなし、口座からは引かない。
  const later=[{id:'sbi',name:'SBI',balance:145000,balanceAsOf:today}];
  const again=fn('settleScheduledPayments')([loan],later,today);
  assert.equal(again.records[0].reflected,false);
  assert.equal(again.accounts[0].balance,145000);
});
