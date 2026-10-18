import { mkdir, copyFile, cp, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Script } from 'node:vm';

const root=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(root,'dist');
// 静的配信と同じ構成を出力し、家計画面と投資画面の構文も検査する。
for(const file of ['index.html','public/investment-full.html']){
  const html=await readFile(path.join(root,file),'utf8');
  for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){
    if(!match[2].trim())continue;
    new Script(match[2],{filename:file});
  }
}
await mkdir(output,{recursive:true});
for(const file of ['index.html','account-storage.js','investment-boot.js']){
  if(file.endsWith('.js'))new Script(await readFile(path.join(root,file),'utf8'),{filename:file});
  await copyFile(path.join(root,file),path.join(output,file));
}
await cp(path.join(root,'public'),path.join(output,'public'),{recursive:true});
const investment=(await readFile(path.join(root,'public/investment-full.html'),'utf8'))
  .replace('src="../account-storage.js"','src="./account-storage.js"')
  .replace('src="../investment-boot.js"','src="./investment-boot.js"');
await writeFile(path.join(output,'investment-full.html'),investment);
await copyFile(path.join(root,'public/favicon.svg'),path.join(output,'favicon.svg'));
console.log('構文検査と配布用ファイルの出力が完了しました: dist/');
