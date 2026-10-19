/* 把 go() 里以单个 $ 开头（且不是 $$）的选择器行补成 $$ —— 确定性做法 */
'use strict';
const fs = require('fs');

const FILE = 'assets/js/app.js';
const DOLLAR = String.fromCharCode(36);

let s = fs.readFileSync(FILE, 'utf8');
const lines = s.split('\n');
let fixed = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const indent = line.length - line.trimStart().length;
  const body = line.slice(indent);
  if (body.length < 2) continue;
  if (body[0] !== DOLLAR) continue;
  if (body[1] === DOLLAR) continue;              // 已经是 $$
  if (body[1] !== '(') continue;                 // 必须是 $( 调用
  const rest = body.slice(2);
  // 只处理 .view / .tab 这两类选择器（这次改动引入的）
  if (rest.indexOf("'.view'") !== 0 && rest.indexOf("'.tab'") !== 0) continue;
  // 只处理 go() 内部：带 forEach 且带 dataset 的那两行
  if (rest.indexOf('forEach') < 0) continue;
  if (rest.indexOf('dataset') < 0) continue;
  lines[i] = line.slice(0, indent) + DOLLAR + DOLLAR + body.slice(1);
  fixed++;
}

fs.writeFileSync(FILE, lines.join('\n'), 'utf8');
console.log('fixed:', fixed);

const after = fs.readFileSync(FILE, 'utf8').split('\n');
[158, 160].forEach((ln) => {
  const t = after[ln - 1].trim();
  console.log(ln, 'dollars=', (t.match(/^\x24+/) || [''])[0].length);
});
