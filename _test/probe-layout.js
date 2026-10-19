const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const env = require('./_env');
const PROFILE = env.profile('probe-lay');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:4173/index.html';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const proc = spawn(EDGE, ['--headless=new','--remote-debugging-port=9421','--user-data-dir='+PROFILE,
    '--no-first-run','--no-default-browser-check','--disable-gpu','--window-size=390,844', URL], { stdio: 'ignore' });
  let ver=null;
  for(let i=0;i<80;i++){ try{ const r=await fetch('http://127.0.0.1:9421/json/version'); if(r.ok){ver=await r.json();break;} }catch(e){} await sleep(250); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id=0; const pending=new Map();
  ws.addEventListener('message', ev=>{const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
  await new Promise(r=>ws.addEventListener('open',r));
  const send=(method,params,sessionId)=>new Promise((res,rej)=>{const myId=++id;pending.set(myId,m=>m.error?rej(new Error(method+': '+m.error.message)):res(m.result));ws.send(JSON.stringify({id:myId,method,params:params||{},sessionId}));});
  const targets = await send('Target.getTargets');
  const page = targets.targetInfos.find(t2=>t2.type==='page'&&!/devtools|extension/.test(t2.url));
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
  const S=(m,p)=>send(m,p,sessionId);
  await S('Page.enable'); await S('Runtime.enable');
  await S('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
  await S('Page.navigate',{url:URL}); await sleep(2600);
  const ev = async (expr) => {
    const r = await S('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
    if(r.exceptionDetails) throw new Error((r.exceptionDetails.exception||{}).description||r.exceptionDetails.text);
    return r.result.value;
  };
  await ev(`(function(){
    const s = window.Store;
    s.enableCouple({ meName:'\u5c0f\u61d2', peerName:'\u5c0f\u6ee1', togetherSince:'2024-05-20', mode:'local',
      consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}});
    const b = null;
    const cat=['food','fun','transport','shopping','market','travel'];
    const ids=['me','peer','both','mutual'];
    for(let i=0;i<24;i++) s.cpAddTx({type:'expense',amount:1800+i*470,catId:cat[i%6],note:'\u4e00\u8d77\u5403\u7684\u706b\u9505',attrib:ids[i%4],ts:Date.now()-i*600000});
    const g=s.coupleVault(); g.saved=186000; g.target=500000;
    App.go('couple'); window.ViewCouple.setStep('main'); window.ViewCouple.setPage('home');
    window.ViewCouple.render(document.querySelector('#view-couple'));
    return 1;
  })()`);
  await sleep(900);
  console.log('--- 情侣页溢出检测 ---');
  console.log(await ev(`(function(){
    const root = document.querySelector('#view-couple');
    const vw = 390;
    const bad = [];
    root.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const cn = (typeof el.className === 'string' ? el.className : el.tagName) || el.tagName;
      if (r.right > vw + 1.5 || r.left < -1.5) bad.push('OUT ' + cn + ' L' + Math.round(r.left) + ' R' + Math.round(r.right));
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) bad.push('SCROLLX ' + cn + ' ' + el.scrollWidth + '>' + el.clientWidth);
      const cs = getComputedStyle(el);
      if (cs.overflow === 'hidden' && el.children.length === 0 && el.clientHeight > 0 && el.scrollHeight > el.clientHeight + 3 && (el.textContent||'').trim()) {
        bad.push('CLIP ' + cn + ' ' + el.scrollHeight + '>' + el.clientHeight);
      }
    });
    return bad.length ? bad.slice(0,20).join(' | ') : 'no overflow';
  })()`));
  console.log('--- 模块卡尺寸 ---');
  console.log(await ev(`(function(){
    return Array.from(document.querySelectorAll('#view-couple .cp-mod')).map((el) => {
      const r = el.getBoundingClientRect();
      const n = el.querySelector('.cp-mod-name');
      const v = el.querySelector('.cp-mod-val');
      return (n?n.textContent:'?') + ' w=' + Math.round(r.width) + ' h=' + Math.round(r.height)
        + ' valH=' + (v?Math.round(v.getBoundingClientRect().height):0);
    }).join(' | ');
  })()`));
  console.log('--- 归属次数卡 ---');
  console.log(await ev(`(function(){
    const el = document.querySelector('#view-couple .cp-attribs');
    if (!el) return 'MISSING';
    const r = el.getBoundingClientRect();
    return 'w=' + Math.round(r.width) + ' h=' + Math.round(r.height) + ' lines=' +
      el.querySelectorAll('.cp-attrib-cell').length + ' text=' + el.textContent.replace(/\\s+/g,' ').trim().slice(0,90);
  })()`));
  console.log('--- 双心位置 ---');
  console.log(await ev(`(function(){
    const h = document.querySelector('#view-couple .cp-vault-hearts');
    if (!h) return 'no hearts';
    const l = h.querySelector('.cp-heart--l').getBoundingClientRect();
    const rr = h.querySelector('.cp-heart--r').getBoundingClientRect();
    return 'gap=' + h.style.getPropertyValue('--gap') + ' Lx=' + Math.round(l.left) + ' Rx=' + Math.round(rr.left) + ' dist=' + Math.round(rr.left - l.right);
  })()`));
  console.log('--- 记账页归属行 ---');
  await ev(`App.go('add')`); await sleep(800);
  console.log(await ev(`(function(){
    const row = document.querySelector('#view-add .attrib-row');
    if (!row) return 'MISSING';
    const r = row.getBoundingClientRect();
    const chips = Array.from(row.querySelectorAll('.attrib-chip')).map((c) => {
      const b = c.getBoundingClientRect();
      return c.textContent.trim() + ':' + Math.round(b.width) + 'x' + Math.round(b.height) + (c.classList.contains('on')?'(on)':'');
    });
    return 'row w=' + Math.round(r.width) + ' h=' + Math.round(r.height) + ' chips=' + chips.join(' ');
  })()`));
  console.log('--- 明细徽章 ---');
  await ev(`App.go('detail')`); await sleep(900);
  console.log(await ev(`(function(){
    const tags = document.querySelectorAll('#view-detail .tx-tag--attrib');
    return 'count=' + tags.length + ' first=' + (tags[0] ? tags[0].textContent.trim() : 'none');
  })()`));
  console.log('--- 目标页情侣卡 ---');
  await ev(`App.go('goals')`); await sleep(900);
  console.log(await ev(`(function(){
    const c = document.querySelector('.goal-card--couple');
    if (!c) return 'MISSING';
    const r = c.getBoundingClientRect();
    return 'w=' + Math.round(r.width) + ' h=' + Math.round(r.height) + ' badge=' + (c.querySelector('.goal-badge--couple')||{}).textContent + ' nums=' + c.querySelector('.goal-nums').textContent.replace(/\\s+/g,' ');
  })()`));
  ws.close(); await env.stop(proc);})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
