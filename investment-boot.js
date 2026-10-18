/* 認証と保存先を確定してから投資画面を起動し、別アカウントのデータを混ぜない。 */
(async function () {
  const status=document.createElement('div');
  status.setAttribute('role','status');
  status.style.cssText='position:fixed;inset:0;z-index:10000;background:var(--bg,#f7f7f5);color:var(--text,#111827);display:grid;place-content:center;gap:16px;padding:24px;text-align:center';
  status.textContent='ログインと端末データを確認しています…';
  document.body.append(status);
  try {
    if(!window.CashflowStorage)throw new Error('保存機能を読み込めませんでした。');
    const localOnly=new URLSearchParams(location.search).get('local-only')==='1';
    if(localOnly)window.CashflowStorage.activate('local-demo');
    else {
      if(!window.supabase)await new Promise((resolve,reject)=>{
        const library=document.getElementById('syncLibrary');
        const timeout=setTimeout(()=>finish(new Error('通信に時間がかかっています。')),15000);
        function finish(error){clearTimeout(timeout);library.removeEventListener('load',loaded);library.removeEventListener('error',failed);error?reject(error):resolve();}
        function loaded(){finish();}
        function failed(){finish(new Error('ログイン機能を読み込めませんでした。'));}
        library.addEventListener('load',loaded);library.addEventListener('error',failed);
      });
      // 公開用の接続先はアプリ本体と同じ定数を使う。
      const source=document.getElementById('investment-app').textContent;
      const url=source.match(/const _SB_URL = '([^']+)'/)[1];
      const key=source.match(/const _SB_KEY = '([^']+)'/)[1];
      const client=window.supabase.createClient(url,key);
      const {data,error}=await client.auth.getSession();
      if(error)throw error;
      if(!data?.session?.user?.id)throw new Error('先に Cashflow でログインしてください。');
      const id=data.session.user.id;
      if(window.CashflowStorage.needsLegacyChoice(id))throw new Error('Cashflow で端末データの引き継ぎを確認してください。');
      window.CashflowStorage.activate(id);
      window.investmentAuthClient=client;
    }
    const script=document.createElement('script');
    script.textContent=document.getElementById('investment-app').textContent;
    let startupError=null;
    const capture=event=>{startupError=event.error||new Error('画面を開始できませんでした');};
    window.addEventListener('error',capture);
    try{document.body.append(script);}finally{window.removeEventListener('error',capture);}
    if(startupError)throw startupError;
    status.remove();
  } catch {
    status.setAttribute('role','alert');
    status.textContent='投資画面を開始できませんでした。通信状況を確認するか、Cashflow でログイン・端末データの引き継ぎを確認してください。';
    const link=document.createElement('a');
    link.href=location.pathname.includes('/public/')?'../index.html?view=investments':'./index.html?view=investments';
    link.target='_top';link.textContent='Cashflow を開く';link.style.color='var(--accent,#4f46e5)';status.append(link);
    const retry=document.createElement('button');retry.textContent='再試行';retry.style.cssText='padding:12px;border:1px solid currentColor;border-radius:12px;background:transparent;color:inherit';retry.onclick=()=>location.reload();status.append(retry);
  }
})();
