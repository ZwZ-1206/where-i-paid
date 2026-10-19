const env = require('./_env');
﻿const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const PORT = 9483; const PROFILE = env.profile('dbg5'), EDGE='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 fs.rmSync(PROFILE,{recursive:true,force:true});
 const proc=spawn(EDGE,['--headless=new','--remote-debugging-port='+PORT,'--user-data-dir='+PROFILE,'--no-first-run','--disable-gpu','--window-size=390,844','about:blank'],{stdio:'ignore'});
 let ver=null; for(let i=0;i<80;i++){try{const r=await fetch('http://127.0.0.1:'+PORT+'/json/version');if(r.ok){ver=await r.json();break}}catch(e){}await sleep(250)}
 const ws=new WebSocket(ver.webSocketDebuggerUrl); let id=0; const pend=new Map();
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id)}});
 await new Promise(r=>ws.addEventListener('open',r));
 const send=(method,params,sessionId)=>new Promise((res,rej)=>{const my=++id;pend.set(my,m=>m.error?rej(new Error(method+': '+m.error.message)):res(m.result));ws.send(JSON.stringify({id:my,method,params:params||{},sessionId}))});
 const tg=await send('Target.getTargets'); const pg=tg.targetInfos.find(x=>x.type==='page'&&!/devtools|extension/.test(x.url));
 const {sessionId}=await send('Target.attachToTarget',{targetId:pg.targetId,flatten:true}); const S=(m,p)=>send(m,p,sessionId);
 await S('Page.enable'); await S('Runtime.enable');
 await S('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
 await S('Page.navigate',{url:'http://127.0.0.1:4173/index.html'}); await sleep(2600);
 const ev=async(e)=>{const r=await S('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true}); if(r.exceptionDetails) return {__err:(r.exceptionDetails.exception||{}).description}; return r.result.value};
 await ev("(function(){const S=window.Store;S.clearAll();S.enableCouple({meName:'小懒',peerName:'小满',mode:'remote',togetherSince:'2024-05-20',consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}});for(let i=0;i<6;i++)S.cpAddTx({type:'expense',amount:3000+i*1100,catId:['food','fun','transport','shopping'][i%4],note:'测试'+i,ts:Date.now()-i*86400000,attrib:['me','peer','both','mutual'][i%4]});window.App.go('couple');return 1})()");
 await sleep(800);
 // 打开模式页
 await ev("document.querySelector('#view-couple [data-cp=\"switch-mode\"]').click()");
 await sleep(600);
 const box = await ev(`(function(){
   const b=document.querySelector('#view-couple [data-cp="mode-back"]');
   if(!b) return 'NO-BTN';
   const cs=getComputedStyle(b); const r=b.getBoundingClientRect();
   return {w:Math.round(r.width),h:Math.round(r.height),x:Math.round(r.x),y:Math.round(r.y),
     radius:cs.borderRadius, bg:cs.backgroundColor, border:cs.borderTopWidth+' '+cs.borderTopColor,
     txt:JSON.stringify(b.textContent.trim()), shadow:cs.boxShadow,
     path:'svg=' + !!b.querySelector('svg'), transform:getComputedStyle(b.querySelector('svg')).transform};
 })()`);
 console.log('模式页返回按钮:', JSON.stringify(box));
 // 账单页
 await ev("window.ViewCouple.setPage('bill'); window.ViewCouple.render(document.querySelector('#view-couple'))");
 await sleep(500);
 const box2 = await ev(`(function(){
   const b=document.querySelector('#view-couple [data-cp="bill-home"]');
   if(!b) return 'NO-BTN';
   const cs=getComputedStyle(b); const r=b.getBoundingClientRect();
   return {w:Math.round(r.width),h:Math.round(r.height),radius:cs.borderRadius,txt:JSON.stringify(b.textContent.trim())};
 })()`);
 console.log('账单页返回按钮:', JSON.stringify(box2));
 // 子页
 await ev("window.ViewCouple.setPage('memories'); window.ViewCouple.render(document.querySelector('#view-couple'))");
 await sleep(500);
 const box3 = await ev(`(function(){
   const b=document.querySelector('#view-couple [data-cp="sub-back"]');
   const t=document.querySelector('#view-couple .cp-sub-title');
   const rb=b.getBoundingClientRect(), rt=t.getBoundingClientRect();
   return {w:Math.round(rb.width),h:Math.round(rb.height),txt:JSON.stringify(b.textContent.trim()),
     titleLeft:Math.round(rt.x), btnRight:Math.round(rb.right), gap:Math.round(rt.x-rb.right)};
 })()`);
 console.log('子页返回按钮:', JSON.stringify(box3));
 // 点一下能不能回去
 await ev("document.querySelector('#view-couple [data-cp=\"sub-back\"]').click()");
 await sleep(500);
 console.log('点后 page =', await ev('window.ViewCouple.page'));
 ws.close(); await env.stop(proc);})();
