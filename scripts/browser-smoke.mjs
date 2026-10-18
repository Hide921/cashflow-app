import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

// 実アカウントを使わず、全クラウド通信を遮断して画面を検証する。
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'.artifacts');await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname.replace(/^\/release/,'');
  const files={'/':'index.html','/index.html':'index.html','/account-storage.js':'account-storage.js','/investment-boot.js':'investment-boot.js','/investment-full.html':'public/investment-full.html','/favicon.svg':'public/favicon.svg'};
  let file=files[pathname];
  if(!file){res.writeHead(404);res.end();return;}
  if(req.url.startsWith('/release/'))file='dist/'+file.replace(/^public\//,'');
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html');
  res.end(await readFile(path.join(root,file)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try{
  browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.route('**/*',async route=>{
    const url=route.request().url();
    if(url.startsWith(origin))return route.continue();
    if(url.includes('unpkg.com/react@'))return route.fulfill({contentType:'application/javascript',body:await readFile(path.join(root,'node_modules/react/umd/react.production.min.js'),'utf8')});
    if(url.includes('unpkg.com/react-dom@'))return route.fulfill({contentType:'application/javascript',body:await readFile(path.join(root,'node_modules/react-dom/umd/react-dom.production.min.js'),'utf8')});
    if(url.startsWith('https://cdn.tailwindcss.com/'))return route.continue();
    return route.abort();
  });
  await context.addInitScript(()=>{
    const month=new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0');
    const cloud={accounts:[{id:'bank',name:'千葉銀',balance:500000,color:'#6366f1'}],transactions:[{id:'salary',label:'給与',type:'income',category:'給与',amount:250000,startDate:month+'-23',accountId:'bank',salary:{month,kind:'monthly',gross:300000,socialInsurance:30000,incomeTax:10000,residentTax:10000,deductions:50000,payDate:month+'-25'}}],loans:[],budgets:{},skipped:[],preferences:{autoSalary:false,autoLoanPayments:false}};
    window.fixtureCloud=cloud;
    const query=(op,payload)=>{
      const filters=[];
      const run=async()=>{
        if(op==='write')for(const row of Array.isArray(payload)?payload:[payload])cloud[row.key]=row.value;
        const data=Object.entries(cloud).filter(([key])=>filters.every(fn=>fn(key))).map(([key,value])=>({key,value,updated_at:'2026-10-01T00:00:00Z'}));
        return {data,error:null};
      };
      const builder={select:()=>builder,abortSignal:()=>builder,in:(_key,keys)=>{filters.push(key=>keys.includes(key));return builder;},eq:(field,value)=>{if(field==='key')filters.push(key=>key===value);return builder;},maybeSingle:async()=>({data:(await run()).data[0]||null,error:null}),then:(resolve,reject)=>run().then(resolve,reject)};
      return builder;
    };
    const channel={on:()=>channel,subscribe:()=>channel};
    const user={id:'fixture-user',email:'test@example.invalid'};window.fixtureUser=user;
    const client={auth:{getSession:async()=>({data:{session:{user}},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},from:()=>({select:()=>query('read'),upsert:value=>query('write',value),update:value=>query('write',value),insert:value=>query('write',value)}),channel:()=>channel};
    Object.defineProperty(window,'supabase',{configurable:true,get:()=>({createClient:()=>client}),set(){}});
  });
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('Failed to load resource'))errors.push(message.text());});
  page.on('dialog',dialog=>dialog.dismiss());
  await page.goto(origin+'/?view=salary');
  await page.getByRole('heading',{name:'給与・賞与',exact:true}).waitFor();
  // Tailwind の適用を待ってから幅と表示を検査する。
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('header')).position==='sticky');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'スマホで画面全体が横にはみ出していない');
  await page.getByRole('button',{name:'ダークモードに切替'}).click();
  await page.getByRole('button',{name:'＋ 月給を登録',exact:true}).click();
  await page.locator('#salary-pay-date').fill('2026-05-06');
  await page.getByText('振込日: 2026/05/01(金)（土日祝のため繰上げ）',{exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'salary-mobile-dark.png'),fullPage:true});
  await page.getByRole('button',{name:'給与フォームを閉じる'}).click();
  await page.getByRole('button',{name:'給与',exact:true}).filter({visible:true}).click();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'口座');
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'設定を開く'}).click();
  const settings=page.getByRole('dialog',{name:'設定',exact:true});await settings.waitFor();
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
  await page.keyboard.press('Escape');await settings.waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:'設定を開く'}).evaluate(el=>el===document.activeElement),true);
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:path.join(output,'salary-desktop-dark.png'),fullPage:true});
  // 未ログインや旧データを混ぜず、認証済み保存先から投資画面を起動する。
  await page.goto(origin+'/investment-full.html');
  await page.waitForFunction(()=>typeof window.openModal==='function');
  await page.getByRole('button',{name:'+ 銘柄追加',exact:true}).click();
  await page.getByRole('dialog').filter({visible:true}).first().waitFor();
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
  await page.screenshot({path:path.join(output,'investment-desktop.png'),fullPage:true});
  await page.goto(origin+'/release/investment-full.html');
  await page.waitForFunction(()=>typeof window.openModal==='function');
  await page.getByRole('button',{name:'+ 銘柄追加',exact:true}).waitFor();
  await page.goto(origin+'/?view=salary');
  await page.getByRole('heading',{name:'給与・賞与',exact:true}).waitFor();
  await page.evaluate(()=>localStorage.setItem('stocks','[{"id":"legacy"}]'));
  await page.reload();
  await page.getByRole('heading',{name:'端末データを引き継ぐ'}).waitFor();
  await page.getByRole('button',{name:'クラウドのデータで始める',exact:true}).click();
  await page.getByRole('heading',{name:'給与・賞与',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>CashflowStorage.current().getItem('stocks')),null);
  const blocked=await page.evaluate(async()=>{fixtureUser.id='other-user';try{await _sbSet('accounts',[]);return false;}catch{return fixtureCloud.accounts.length===1;}});
  assert.equal(blocked,true,'アカウント変更後は元のデータを送信しない');
  assert.deepEqual(errors,[]);
  console.log('画面確認完了: スマホ幅・ダークモード・給与休日表示・フォーカス復元・メニュー操作・投資画面・サブパス配信・旧データ移行・アカウント変更時の保存停止');
}finally{
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
