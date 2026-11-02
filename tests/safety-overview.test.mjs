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
  assert.equal(stats.byCategory['家賃'],20000);
  assert.equal(stats.byCategory['その他'],500);
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

test('カテゴリが「その他」でも、分析では名前から振り分ける',()=>{
  const txs=[
    {id:'a',type:'expense',category:'その他',label:'家賃',amount:85000,startDate:today},
    {id:'b',type:'expense',category:'その他',label:'スマホ（ahamo）',amount:3000,startDate:today},
    {id:'c',type:'expense',label:'Netflix',amount:1500,startDate:today},
    {id:'d',type:'expense',category:'食費',label:'電気屋さんでランチ',amount:1200,startDate:today},
    {id:'e',type:'expense',category:'その他',label:'謎の支払い',amount:700,startDate:today}
  ];
  const stats=fn('buildMonthlyStats')(txs,fn('todayD')(),new Set(),true);
  assert.equal(stats.byCategory['家賃'],85000);
  assert.equal(stats.byCategory['通信費'],3000);
  assert.equal(stats.byCategory['サブスク'],1500);
  assert.equal(stats.byCategory['食費'],1200);
  assert.equal(stats.byCategory['その他'],700);
  const guess=fn('guessCategory');
  assert.equal(guess('東京ガス'),'光熱費');
  assert.equal(guess('住民税'),'税金');
  assert.equal(guess('楽天カード'),'カード');
  assert.equal(guess('ＳＵＩＣＡチャージ'),'交通費');
  assert.equal(guess(''),'');
});

test('入力中の名前に合わせてカテゴリを選ぶが、自分で選んだカテゴリは変えない',()=>{
  const auto=fn('autoCategoryFor');
  assert.equal(auto({type:'expense',label:'',category:'その他'},'電気代'),'光熱費');
  assert.equal(auto({type:'expense',label:'電気代',category:'光熱費'},'水道代'),'光熱費');
  assert.equal(auto({type:'expense',label:'電気',category:'光熱費'},'スマホ'),'通信費');
  assert.equal(auto({type:'expense',label:'電気',category:'娯楽'},'スマホ'),'娯楽');
  assert.equal(auto({type:'expense',label:'',category:'その他'},'給与'),'その他');
  assert.equal(auto({type:'income',label:'',category:'その他'},'給与（A社）'),'給与');
});

test('毎月の支出は返済も含め、毎週・毎日の換算と終了済みの扱いをそろえる',()=>{
  const txs=[
    {id:'a',type:'expense',recurring:true,frequency:'monthly',amount:85000,startDate:day(-40)},
    {id:'b',type:'expense',recurring:true,frequency:'weekly',amount:1200,startDate:day(-40)},
    {id:'c',type:'expense',recurring:true,frequency:'monthly',amount:5000,startDate:day(-90),endDate:day(-1)},
    {id:'d',type:'expense',recurring:true,frequency:'monthly',amount:8000,loanPlan:true,category:'返済',startDate:day(-40)},
    {id:'e',type:'income',recurring:true,frequency:'yearly',amount:120000,startDate:day(-40)},
    {id:'f',type:'transfer',recurring:true,frequency:'monthly',amount:100000,startDate:day(-40)}
  ];
  const result=fn('recurringMonthly')(txs);
  assert.equal(result.expense,85000+5200+8000);
  assert.equal(result.repayment,8000);
  assert.equal(result.income,10000);
  assert.equal(fn('monthlyRunRate')(txs,today.slice(0,7)).exp,result.expense);
});

test('残高の入力は金額のほか、今の残高からの増減や足し引きも読める',()=>{
  const parse=fn('parseBalanceInput');
  const value=(text,current=300000)=>parse(text,current)?.value??null;
  assert.equal(value('120,000円'),120000);
  assert.equal(value('-50000'),250000);
  assert.equal(value('－５万'),250000);
  assert.equal(value('+3万'),330000);
  assert.equal(value('320000-50000+1000'),271000);
  assert.equal(value('ー2千'),298000);
  assert.equal(parse('-50000',300000).relative,true);
  assert.equal(parse('120000',300000).relative,false);
  assert.equal(value(''),null);
  assert.equal(value('abc'),null);
  assert.equal(value('--5'),null);
});

const vpassSample=[
  ',1234-56**-****-****,サンプルカード,,,,',
  '2026/9/1,セブン−イレブン,300,1,1,300,',
  '2026/9/2,スギ薬局　サンプル店,500,1,1,500,',
  '2026/9/3,ＳＢＩ証券投信積立サービス（クレジット）,10000,1,1,10000,',
  '2026/9/4,東京ガス,4000,1,1,4000,',
  '2026/9/5,VISATRANSIT3CASHBACK (JAPAN ),-100,1,1,-100,-100.00　JPY',
  ',6900-11**-****-****,ＡｐｐｌｅＰａｙ／ｉＤ,,,,',
  '2026/9/6,セブン−イレブン／ｉＤ,200,1,1,200,',
  '2026/9/7,サンプル家電,50000,ボ,,,２０２７年　１月２６日お支払い',
  ',,,,,,50000　0',
  ',,,,,14900,'
].join('\r\n');

test('VPASSの明細CSVを読み、ボーナス払いを分けて請求額を取り出す',()=>{
  const parsed=fn('parseVpassCsv')(vpassSample);
  assert.equal(parsed.items.length,6);
  assert.equal(parsed.total,14900);
  assert.equal(parsed.sum,14900);
  assert.equal(parsed.bonus.length,1);
  assert.equal(parsed.bonus[0].payDate,'2027-01-26');
  assert.equal(parsed.cards.join('|'),'サンプルカード|ApplePay/iD');
  assert.equal(fn('vpassPayMonth')('202610 (1).csv',parsed.items),'2026-10');
  assert.equal(fn('vpassPayMonth')('meisai.csv',parsed.items),'2026-10');
  const cat=store=>fn('cardCategory')(store,{});
  assert.equal(cat('セブン−イレブン／ｉＤ'),'食費');
  assert.equal(cat('スギ薬局　サンプル店'),'日用品');
  assert.equal(cat('ＳＢＩ証券投信積立サービス（クレジット）'),'集計しない');
  assert.equal(cat('東京ガス'),'光熱費');
  assert.equal(cat('ガスト'),'食費');
  assert.equal(fn('cardStoreKey')('スギ薬局　日本橋店'),'スギ薬局');
  assert.equal(fn('cardCategory')('スギ薬局　別の店',{'スギ薬局':'医療'}),'医療');
  assert.throws(()=>fn('parseVpassCsv')('a,b,c\r\n1,2,3'));
});

test('明細を取り込んだ月は、カードの引き落としを明細のカテゴリ別に置き換えて数える',()=>{
  const base=fn('todayD')();
  const month=fn('fmt')(new Date(base.getFullYear(),base.getMonth()-1,1)).slice(0,7);
  const card={id:'card',type:'expense',category:'カード',label:'三井住友カード',amount:14900,recurring:true,frequency:'monthly',startDate:`${month}-01`};
  const rent={id:'rent',type:'expense',category:'家賃',label:'家賃',amount:80000,recurring:true,frequency:'monthly',startDate:`${month}-01`};
  const prevBase=new Date(base.getFullYear(),base.getMonth()-1,1);
  const parsed=fn('parseVpassCsv')(vpassSample);
  const cardData={stores:{},statements:[{id:'s',payMonth:month,txId:'card',total:14900,items:parsed.items}]};
  const before=fn('buildMonthlyStats')([card,rent],prevBase,new Set(),false);
  assert.equal(before.byCategory['カード'],14900);
  const after=fn('buildMonthlyStats')([card,rent],prevBase,new Set(),false,cardData);
  assert.equal(after.byCategory['カード'],undefined);
  assert.equal(after.byCategory['食費'],500);
  assert.equal(after.byCategory['日用品'],500);
  assert.equal(after.byCategory['光熱費'],4000);
  assert.equal(after.byCategory['交通費'],-100);
  assert.equal(after.byCategory['家賃'],80000);
  assert.equal(after.expense,80000+4900);
  assert.equal(after.cardMonths,1);
  assert.equal(fn('guessCardPaymentTx')([rent,card]).id,'card');
});
