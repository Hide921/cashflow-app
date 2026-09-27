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

function appContext(cloud = {}, storage = new Map()) {
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
  };
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
  };
  const supabase = {
    createClient: () => ({
      from: () => ({
        select: () => ({ eq: (_field, key) => ({ maybeSingle: async () => ({ data: key in cloud ? { value: cloud[key] } : null, error: null }) }) }),
        upsert: async row => { cloud[row.key] = row.value; return { error: null }; },
      }),
    }),
  };
  const context = { React, supabase, localStorage, window: { location: { hostname: 'localhost', search: '' } }, navigator: { onLine: true }, setTimeout, URLSearchParams, console };
  runInNewContext(source, context);
  return {
    cloud, storage, state, effects, context,
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
