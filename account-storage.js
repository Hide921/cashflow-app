/* アカウント別の端末保存。認証情報と表示テーマはブラウザ共通のままにする。 */
(function (root) {
  'use strict';
  const shared = new Set(['cf_dark', 'api_base_url', 'usdjpy_rate']);
  const legacyKeys = ['cf_cache_v2:legacy','cf_pending_v1','cf_remote_stamps_v1','cf_sp_stocks_base_v1','cf_skipped','cf_buy_calc_v1','cf_before_restore_v1',
    'stocks','stocks_updated_at','portfolio_log_v1','collateral_v1','transactions_v1','transaction_deletions_v1','watchlist_v1','watchlist_budget_v1',
    'stock_form_draft_v1','portfolio_compact_view_v1','sp_stocks_pending_v1','sp_stocks_synced_at_v1','sp_cloud_seen_v1','sp_list_pending_v1','rebalance_targets_v1','portfolio_price_cache_v1'];
  function create(storage) {
    let active = null;
    const prefix = id => `cf_user:${encodeURIComponent(id)}:`;
    const read = key => { try { return storage.getItem(key); } catch { return null; } };
    const legacy = () => Object.fromEntries(legacyKeys.map(key => [key,read(key)]).filter(([,value]) => value !== null));
    function scope(id) {
      if (typeof id !== 'string' || !id) throw new Error('ログインを確認してください');
      const keyFor = key => shared.has(key) ? key : prefix(id)+key;
      return Object.freeze({
        userId:id,
        getItem:key => storage.getItem(keyFor(key)),
        setItem:(key,value) => storage.setItem(keyFor(key),value),
        removeItem:key => storage.removeItem(keyFor(key)),
      });
    }
    return {
      scope,
      activate(id) { active=scope(id); return active; },
      current() { if (!active) throw new Error('ログインを確認してください'); return active; },
      needsLegacyChoice(id) { return read('cf_legacy_resolved_v1')===null && read(prefix(id)+'ready')===null && Object.keys(legacy()).length>0; },
      // 旧データには所有者がないため、確認するまで新アカウントへ読み込まない。
      resolveLegacy(id,importOld) {
        const target=scope(id);
        if (importOld) {
          for (const [key,value] of Object.entries(legacy())) {
            if (target.getItem(key)===null) target.setItem(key,value);
          }
        }
        storage.setItem(prefix(id)+'ready','1');
        storage.setItem('cf_legacy_resolved_v1','1');
        // 元データは消さず、移行の途中で失敗してもやり直せるようにする。
        return target;
      },
      legacySnapshot:legacy,
    };
  }
  root.createCashflowStorage=create;
  try { root.CashflowStorage=create(root.localStorage); } catch { root.CashflowStorage=create({getItem(){return null;},setItem(){throw new Error('端末に保存できません');},removeItem(){}}); }
})(typeof window==='undefined'?globalThis:window);
