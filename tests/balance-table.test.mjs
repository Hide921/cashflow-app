import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.search(/<script>\s*const \{ useState/);
const end = html.indexOf('</script>', start);
const source = html.slice(html.indexOf('>', start) + 1, end)
  .replace(/ReactDOM\.createRoot[\s\S]*$/, '');

function appContext(touch = false) {
  const state = [];
  let stateCursor = 0;
  const h = (type, props, ...children) => ({ type, props: { ...props, children } });
  const React = {
    useState(initial) {
      const index = stateCursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useEffect() {},
    useMemo(calculate) { return calculate(); },
    useRef(initial) { return { current: initial }; },
    createElement: h,
  };
  const context = {
    React,
    supabase: { createClient: () => ({}) },
    localStorage: { getItem: () => null },
    window: { location: { hostname: 'localhost', search: '' }, matchMedia: () => ({ matches: touch }), innerWidth: 1000, innerHeight: 800 },
    navigator: { maxTouchPoints: touch ? 1 : 0 },
    setTimeout,
    URLSearchParams,
    console,
  };
  runInNewContext(source, context);
  return { evaluate: code => runInNewContext(code, context), resetHooks: () => { stateCursor = 0; } };
}

function nodes(root, predicate) {
  if (Array.isArray(root)) return root.flatMap(item => nodes(item, predicate));
  if (!root || typeof root !== 'object') return [];
  return [...(predicate(root) ? [root] : []), ...nodes(root.props?.children, predicate)];
}

function textOf(root) {
  if (Array.isArray(root)) return root.map(textOf).join('');
  if (root == null || root === false) return '';
  if (typeof root !== 'object') return String(root);
  return textOf(root.props?.children);
}

test('週次・月次の内訳には列間の全取引と元の日付を含める', () => {
  const app = appContext();
  const periods = app.evaluate(`buildBalanceTablePeriods(
    [{date:'2026-09-01'}, {date:'2026-09-08'}, {date:'2026-09-15'}],
    [{date:'2026-09-01'}],
    {
      '2026-09-01': {a:[{label:'初日',txId:'first'}]},
      '2026-09-02': {a:[{label:'2日',txId:'second'}]},
      '2026-09-08': {a:[{label:'8日',txId:'eighth'}]},
      '2026-09-09': {a:[{label:'9日',txId:'ninth'}]},
      '2026-09-15': {a:[{label:'15日',txId:'fifteenth'}]}
    }
  )`);
  assert.deepEqual(Array.from(periods, p => [p.startDate, ...(p.eventsByAccount.a || []).map(e => e.date)]), [
    ['2026-09-01', '2026-09-01'],
    ['2026-09-02', '2026-09-02', '2026-09-08'],
    ['2026-09-09', '2026-09-09', '2026-09-15'],
  ]);
});

test('非表示口座を合計から除き、残高セルをキーボードで操作できるボタンにする', () => {
  const app = appContext();
  const props = {
    accounts: [{ id: 'a', name: 'A', color: '#000' }, { id: 'b', name: 'B', color: '#fff' }],
    fData: [{ date: '2026-09-01', a: 100, b: 200, total: 300 }],
    txEventMap: {},
    onCellClick: () => {},
    hiddenAccIds: new Set(['b']),
  };
  const tree = app.evaluate('BalanceTable')(props);
  const rows = nodes(tree, node => node.type === 'tr');
  const total = rows.find(row => textOf(row).includes('表示口座合計'));
  assert.ok(total);
  assert.match(textOf(total), /¥100/);
  assert.doesNotMatch(textOf(total), /¥300/);
  const button = nodes(tree, node => node.type === 'button' && node.props?.['aria-label']?.includes('取引を追加'))[0];
  assert.equal(button.props.type, 'button');
  assert.equal(typeof button.props.onClick, 'function');
  assert.match(button.props.className, /focus-visible:/);
});

test('週次内訳から除外すると、列の日付ではなく取引の発生日を使う', () => {
  const app = appContext(true);
  const dates = Array.from({ length: 8 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
  const props = {
    accounts: [{ id: 'a', name: 'A', color: '#000' }],
    fData: dates.map(date => ({ date, a: 100, total: 100 })),
    txEventMap: { '2026-09-03': { a: [{ label: '予定', amt: -10, txId: 'tx' }] } },
    onCellClick: () => {},
    onSkip: key => { props.skipped = key; },
  };
  let tree = app.evaluate('BalanceTable')(props);
  nodes(tree, node => node.type === 'button' && textOf(node) === '週次')[0].props.onClick();
  app.resetHooks();
  tree = app.evaluate('BalanceTable')(props);
  const cell = nodes(tree, node => node.type === 'button' && node.props?.['aria-label']?.includes('2026/09/08'))[0];
  assert.ok(cell);
  cell.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ x: 100, y: 200, width: 100, height: 40 }) } });
  app.resetHooks();
  tree = app.evaluate('BalanceTable')(props);
  const skip = nodes(tree, node => node.type === 'button' && node.props?.title?.includes('この回を残高推移から除外'))[0];
  assert.ok(skip);
  skip.props.onClick({ stopPropagation() {} });
  assert.equal(props.skipped, 'tx_2026-09-03');
});
