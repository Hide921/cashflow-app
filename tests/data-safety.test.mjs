import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.search(/<script>\s*const \{ useState/);
const source=html.slice(html.indexOf('>',start)+1,html.indexOf('</script>',start)).replace(/ReactDOM\.createRoot[\s\S]*$/,'');
function app(options={}){
  const values=new Map();
  const storage={getItem:key=>values.get(key)??null,setItem(key,value){if(options.failKey===key)throw new Error('容量不足');values.set(key,String(value));},removeItem:key=>values.delete(key)};
  const context={React:{createElement:()=>null},localStorage:storage,supabase:{createClient:()=>({from(){throw new Error('クラウドへの書込を実行してはいけません');},auth:{getSession:async()=>({data:{session:{user:{id:'other'}}}})}})},window:{location:{hostname:'localhost',search:''}},URLSearchParams};
  runInNewContext(source,context);
  return {values,context,storage,run:code=>runInNewContext(code,context)};
}
const valid=()=>({version:2,accounts:[{id:'bank',name:'銀行',balance:1000}],transactions:[{id:'tx',label:'食費',type:'expense',amount:500,startDate:'2026-10-01',accountId:'bank'}],loans:[],budgets:{食費:10000},skipped:[],preferences:{autoSalary:false}});

test('バックアップの不正なID・金額・日付・借入を復元前に拒否する',()=>{
  const a=app(),validate=a.run('validateBackup');
  for(const mutate of [v=>v.accounts.push(v.accounts[0]),v=>v.accounts[0].balance=Infinity,v=>v.transactions[0].startDate='2026-02-30',v=>v.transactions[0].amount=-1,v=>v.loans={},v=>v.preferences.salaryAutoDismissed='不正',v=>v.transactions[0].overrides={'不正':100}]){
    const data=valid();mutate(data);assert.throws(()=>validate(data),/バックアップを復元できません/);
  }
  assert.equal(validate(valid()).transactions[0].amount,500);
  assert.equal(a.values.size,0);
});

test('返済履歴と給与を含むバックアップを元の値のまま受け付ける',()=>{
  const a=app(),data=valid();
  data.accounts[0].loanRepayments=[{id:'payment',loanId:'loan',paymentId:'p',paidAt:'2026-09-25',amount:100}];
  data.loans=[{id:'loan',name:'借入',balance:900,interestRate:14.5,payments:[{id:'p',paidAt:'2026-09-25',amount:100}],borrowings:[{id:'b',date:'2026-09-01',amount:1000,accountId:'bank'}]}];
  data.transactions.push({id:'salary',label:'給与',type:'income',amount:240000,startDate:'2026-07-24',accountId:'bank',salary:{month:'2026-07',kind:'monthly',payDate:'2026-07-25',gross:300000,deductions:60000}});
  const original=JSON.stringify(data),restored=a.run('validateBackup')(data);
  assert.equal(JSON.stringify(data),original);
  assert.equal(restored.accounts[0].loanRepayments[0].id,'payment');
  assert.equal(restored.transactions[1].salary.payDate,'2026-07-25');
});

test('復元前の控えと一括した未同期データを保存する',()=>{
  const a=app();a.values.set('cf_pending_v1',JSON.stringify({sp_stocks:[{id:'stock'}]}));
  const current=valid(),next=valid();next.accounts[0].balance=999;
  a.run('stageBackupRestore')(next,current);
  assert.equal(JSON.parse(a.values.get('cf_before_restore_v1')).accounts[0].balance,1000);
  const pending=JSON.parse(a.values.get('cf_pending_v1'));
  assert.equal(pending.accounts[0].balance,999);assert.equal(pending.sp_stocks[0].id,'stock');
});

test('復元前の保存に失敗したら未同期データを置換しない',()=>{
  const a=app({failKey:'cf_before_restore_v1'});a.values.set('cf_pending_v1','{"transactions":[]}');
  assert.throws(()=>a.run('stageBackupRestore')(valid(),valid()),/控え/);
  assert.equal(a.values.get('cf_pending_v1'),'{"transactions":[]}');
});

test('CSVの壊れた引用符・未知の種別・曖昧な口座は登録しない',()=>{
  const a=app(),parse=a.run('transactionsFromCsv');
  const header='名前,種別,口座,金額,開始日\n',accounts=[{id:'a',name:'銀行'}];
  assert.throws(()=>parse(header+'"未完了,支出,銀行,500,2026-10-01',accounts),/引用符/);
  assert.throws(()=>parse('名前,金額\n食費,500',accounts),/必要な列/);
  assert.equal(parse(header+'食費,不明,銀行,500,2026-10-01',accounts).skipped,1);
  assert.equal(parse(header+'食費,支出,銀行,500,2026-10-01',[...accounts,{id:'b',name:'銀行'}]).skipped,1);
  assert.equal(parse(header+'食費,支出,銀行,500,',accounts).skipped,1);
  assert.equal(parse(header+'"食費,昼",支出,銀行,500,2026-10-01',accounts).items[0].label,'食費,昼');
});

test('比較元が未取得のクラウド保存は上書きせずに止める',async()=>{
  const a=app();await assert.rejects(a.run('_sbSet("accounts",[])'),error=>error.conflict===true);
});

test('別アカウントへ認証が変わったら保存を拒否する',async()=>{
  const a=app();a.run('accountStorage={userId:"original"}');
  await assert.rejects(a.run('_sbSet("sp_stocks",[])'),/ログイン状態が変わりました/);
});

const storageSource=readFileSync(new URL('../account-storage.js',import.meta.url),'utf8');
function userStore(){const a=app();const context={localStorage:a.storage};runInNewContext(storageSource,context);return {...a,service:context.CashflowStorage};}

test('口座・未同期編集・投資明細はユーザーごとに分離し、再ログイン後も保持する',()=>{
  const a=userStore(),alice=a.service.activate('alice');
  alice.setItem('cf_pending_v1','{"accounts":[{"id":"a"}]}');alice.setItem('stocks','[{"id":"holding"}]');alice.setItem('cf_dark','1');
  const bob=a.service.activate('bob');
  assert.equal(bob.getItem('cf_pending_v1'),null);assert.equal(bob.getItem('stocks'),null);assert.equal(bob.getItem('cf_dark'),'1');
  bob.setItem('stocks','[]');
  assert.equal(a.service.activate('alice').getItem('stocks'),'[{"id":"holding"}]');
  // 古い非同期コールバックの保存先も、最初のユーザーのまま固定される。
  alice.setItem('cf_skipped','["a"]');assert.equal(bob.getItem('cf_skipped'),null);
});

test('所有者不明の旧データは確認前に読まず、明示したアカウントだけに移行する',()=>{
  const a=userStore();a.storage.setItem('cf_pending_v1','{"transactions":[]}');a.storage.setItem('stocks','[{"id":"old"}]');
  assert.equal(a.service.needsLegacyChoice('alice'),true);
  assert.equal(a.service.activate('alice').getItem('stocks'),null);
  a.service.resolveLegacy('alice',true);
  assert.equal(a.service.scope('alice').getItem('stocks'),'[{"id":"old"}]');
  assert.equal(a.service.scope('bob').getItem('stocks'),null);
  assert.equal(a.service.needsLegacyChoice('bob'),false);
  assert.equal(a.storage.getItem('stocks'),'[{"id":"old"}]');
});

test('旧データを使わずクラウドで始めても控えは残る',()=>{
  const a=userStore();a.storage.setItem('stocks','[{"id":"old"}]');a.service.resolveLegacy('bob',false);
  assert.equal(a.service.scope('bob').getItem('stocks'),null);
  assert.equal(a.service.legacySnapshot().stocks,'[{"id":"old"}]');
});
