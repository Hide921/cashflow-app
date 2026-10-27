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
const day=n=>fn('fmt')(fn('addDays')(fn('todayD')(),n));

test('分析のカテゴリ別支出は返済・分類外も数え、合計が今月の支出と一致する',()=>{
  const txs=[
    {id:'a',type:'expense',category:'食費',amount:3000,startDate:today},
    {id:'b',type:'expense',category:'返済',amount:10000,startDate:today},
    {id:'c',type:'expense',category:'住居',amount:20000,startDate:today},
    {id:'e',type:'expense',category:'カード',amount:7000,startDate:today},
    {id:'d',type:'expense',amount:500,startDate:today}
  ];
  const stats=fn('buildMonthlyStats')(txs,fn('todayD')(),new Set(),true);
  assert.equal(stats.byCategory['食費'],3000);
  assert.equal(stats.byCategory['返済'],10000);
  assert.equal(stats.byCategory['その他'],20500);
  assert.equal(stats.byCategory['カード'],7000);
  assert.equal(Object.values(stats.byCategory).reduce((a,b)=>a+b,0),stats.expense);
});

test('注意ラインを下回る日を不足として扱い、対処額もラインまで戻す',()=>{
  const accounts=[{id:'a',name:'三菱UFJ'},{id:'b',name:'千葉銀'}];
  const forecast=[0,1,2,3,4].map(n=>({date:day(n),a:n>=2?20000:60000,b:200000}));
  assert.equal(fn('findShortfalls')(accounts,forecast).length,0);
  const [found]=fn('findShortfalls')(accounts,forecast,30000);
  assert.equal(found.date,day(2));
  assert.equal(found.shortage,10000);
  assert.equal(found.balance,20000);
  const plan=fn('shortfallRemedies')(found,accounts,forecast,[],today,30000);
  assert.equal(plan.needed,10000);
  assert.equal(plan.options[0].from.name,'千葉銀');
  // 振替元も注意ラインを割るなら提案しない
  const tight=forecast.map(row=>({...row,b:35000}));
  assert.equal(fn('shortfallRemedies')(found,accounts,tight,[],today,30000).options.length,0);
});

test('次の給料日までに使えるお金は、給料日前日までの最低残高からラインを引いて合計する',()=>{
  const accounts=[{id:'a',name:'三菱UFJ'},{id:'b',name:'千葉銀'}];
  const salary={id:'s',type:'income',category:'給与',label:'給与',amount:250000,accountId:'b',startDate:day(5),recurring:false,salary:{month:'2026-10',kind:'monthly'}};
  const forecast=[0,1,2,3,4,5].map(n=>({date:day(n),a:n>=3?40000:90000,b:n>=5?280000:30000}));
  const result=fn('spendableUntilPayday')(accounts,[salary],forecast,10000,today);
  assert.equal(result.payday,day(5));
  assert.equal(result.days,5);
  assert.equal(result.total,(40000-10000)+(30000-10000));
  assert.equal(result.perDay,Math.floor(50000/5));
  assert.equal(fn('spendableUntilPayday')(accounts,[],forecast,0,today),null);
});

test('カードなど毎回変わる引落で、14日以内に概算のままの回を挙げる',()=>{
  const card={id:'card',type:'expense',label:'楽天カード',amount:60000,recurring:true,frequency:'monthly',startDate:day(5),accountId:'a'};
  const rent={id:'rent',type:'expense',label:'家賃',amount:80000,recurring:true,frequency:'monthly',startDate:day(6),accountId:'a'};
  const water={id:'w',type:'expense',label:'水道',amount:5000,recurring:true,frequency:'monthly',startDate:day(-25),accountId:'a',overrides:{[day(-25)]:5200}};
  const loan={id:'l',type:'expense',label:'カードローン返済',category:'返済',amount:10000,recurring:true,frequency:'monthly',startDate:day(3),accountId:'a'};
  const bills=fn('unconfirmedVariableBills')([card,rent,water,loan],14,today);
  assert.equal(bills.map(bill=>bill.label).join(),'楽天カード,水道');
  const confirmed={...card,overrides:{[day(5)]:61000}};
  assert.equal(fn('unconfirmedVariableBills')([confirmed],14,today).length,0);
});
