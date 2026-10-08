import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../public/investment-full.html', import.meta.url), 'utf8');
const conflictSource = html.slice(html.indexOf('const STOCKS_PENDING_KEY'), html.indexOf('// デバウンス自動保存'));
const loadSource = html.slice(html.indexOf('async function sbLoad('), html.indexOf('// ☁️ボタン'));

function loadContext(stockUpdatedAt) {
  const localStock = { id: 'local', ticker: 'LOCAL' };
  const cloudStock = { id: 'cloud', ticker: 'CLOUD' };
  const storage = new Map([
    ['stocks', JSON.stringify([localStock])],
    ['sp_stocks_pending_v1', '1'],
    ['sp_stocks_synced_at_v1', '2026-09-28T09:00:00.000Z'],
    ['stocks_updated_at', '2026-09-28T10:00:00.000Z'],
  ]);
  const banner = { hidden: true };
  const rows = [
    { value: [cloudStock], updated_at: stockUpdatedAt },
    null, null, null,
    { value: [], updated_at: '2026-09-28T11:00:00.000Z' },
    null, null,
  ];
  let saveCount = 0;
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  };
  const context = {
    localStorage,
    document: { getElementById: id => id === 'stockConflictBanner' ? banner : { textContent: '' } },
    stocks: [localStock], portfolioLog: [], collateralEntries: [], watchlist: [], transactions: [],
    transactionDeletions: {}, watchlistBudgetJPY: 0,
    LOCAL_UPDATED_AT_KEY: 'stocks_updated_at', PORTFOLIO_LOG_KEY: 'portfolio_log',
    COLLATERAL_KEY: 'collateral', WATCHLIST_KEY: 'watchlist', WATCHLIST_BUDGET_KEY: 'watchlist_budget',
    TX_DELETIONS_KEY: 'tx_deletions', TRANSACTIONS_KEY: 'transactions',
    isSyncing: false, initialLoadDone: false, lastCloudUpdatedAt: null, syncTimer: null, _lastSynced: {},
    _sbGetAll: async () => rows, portfolioTickerSignature: () => 'unchanged',
    normalizePortfolioLog: value => value, mergePortfolioLogs: local => local,
    mergeTransactionDeletions: () => ({}), mergeTransactions: () => [],
    migrateStock: stock => stock, migrateWatchlistItem: item => item,
    recordDailyLog: () => false, render() {}, renderWatchlist() {}, renderPieChart() {}, renderLineChart() {},
    updateSyncIcon() {}, toast() {}, localizeJapaneseNames() {}, requestPortfolioPrices() {},
    _canonicalWatchlist: () => '[]', _canonicalStocks: () => '[]', _hasUnsyncedChanges: () => true,
    scheduleSyncSave: () => { saveCount++; }, _doSave: async () => { saveCount++; },
    notifyCashflow() {}, sbSave() { saveCount++; }, setTimeout: () => 0, clearTimeout() {}, openWatchlistFromParams() {},
    console,
  };
  runInNewContext(`${conflictSource}\n${loadSource}`, context);
  return { context, storage, banner, localStock, cloudStock, saveCount: () => saveCount };
}

test('別項目のクラウド更新で未同期の保有銘柄を消さない', async () => {
  const app = loadContext('2026-09-28T09:00:00.000Z');
  await app.context.sbLoad(true);
  assert.equal(app.context.stocks[0].id, 'local');
  assert.equal(JSON.parse(app.storage.get('stocks'))[0].id, 'local');
  assert.equal(app.storage.get('sp_stocks_pending_v1'), '1');
  assert.equal(app.banner.hidden, true);
  assert.equal(app.saveCount(), 1);
});

test('両端末の保有銘柄が変わったら自動上書きを止める', async () => {
  const app = loadContext('2026-09-28T11:00:00.000Z');
  await app.context.sbLoad(true);
  assert.equal(app.context.stocks[0].id, 'local');
  assert.equal(app.banner.hidden, false);
  assert.equal(app.saveCount(), 0);
  app.context.resolveStockConflict('cloud');
  assert.equal(app.context.stocks[0].id, 'cloud');
  assert.equal(app.storage.has('sp_stocks_pending_v1'), false);
  assert.equal(app.banner.hidden, true);
});

test('端末に未同期編集がなければ新しいクラウド銘柄を取り込む', async () => {
  const app = loadContext('2026-09-28T11:00:00.000Z');
  app.storage.delete('sp_stocks_pending_v1');
  await app.context.sbLoad(true);
  assert.equal(app.context.stocks[0].id, 'cloud');
  assert.equal(app.storage.get('sp_stocks_synced_at_v1'), '2026-09-28T11:00:00.000Z');
  assert.equal(app.banner.hidden, true);
});

test('競合でこの端末を選ぶと保有銘柄の保存を再開する', async () => {
  const app = loadContext('2026-09-28T11:00:00.000Z');
  await app.context.sbLoad(true);
  app.context.resolveStockConflict('local');
  assert.equal(app.context.stocks[0].id, 'local');
  assert.equal(app.storage.get('sp_stocks_synced_at_v1'), '2026-09-28T11:00:00.000Z');
  assert.equal(app.banner.hidden, true);
  assert.equal(app.saveCount(), 1);
});

test('他端末の時計が遅れていても、前回同期から変わったクラウドの変更を取り込む', async () => {
  // 他端末が「この端末のローカル更新時刻より前」の日時で保存したケース
  const app = loadContext('2026-09-28T09:00:00.000Z');
  app.storage.delete('sp_stocks_pending_v1');
  app.storage.set('sp_cloud_seen_v1', JSON.stringify({ sp_watchlist: '2026-09-28T08:00:00.000Z' }));
  app.context.watchlist = [{ id: 'old' }];
  app.context._sbGetAll = async () => [
    { value: [app.cloudStock], updated_at: '2026-09-28T09:00:00+00:00' },
    null, null, null,
    { value: [{ id: 'from-slow-clock' }], updated_at: '2026-09-28T08:30:00.000Z' },
    null, null,
  ];
  await app.context.sbLoad(true);
  assert.equal(app.context.watchlist[0].id, 'from-slow-clock');
  assert.equal(JSON.parse(app.storage.get('sp_cloud_seen_v1')).sp_watchlist, '2026-09-28T08:30:00.000Z');
  // 同じ時刻の表記ゆれ（Z と +00:00）は変更とみなさない
  assert.equal(app.context.stocks[0].id, 'local');
});

test('同期記録と同じなら、端末の時計が進んでいても変更なしと判定する', () => {
  const app = loadContext('2026-09-28T09:00:00.000Z');
  app.storage.set('sp_cloud_seen_v1', JSON.stringify({ sp_collateral: '2026-09-28T07:00:00.000Z' }));
  assert.equal(app.context.cloudKeyChanged('sp_collateral', { updated_at: '2026-09-28T07:00:00+00:00' }), false);
  assert.equal(app.context.cloudKeyChanged('sp_collateral', { updated_at: '2026-09-28T06:59:00+00:00' }), true);
  assert.equal(app.context.cloudKeyChanged('sp_stocks', { updated_at: '2026-09-28T09:00:00+00:00' }), false);
});

test('グラフ期間の起点は日本時間の日付で計算する', () => {
  const start = html.indexOf('function periodCutoffDate(');
  const source = html.slice(start, html.indexOf('\n}\n', start) + 2);
  const context = { todayJST: () => '2026-10-07', Date };
  runInNewContext(source, context);
  assert.equal(context.periodCutoffDate('5d'), '2026-10-02');
  assert.equal(context.periodCutoffDate('1mo'), '2026-09-06');
});

test('担保金の未同期編集は、他端末の変更があっても消さずに統合する', () => {
  const app = loadContext('2026-09-28T09:00:00.000Z');
  const { resolveListSync } = app.context;
  const local = [{ id: 'a', amount: 200 }, { id: 'new', amount: 50 }];
  const cloud = [{ id: 'a', amount: 100 }, { id: 'other', amount: 30 }];
  app.storage.set('sp_cloud_seen_v1', JSON.stringify({ sp_collateral: '2026-09-28T07:00:00.000Z' }));
  // 未同期の編集なし → クラウドを採用
  assert.deepEqual(resolveListSync('sp_collateral', local, cloud, { updated_at: '2026-09-28T08:00:00.000Z' }), cloud);
  app.storage.set('sp_list_pending_v1', JSON.stringify({ sp_collateral: true }));
  // クラウドが変わっていない → 端末の内容
  assert.equal(resolveListSync('sp_collateral', local, cloud, { updated_at: '2026-09-28T07:00:00+00:00' }), local);
  // 両方変わった → 統合（端末の変更が優先、クラウドだけの項目も残る）
  const merged = resolveListSync('sp_collateral', local, cloud, { updated_at: '2026-09-28T08:00:00.000Z' });
  assert.deepEqual(Array.from(merged, item => [item.id, item.amount]), [['a', 200], ['other', 30], ['new', 50]]);
});

test('投信の平均取得価格は1万口あたりで入力し、円/口で保存する', () => {
  const source = html.slice(html.indexOf('const FUND_PRICE_UNIT'), html.indexOf('function getMarketLabel('));
  const context = {};
  runInNewContext(`${source};this.toInput=avgPriceForInput;this.fromInput=avgPriceFromInput;`, context);
  assert.equal(context.fromInput('FUND', 25432), 2.5432);
  assert.equal(context.toInput('FUND', 2.5432), 25432);
  assert.equal(context.toInput('FUND', 1.8), 18000);
  assert.equal(context.fromInput('JP', 2500), 2500);
  assert.equal(context.toInput('JP', 2500), 2500);
  assert.equal(context.toInput('FUND', ''), '');
});
