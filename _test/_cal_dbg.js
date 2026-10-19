const fs = require('fs'), vm = require('vm'), path = require('path');
const root = 'C:/Code/Jizhang/assets/js';
function mkEl(tag){return{tag,style:{},children:[],setAttribute(k,v){this[k]=v},getAttribute(k){return this[k]??null},appendChild(c){this.children.push(c);return c},addEventListener(){},removeEventListener(){},classList:{add(){},remove(){},toggle(){}},get innerHTML(){return this._html||''},set innerHTML(v){this._html=v},querySelector:()=>null,querySelectorAll:()=>[]};}
const doc={addEventListener(){},createElement:mkEl,createTextNode:t=>({text:t}),documentElement:mkEl('html'),head:mkEl('head'),body:mkEl('body'),querySelectorAll:()=>[],querySelector:()=>null};
const ctx=vm.createContext({console,setTimeout,clearTimeout,setInterval,clearInterval,window:{addEventListener(){},location:{href:''}},navigator:{language:'zh-CN',userAgent:'smoke'},location:{href:'http://localhost/'},document:doc,localStorage:{_d:{},getItem(k){return this._d[k]??null},setItem(k,v){this._d[k]=String(v)},removeItem(k){delete this._d[k]}},requestAnimationFrame:f=>setTimeout(f,0),fetch:()=>Promise.resolve({ok:false,json:()=>Promise.resolve({})})});
ctx.globalThis=ctx;ctx.self=ctx;ctx.window.globalThis=ctx;
for(const f of['icons.js','utils.js']){vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f});for(const k of['Icons','U'])if(ctx.window[k])vm.runInContext(k+' = window.'+k+';',ctx);}
for(const f of['store.js','charts.js','view-couple.js']){vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),ctx,{filename:f});for(const k of['Store','ViewCouple','Charts'])if(ctx.window[k])vm.runInContext(k+' = window.'+k+';',ctx);}
const S=ctx.window.Store,VC=ctx.window.ViewCouple;
S.init();
S.enableCouple({consent:{agreed:true,version:VC.CONSENT_VERSION},meName:'我',peerName:'TA',togetherSince:'2024-01-01',mode:'local'});
let h='';
const host={addEventListener(type,fn){this._l=this._l||{};this._l[type]=fn},set innerHTML(v){h=v},get innerHTML(){return h}};
VC.setPage('memories');
VC.render(host);
console.log('render happened?', h.length);
const btn={getAttribute(k){return {'data-cp':'cal-next'}[k]},closest:(sel)=>sel==='[data-cp]'?btn:null};
host._l.click({target:btn,preventDefault(){}});
console.log('after click (before re-render) h has next-title?', h.includes('cp-cal-title-num'));
VC.render(host);
const m=/cp-cal-title-num">(\d{4})<\/span><span class="cp-cal-title-unit">年<\/span><span class="cp-cal-title-num">(\d+)</.exec(h);
console.log('after next:', m ? `${m[1]}年${m[2]}月` : 'no title');
console.log('now:', new Date().getFullYear(), new Date().getMonth() + 1);
console.log('title snippet:', (h.match(/cp-cal-title[\s\S]{0,220}/) || ['none'])[0]);
