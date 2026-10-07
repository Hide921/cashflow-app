import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.search(/<script>\s*const \{ useState/);
const end = html.indexOf('</script>', start);
assert.ok(start >= 0 && end > start);
const source = html.slice(html.indexOf('>', start) + 1, end)
  .replace(/ReactDOM\.createRoot[\s\S]*$/, '');

function appContext(cloud = {}, storage = new Map(), options = {}) {
  const state = [];
  const refs = [];
  const effects = [];
  let stateCursor = 0;
  let refCursor = 0;
  const h = (type, props, ...children) => ({ type, props: { ...props, children } });
  const React = {
    useState(initial) {
      const index = stateCursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useEffect(effect) { effects.push(effect); },
    useMemo(calculate) { return calculate(); },
    useRef(initial) {
      const index = refCursor++;
      return refs[index] ??= { current: initial };
    },
    createElement: h,
    cloneElement(node, props) { return { ...node, props: { ...node.props, ...props } }; },
  };
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => { if (options.failLocalSet || (options.failCacheSet && key === 'cf_cache_v2:legacy')) throw new Error('保存領域が利用できません'); storage.set(key, String(value)); },
  };
  const listeners = new Map();
  const stamps = options.stamps || {};
  let tick = 0;
  const nextStamp = () => `2026-01-01T00:00:00.${String(++tick).padStart(3, '0')}+00:00`;
  const rowOf = key => ({ key, value: cloud[key], updated_at: stamps[key] ??= nextStamp() });
  const query = (op, row) => {
    const filters = [];
    const run = async () => {
      const keys = Object.keys(cloud).filter(key => filters.every(f => f(key)));
      if (op === 'select') return { data: keys.map(rowOf), error: null };
      if (op === 'insert') {
        if (row.key in cloud) return { data: null, error: { code: '23505', message: 'duplicate' } };
        cloud[row.key] = row.value; stamps[row.key] = nextStamp(); return { data: [rowOf(row.key)], error: null };
      }
      if (op === 'upsert') { cloud[row.key] = row.value; stamps[row.key] = nextStamp(); return { data: [rowOf(row.key)], error: null }; }
      keys.forEach(key => { cloud[key] = row.value; stamps[key] = nextStamp(); });
      return { data: keys.map(rowOf), error: null };
    };
    const builder = {
      select: () => builder,
      eq: (field, value) => { filters.push(key => (field === 'key' ? key : rowOf(key).updated_at) === value); return builder; },
      in: (_field, values) => { filters.push(key => values.includes(key)); return builder; },
      maybeSingle: async () => { const { data, error } = await run(); return { data: data[0] || null, error }; },
      then: (resolve, reject) => run().then(resolve, reject),
    };
    return builder;
  };
  const supabase = {
    createClient: () => ({
      from: () => ({
        select: () => query('select'),
        insert: row => query('insert', row),
        update: row => query('update', row),
        upsert: row => query('upsert', row),
      }),
    }),
  };
  const window = {
    location: { hostname: 'localhost', search: '' },
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name),
  };
  const document = { visibilityState: 'visible', addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: name => listeners.delete(name) };
  const context = { React, supabase, localStorage, window, document, navigator: { onLine: true }, setTimeout, URLSearchParams, console };
  runInNewContext(source, context);
  return {
    cloud, storage, state, effects, context, listeners,
    resetHooks() { stateCursor = 0; refCursor = 0; effects.length = 0; },
    evaluate(code) { return runInNewContext(code, context); },
  };
}

function findNode(node, name) {
  if (Array.isArray(node)) return node.map(child => findNode(child, name)).find(Boolean);
  if (!node || typeof node !== 'object') return null;
  if (node.type?.name === name) return node;
  return findNode(node.props?.children, name);
}

function findElement(node, predicate) {
  if (Array.isArray(node)) return node.map(child => findElement(child, predicate)).find(Boolean);
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  return findElement(node.props?.children, predicate);
}

test('未同期の削除は再読込時にクラウドの古い取引で復活しない', async () => {
  const old = { id: 'old', label: '古い取引', type: 'expense', amount: 100, startDate: '2026-09-27' };
  const cloud = { accounts: [], transactions: [old], skipped: [] };
  const first = appContext(cloud);
  first.evaluate('App()');
  first.effects[0]();
  await new Promise(resolve => setTimeout(resolve, 20));
  first.resetHooks();
  const dashboard = findNode(first.evaluate('App()'), 'Dashboard');
  assert.ok(dashboard);
  first.context.navigator.onLine = false;
  dashboard.props.onDeleteTx('old');
  assert.equal(cloud.transactions.length, 1);
  assert.deepEqual(JSON.parse(first.storage.get('cf_pending_v1')).transactions, []);

  const second = appContext(cloud, first.storage);
  second.evaluate('App()');
  second.effects[0]();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(Array.from(second.state[1]), []);
  assert.deepEqual(Array.from(cloud.transactions), []);
  assert.deepEqual(JSON.parse(first.storage.get('cf_pending_v1')), {});
});

test('オフラインで移動した定期予定は再読込後も残り、クラウドへ保存される', async () => {
  const old = { id: 'rent', label: '家賃', type: 'expense', amount: 100, accountId: 'bank', recurring: true, frequency: 'monthly', startDate: '2026-10-01', overrides: { '2026-10-01': 150 } };
  const cloud = { accounts: [], transactions: [old], skipped: [] };
  const first = appContext(cloud);
  first.evaluate('App()'); first.effects[0]();
  await new Promise(resolve => setTimeout(resolve, 20));
  first.resetHooks();
  const dashboard = findNode(first.evaluate('App()'), 'Dashboard');
  first.context.navigator.onLine = false;
  const moved = first.evaluate('moveScheduledTransaction') (old,'2026-10-01','2026-10-05','2026-09-30').transaction;
  dashboard.props.onUpdTx(moved);
  assert.equal(cloud.transactions[0].dateMoves, undefined);
  const second = appContext(cloud, first.storage);
  second.evaluate('App()'); second.effects[0]();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(second.state[1][0].dateMoves['2026-10-01'], '2026-10-05');
  assert.equal(cloud.transactions[0].dateMoves['2026-10-01'], '2026-10-05');
  assert.equal(cloud.transactions[0].overrides['2026-10-05'], 150);
});

test('借入の返済予定変更は借入データへ保存され、再読込で残高表へ戻る', async () => {
  const loan={id:'loan',name:'カードローン',balance:300000,monthlyPayment:10000,nextPaymentDate:'2026-10-01',repaymentAccountId:'bank'};
  const cloud={accounts:[{id:'bank',name:'千葉銀',balance:500000}],transactions:[],loans:[loan],skipped:[]};
  const first=appContext(cloud);
  first.evaluate('App()');first.effects[0]();
  await new Promise(resolve=>setTimeout(resolve,20));
  first.resetHooks();
  const dashboard=findNode(first.evaluate('App()'),'Dashboard');
  const plan=dashboard.props.txs.find(tx=>tx.loanPlan);
  assert.ok(plan);
  first.context.navigator.onLine=false;
  dashboard.props.onUpdTx({...plan,overrides:{'2026-10-05':12000},dateMoves:{'2026-10-01':'2026-10-05'}});
  assert.equal(cloud.loans[0].repaymentDateMoves,undefined);
  const second=appContext(cloud,first.storage);
  second.evaluate('App()');second.effects[0]();
  await new Promise(resolve=>setTimeout(resolve,20));
  second.resetHooks();
  const restored=findNode(second.evaluate('App()'),'Dashboard').props.txs.find(tx=>tx.loanPlan);
  assert.equal(restored.dateMoves['2026-10-01'],'2026-10-05');
  assert.equal(restored.overrides['2026-10-05'],12000);
  assert.equal(cloud.transactions.length,0);
  assert.equal(cloud.loans[0].repaymentDateMoves['2026-10-01'],'2026-10-05');
});

test('既存の返済反映は口座と反映印を一緒に保存し、再読込後も二重に減らさない',async()=>{
  const app=appContext();
  const date=app.evaluate('todayStr()');
  const cloud={accounts:[{id:'bank',name:'千葉銀',balance:500000}],transactions:[],loans:[{id:'loan',name:'千葉銀カードローン',balance:300000,payments:[{id:'p',amount:200000,paidAt:date}]}]};
  const first=appContext(cloud);
  first.evaluate('App()');first.effects[0]();await new Promise(resolve=>setTimeout(resolve,20));
  first.resetHooks();findNode(first.evaluate('App()'),'Dashboard').props.onNavigate('loans');
  first.resetHooks();const manager=findNode(first.evaluate('App()'),'LoanManager');
  first.context.navigator.onLine=false;
  manager.props.onReflectPayment('loan','p','bank');manager.props.onReflectPayment('loan','p','bank');
  const pending=JSON.parse(first.storage.get('cf_pending_v1')).accounts;
  assert.equal(pending[0].balance,300000);
  assert.equal(pending[0].loanRepayments.length,1);
  assert.equal(cloud.loans[0].balance,300000);
  const second=appContext(cloud,first.storage);second.evaluate('App()');second.effects[0]();await new Promise(resolve=>setTimeout(resolve,20));
  second.resetHooks();const dashboard=findNode(second.evaluate('App()'),'Dashboard');
  assert.equal(dashboard.props.accounts[0].balance,300000);
  assert.equal(dashboard.props.txs.filter(tx=>tx.loanPayment).length,1);
  assert.equal(cloud.accounts[0].balance,300000);
  dashboard.props.onNavigate('loans');second.resetHooks();
  const restored=findNode(second.evaluate('App()'),'LoanManager');
  restored.props.onReflectPayment('loan','p','bank');
  const newPayment={id:'new',amount:10000,paidAt:date,note:''};
  restored.props.onChange(current=>current.map(loan=>({...loan,balance:loan.balance-10000,payments:[...loan.payments,newPayment]})));
  restored.props.onReflectPayment('loan','new','bank');
  second.resetHooks();
  const newManager=findNode(second.evaluate('App()'),'LoanManager');
  assert.equal(newManager.props.accounts[0].balance,290000);
  assert.equal(newManager.props.loans[0].balance,290000);
  restored.props.onUndoPayment('loan','new');
  restored.props.onUndoPayment('loan','p');
  second.resetHooks();assert.equal(findNode(second.evaluate('App()'),'LoanManager').props.accounts[0].balance,500000);
});

test('保存中に次の編集が入ったら、古い保存では未同期印を消さない', () => {
  const app = appContext();
  app.evaluate('markPending("transactions", [{id:"first"}])');
  app.evaluate('markPending("transactions", [{id:"second"}])');
  app.evaluate('clearPendingIfCurrent("transactions", [{id:"first"}])');
  assert.equal(JSON.parse(app.storage.get('cf_pending_v1')).transactions[0].id, 'second');
  app.evaluate('clearPendingIfCurrent("transactions", [{id:"second"}])');
  assert.deepEqual(JSON.parse(app.storage.get('cf_pending_v1')), {});
});

test('支払済みの単発取引は直近予定から消える', () => {
  const app = appContext();
  const date = app.evaluate('todayStr()');
  const tx = { id: 'single', label: '家賃', type: 'expense', amount: 100, recurring: false, startDate: date };
  app.context.testTx = tx;
  app.context.testDate = date;
  assert.equal(app.evaluate('UpcomingPayments({txs:[testTx],accounts:[],skippedKeys:new Set([`single_${testDate}`])})'), null);
  assert.notEqual(app.evaluate('UpcomingPayments({txs:[testTx],accounts:[],skippedKeys:new Set()})'), null);
});

test('取引管理からの削除は共通の削除処理を呼ぶ', () => {
  const app = appContext();
  const tx = { id: 'target', label: '家賃', type: 'expense', amount: 100, startDate: '2026-09-27' };
  app.state[6] = tx;
  app.context.testTx = tx;
  let deleted;
  app.context.onDelete = id => { deleted = id; };
  app.context.onChange = () => { throw new Error('共通削除処理を迂回した'); };
  const tree = app.evaluate('TxManager({accounts:[],txs:[testTx],onChange,onDelete,addToast:()=>{}})');
  const confirm = tree.props.children.find(child => child?.type?.name === 'ConfirmDialog');
  assert.ok(confirm);
  confirm.props.onConfirm();
  assert.equal(deleted, 'target');
});

test('空欄や存在しない日付を拒否する', () => {
  const app = appContext();
  assert.equal(app.evaluate('validTxDate("2026-09-27")'), true);
  assert.equal(app.evaluate('validTxDate("")'), false);
  assert.equal(app.evaluate('validTxDate("2026-02-30")'), false);
});

test('残高編集では空欄を保存できず、0円は保存できる', () => {
  const app = appContext();
  const account = { id: 'account', name: 'テスト口座', balance: 1000, color: '#6366f1' };
  let updated;
  app.context.testAccount = account;
  app.context.onUpdAcc = item => { updated = item; };
  const render = () => {
    app.resetHooks();
    return app.evaluate('Dashboard({accounts:[testAccount],txs:[],loans:[],dark:false,onAddTx:null,onUpdAcc,onUpdTx:null,onNavigate:null,skippedOccurrences:[],onSkip:null,onRestore:null,onDeleteTx:null,investmentData:null})');
  };
  const edit = findElement(render(), node => node.type === 'button' && node.props.children.includes('残高を編集'));
  assert.ok(edit);
  edit.props.onClick();
  const input = findElement(render(), node => node.type === 'input' && node.props['aria-label'] === 'テスト口座の現在残高');
  assert.ok(input);
  input.props.onChange({ target: { value: '' } });
  const saveEmpty = findElement(render(), node => node.type === 'button' && node.props.children.includes('保存'));
  assert.equal(saveEmpty.props.disabled, true);
  saveEmpty.props.onClick();
  assert.equal(updated, undefined);
  findElement(render(), node => node.type === 'input' && node.props['aria-label'] === 'テスト口座の現在残高').props.onChange({ target: { value: '0' } });
  const saveZero = findElement(render(), node => node.type === 'button' && node.props.children.includes('保存'));
  assert.equal(saveZero.props.disabled, false);
  saveZero.props.onClick();
  assert.equal(updated.balance, 0);
});

test('口座残高を続けて更新しても先の変更を消さない', async () => {
  const accounts = [
    { id: 'a', name: '銀行A', balance: 100, balanceAsOf: '2026-01-01' },
    { id: 'b', name: '銀行B', balance: 200, balanceAsOf: '2026-01-01' },
  ];
  const app = appContext({ accounts, transactions: [], loans: [], budgets: {}, skipped: [], preferences: {} });
  app.evaluate('App()');
  app.effects[0]();
  await new Promise(resolve => setTimeout(resolve, 20));
  app.resetHooks();
  const dashboard = findNode(app.evaluate('App()'), 'Dashboard');
  assert.ok(dashboard);
  dashboard.props.onUpdAcc({ ...accounts[0], balance: 110 });
  dashboard.props.onUpdAcc({ ...accounts[1], balance: 220 });
  assert.deepEqual(Array.from(app.state[0], account => account.balance), [110, 220]);
});

test('同じ残高を保存しても残高基準日を変更しない', () => {
  const app = appContext();
  const account = { id: 'a', name: '銀行A', balance: 100, balanceAsOf: '2026-01-01' };
  app.context.testAccount = account;
  let updated;
  app.context.onUpdAcc = item => { updated = item; };
  const render = () => {
    app.resetHooks();
    return app.evaluate('Dashboard({accounts:[testAccount],txs:[],loans:[],dark:false,onUpdAcc,onUpdTx:null,onNavigate:null,skippedOccurrences:[],onSkip:null,onRestore:null,onDeleteTx:null,investmentData:null})');
  };
  findElement(render(), node => node.type === 'button' && node.props.children.includes('残高を編集')).props.onClick();
  findElement(render(), node => node.type === 'button' && node.props.children.includes('保存')).props.onClick();
  assert.equal(updated, undefined);
});

test('今日の未反映予定は残高編集後の予測に入り、支払済みなら入らない', () => {
  const app = appContext();
  const date = app.evaluate('todayStr()');
  app.context.testAccount = { id: 'a', name: '銀行A', balance: 1000, balanceAsOf: date };
  app.context.testTx = { id: 'today-expense', label: 'クレカ', type: 'expense', amount: 100, recurring: false, accountId: 'a', startDate: date };
  const pending = app.evaluate('buildForecast([testAccount],[testTx],todayD(),new Set())');
  assert.equal(pending[0].a, 900);
  app.context.testSkipped = new Set([`today-expense_${date}`]);
  const paid = app.evaluate('buildForecast([testAccount],[testTx],todayD(),testSkipped)');
  assert.equal(paid[0].a, 1000);
});

test('定期取引の確定額はその回だけ予測に反映され、概算にも戻せる', () => {
  const app = appContext();
  const date = app.evaluate('todayStr()');
  const nextDate = app.evaluate('fmt(addMonths(todayD(),1))');
  const tx = { id: 'card', label: 'クレカ引落', type: 'expense', amount: 50000, recurring: true, frequency: 'monthly', startDate: date, overrides: {} };
  app.context.testTx = tx;
  app.context.testDate = date;
  const confirmed = app.evaluate('setOccurrenceAmount(testTx,testDate,37240)');
  assert.equal(confirmed.amount, 50000);
  assert.equal(confirmed.overrides[date], 37240);
  app.context.confirmedTx = confirmed;
  const events = app.evaluate('expandRec(confirmedTx,todayD(),addMonths(todayD(),1),new Set()).map(event=>({date:fmt(event.date),amt:event.amt}))');
  assert.equal(events[0].amt, -37240);
  assert.equal(events.find(event => event.date === nextDate)?.amt, -50000);
  const restored = app.evaluate('setOccurrenceAmount(confirmedTx,testDate,null)');
  assert.equal(restored.overrides[date], undefined);
  assert.equal(tx.overrides[date], undefined);
});

test('直近予定から定期取引の金額確定を開始できる', () => {
  const app = appContext();
  const date = app.evaluate('todayStr()');
  const tx = { id: 'card', label: 'クレカ引落', type: 'expense', amount: 50000, recurring: true, frequency: 'monthly', startDate: date, overrides: {} };
  app.context.testTx = tx;
  const render = () => { app.resetHooks(); return app.evaluate('UpcomingPayments({txs:[testTx],accounts:[],skippedKeys:new Set(),onUpdTx:()=>{}})'); };
  const button = findElement(render(), node => node.type === 'button' && node.props.children.includes('金額確定'));
  assert.ok(button);
  button.props.onClick();
  const dialog = findNode(render(), 'ConfirmAmountDialog');
  assert.ok(dialog);
  assert.equal(dialog.props.date, date);
});

test('過去の月を指定して定期取引の発生日を取得できる', () => {
  const app = appContext();
  app.context.testTx = { id: 'card', label: 'クレカ', type: 'expense', amount: 50000, recurring: true, frequency: 'monthly', startDate: '2024-01-15' };
  const dates = app.evaluate('occurrencesInMonth(testTx,"2025-02")');
  assert.deepEqual(Array.from(dates), ['2025-02-15']);
  assert.deepEqual(Array.from(app.evaluate('occurrencesInMonth(testTx,"2023-12")')), []);
});

test('過去の取引明細には概算ではなく確定額が表示される', () => {
  const app = appContext();
  const date = app.evaluate('fmt(addMonths(todayD(),-1))');
  app.context.testDate = date;
  app.context.testTx = { id: 'card', label: 'クレカ', type: 'expense', amount: 50000, recurring: true, frequency: 'monthly', startDate: date, overrides: { [date]: 37240 } };
  const list = app.evaluate('buildPastTxList([testTx],addMonths(todayD(),-2),new Set())');
  assert.equal(list.find(item => item.date === date)?.amount, 37240);
});

test('翌月初の予定が前営業日に移ると前月の予測に含まれる', () => {
  const app = appContext();
  app.context.testTx = { id: 'rent', type: 'expense', amount: 100, recurring: true, frequency: 'monthly', startDate: '2026-01-01', adjustBizDay: 'prev' };
  const dates = app.evaluate('expandRec(testTx,parseISO("2026-10-01"),parseISO("2026-10-31"),new Set()).map(e=>fmt(e.date))');
  assert.deepEqual(Array.from(dates), ['2026-10-01', '2026-10-30']);
});

test('次営業日に移った予定を前月の予測へ混ぜない', () => {
  const app = appContext();
  app.context.testTx = { id: 'card', type: 'expense', amount: 100, recurring: true, frequency: 'monthly', startDate: '2026-01-31', adjustBizDay: 'next' };
  const dates = app.evaluate('expandRec(testTx,parseISO("2026-10-01"),parseISO("2026-10-31"),new Set()).map(e=>fmt(e.date))');
  assert.deepEqual(Array.from(dates), []);
});

test('数年以上前に開始した毎日の定期取引も現在の期間へ展開する', () => {
  const app = appContext();
  app.context.testTx = { id: 'daily', type: 'income', amount: 100, recurring: true, frequency: 'daily', startDate: '2020-01-01' };
  const dates = app.evaluate('expandRec(testTx,parseISO("2026-09-28"),parseISO("2026-09-30"),new Set()).map(e=>fmt(e.date))');
  assert.deepEqual(Array.from(dates), ['2026-09-28', '2026-09-29', '2026-09-30']);
});
test('オフラインの投資銘柄編集は再読込後も残り、オンライン復帰時に同期される', async () => {
  const oldStock = { id: 'old', ticker: 'OLD' };
  const newStock = { id: 'new', ticker: 'NEW' };
  const cloud = { accounts: [], transactions: [], loans: [], budgets: {}, skipped: [], preferences: {}, sp_stocks: [oldStock] };
  const first = appContext(cloud);
  first.context.navigator.onLine = false;
  first.evaluate('App()');
  first.effects[0]();
  await new Promise(resolve => setTimeout(resolve, 20));
  first.state[10] = 'investments';
  first.resetHooks();
  const hub = findNode(first.evaluate('App()'), 'InvestmentHub');
  assert.ok(hub);
  hub.props.onStocksChange([newStock], '銘柄を更新しました');
  assert.equal(cloud.sp_stocks[0].id, 'old');
  assert.equal(JSON.parse(first.storage.get('cf_pending_v1')).sp_stocks[0].id, 'new');

  const second = appContext(cloud, first.storage);
  second.context.navigator.onLine = false;
  second.evaluate('App()');
  second.effects[0]();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(second.state[6].stocks[0].id, 'new');
  second.effects[2]();
  second.context.navigator.onLine = true;
  second.listeners.get('online')();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(cloud.sp_stocks[0].id, 'new');
  assert.deepEqual(JSON.parse(second.storage.get('cf_pending_v1')), {});
});

test('端末保存が失敗しても警告し、オンライン復帰時にメモリ内の変更を同期する', async () => {
  const cloud = { accounts: [], transactions: [], loans: [], budgets: {}, skipped: [], preferences: {} };
  const app = appContext(cloud, new Map(), { failLocalSet: true });
  app.evaluate('App()');
  app.effects[0]();
  await new Promise(resolve => setTimeout(resolve, 20));
  app.resetHooks();
  const dashboard = findNode(app.evaluate('App()'), 'Dashboard');
  app.context.navigator.onLine = false;
  dashboard.props.onAddTx({ id: 'offline', label: '予定', type: 'expense', amount: 100 });
  assert.equal(cloud.transactions.length, 0);
  app.resetHooks();
  assert.ok(findElement(app.evaluate('App()'), node => node.props?.role === 'alert'));
  app.effects[2]();
  app.context.navigator.onLine = true;
  app.listeners.get('online')();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(cloud.transactions[0].id, 'offline');
});

test('端末キャッシュだけが失敗したら、クラウド保存後も再読込用の変更を保持する', async () => {
  const cloud = { accounts: [], transactions: [], loans: [], budgets: {}, skipped: [], preferences: {} };
  const app = appContext(cloud, new Map(), { failCacheSet: true });
  app.evaluate('App()');
  app.effects[0]();
  await new Promise(resolve => setTimeout(resolve, 20));
  app.resetHooks();
  findNode(app.evaluate('App()'), 'Dashboard').props.onAddTx({ id: 'cached', label: '予定' });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(cloud.transactions[0].id, 'cached');
  assert.equal(JSON.parse(app.storage.get('cf_pending_v1')).transactions[0].id, 'cached');
  app.resetHooks();
  assert.ok(findElement(app.evaluate('App()'), node => node.props?.role === 'alert'));
});

test('同じ描画中の取引と借入の連続更新を両方残す', async () => {
  const cloud = { accounts: [], transactions: [], loans: [], budgets: {}, skipped: [], preferences: {} };
  const app = appContext(cloud);
  app.evaluate('App()');
  app.effects[0]();
  await new Promise(resolve => setTimeout(resolve, 20));
  app.resetHooks();
  const dashboard = findNode(app.evaluate('App()'), 'Dashboard');
  dashboard.props.onAddTx({ id: 'one' });
  dashboard.props.onAddTx({ id: 'two' });
  assert.deepEqual(Array.from(app.state[1], tx => tx.id), ['one', 'two']);
  app.resetHooks();
  findNode(app.evaluate('App()'), 'AppNavigation').props.onChange('loans');
  app.resetHooks();
  const manager = findNode(app.evaluate('App()'), 'LoanManager');
  manager.props.onChange(current => [...current, { id: 'loan-one' }]);
  manager.props.onChange(current => [...current, { id: 'loan-two' }]);
  assert.deepEqual(Array.from(app.state[2], loan => loan.id), ['loan-one', 'loan-two']);
});

test('給与モードは専用ナビから直接開け、選択状態になる', async () => {
  const app = appContext({ accounts: [], transactions: [], loans: [], budgets: {}, skipped: [], preferences: {} });
  app.evaluate('App()');
  app.effects[0]();
  await new Promise(resolve => setTimeout(resolve, 20));
  app.resetHooks();
  const navigation = findNode(app.evaluate('App()'), 'AppNavigation');
  navigation.props.onChange('salary');
  app.resetHooks();
  const salaryPage = app.evaluate('App()');
  assert.ok(findNode(salaryPage, 'SalaryManager'));
  assert.ok(!findNode(salaryPage, 'TxManager'));
  const activeNavigation = findNode(salaryPage, 'AppNavigation');
  assert.equal(activeNavigation.props.active, 'salary');
  const navTree = app.evaluate('AppNavigation')(activeNavigation.props);
  const activeButton = findElement(navTree, node => node.type === 'button' && node.props?.['aria-current'] === 'page');
  assert.ok(activeButton.props.children.some(child => child.type === 'span' && child.props.children.includes('給与')));
  activeNavigation.props.onChange('home');
  app.resetHooks();
  assert.ok(findNode(app.evaluate('App()'), 'Dashboard'));
});

test('概要は為替未取得時に仮の150円で米国株を評価しない', () => {
  const app = appContext();
  const stock = { id: 'us', ticker: 'AAPL', market: 'US', tradeType: 'spot', currency: 'USD', quantity: 10, avgPrice: 100, currentPrice: 120 };
  app.context.testStock = stock;
  const view = app.evaluate('InvestmentView({data:{stocks:[testStock],log:[],collateral:[]}})');
  assert.ok(findElement(view, node => node.type === 'p' && node.props.children.some(child => typeof child === 'string' && child.includes('USD/JPY: 未取得'))));
  assert.ok(findElement(view, node => node.type === 'p' && node.props.children.includes('価格または為替がない銘柄は合計を表示していません。')));
});

test('残高基準日の扱い: 反映済みフラグ・古い基準日・過去表示が一貫する', () => {
  const app = appContext();
  const today = app.evaluate('todayStr()');
  const yesterday = app.evaluate('fmt(addDays(todayD(),-1))');
  const twoDaysAgo = app.evaluate('fmt(addDays(todayD(),-2))');
  app.context.salary = { id: 'salary', label: '給与', type: 'income', amount: 300, recurring: false, accountId: 'a', startDate: today };
  app.context.incl = { id: 'a', name: '銀行A', balance: 1300, balanceAsOf: today, balanceIncludesAsOfDay: true };
  const included = app.evaluate('buildForecast([incl],[salary],todayD(),new Set())');
  assert.equal(included[0].a, 1300);
  const pastIncluded = app.evaluate('buildHistoricalForecast([incl],[salary],addDays(todayD(),-1),new Set())');
  assert.deepEqual(Array.from(pastIncluded, row => row.a), [1000, 1300]);
  app.context.yExpense = { id: 'card', label: 'カード', type: 'expense', amount: 200, recurring: false, accountId: 'a', startDate: yesterday };
  app.context.stale = { id: 'a', name: '銀行A', balance: 1000, balanceAsOf: twoDaysAgo };
  const stale = app.evaluate('buildForecast([stale],[yExpense],todayD(),new Set())');
  assert.equal(stale[0].a, 800);
  const pastStale = app.evaluate('buildHistoricalForecast([stale],[yExpense],addDays(todayD(),-2),new Set())');
  assert.deepEqual(Array.from(pastStale, row => row.a), [1000, 800, 800]);
});

test('他の端末の更新を上書きせず、選んだときだけ端末の内容で上書きする', async () => {
  const stamps = {};
  const accounts = [{ id: 'a', name: '銀行A', balance: 100, balanceAsOf: '2026-01-01' }];
  const app = appContext({ accounts, transactions: [], loans: [], budgets: {}, skipped: [], preferences: {} }, new Map(), { stamps });
  app.evaluate('App()');
  app.effects[0]();
  await new Promise(resolve => setTimeout(resolve, 20));
  app.cloud.accounts = [{ id: 'a', name: '銀行A', balance: 999 }];
  stamps.accounts = '2026-02-01T00:00:00+00:00';
  app.resetHooks();
  findNode(app.evaluate('App()'), 'Dashboard').props.onUpdAcc({ ...accounts[0], balance: 110 });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(app.cloud.accounts[0].balance, 999);
  assert.ok(JSON.parse(app.storage.get('cf_pending_v1')).accounts);
  app.resetHooks();
  const banner = findElement(app.evaluate('App()'), node => node.type === 'button' && node.props.children.includes('この端末の内容で上書き'));
  assert.ok(banner);
  app.context.window.confirm = () => true;
  app.evaluate('confirm = window.confirm');
  banner.props.onClick();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(app.cloud.accounts[0].balance, 110);
});

test('CSV は全項目を引用し、取り込み時に日付・頻度を検証する', () => {
  const app = appContext();
  app.context.accounts = [{ id: 'a', name: '銀行,A' }];
  const csv = [
    '名前,種別,カテゴリ,口座,振替先口座,金額,頻度,開始日,終了日,営業日調整',
    '"家賃",支出,家賃,"銀行,A",,-80000,毎月,2026/10/27,,前営業日',
    '"壊れた日付",支出,その他,"銀行,A",,-1,毎月,2026/02/30,,',
    '"不明な頻度",支出,その他,"銀行,A",,-1,隔週,2026-10-01,,',
  ].join('\n');
  const result = app.evaluate('transactionsFromCsv')(csv, app.context.accounts);
  assert.equal(result.items.length, 1);
  assert.equal(result.skipped, 2);
  assert.equal(result.items[0].startDate, '2026-10-27');
  assert.equal(result.items[0].adjustBizDay, 'prev');
  assert.equal(app.evaluate('csvCell')('a"b,c'), '"a""b,c"');
});

test('予算から買える米国株の株数を計算する', () => {
  const calc = appContext().evaluate('buyableQuantity');
  const us = calc({ price: 100, fxRate: 150, budget: 100000 });
  assert.equal(us.quantity, 6);
  assert.equal(us.cost, 90000);
  assert.equal(us.rest, 10000);
  assert.equal(calc({ price: 100, fxRate: null, budget: 100000 }), null);
  assert.equal(calc({ price: 1000, fxRate: 150, budget: 100000 }).quantity, 0);
  const dollars = calc({ price: 100, fxRate: null, budget: 650, currency: 'USD' });
  assert.equal(dollars.quantity, 6);
  assert.equal(dollars.cost, 600);
  assert.equal(dollars.rest, 50);
  assert.equal(dollars.priceYen, null);
  assert.equal(calc({ price: 100, fxRate: 150, budget: 650, currency: 'USD' }).priceYen, 15000);
});
