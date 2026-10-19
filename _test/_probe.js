const { spawn } = require('child_process');
const env = require('./_env');
const EDGE='C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT=9433, sleep=(m)=>new Promise(r=>setTimeout(r,m));
(async()=>{
  const p=env.profile('probe');
  const proc=spawn(EDGE,[`--remote-debugging-port=${PORT}`,`--user-data-dir=${p}`,'--headless=new','--disable-gpu','--hide-scrollbars','about:blank'],{stdio:'ignore'});
  let t=null; for(let i=0;i<40;i++){try{const l=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();t=l.find(x=>x.type==='page');if(t)break;}catch(e){} await sleep(250);}
  const ws=new WebSocket(t.webSocketDebuggerUrl); let id=0; const pend=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
  await new Promise(r=>ws.addEventListener('open',r));
  const S=(m,pa)=>new Promise((res,rej)=>{const i=++id;pend.set(i,x=>x.error?rej(new Error(m+': '+x.error.message)):res(x.result));ws.send(JSON.stringify({id:i,method:m,params:pa||{}}));});
  await S('Page.enable');
  await S('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await S('Page.navigate',{url:process.argv[2]});
  await sleep(1500);
  const r=await S('Runtime.evaluate',{expression:`(()=>{const p=document.querySelector('.phone');const im=p.querySelector('img');const cs=getComputedStyle(im);return JSON.stringify({phone:getComputedStyle(p).width,img:cs.width,imgH:cs.height,natural:[im.naturalWidth,im.naturalHeight]});})()`,returnByValue:true});
  console.log(r.result.value);
  ws.close(); await env.stop(proc); process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});
