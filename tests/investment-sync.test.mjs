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
    _canonicalWatchlist: () => '[]', _hasUnsyncedChanges: () => true,
    scheduleSyncSave: () => { saveCount++; }, _doSave: async () => { saveCount++; },
    notifyCashflow() {}, sbSave() { saveCount++; }, setTimeout: () => 0, clearTimeout() {},
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
