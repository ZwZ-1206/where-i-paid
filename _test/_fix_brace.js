/**
 * 第二轮修正（修正版）：上一版正则数错了一个括号，漏掉了 B/C 两种形态。
 * 一次性脚本，跑完可删。
 *
 * 目标：把 `consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}` 后面多余的 `}` 削到只剩
 * 「一个（关掉 enableCouple 的参数对象）+ ')' + ';'」。
 *
 * 形态（C 指 consent 对象字面量）：
 *   C + '}});'    → C + '});'     单行 ev("...")
 *   C + '} });'   → C + '});'     跨行、多一个空格
 *   C + '} },'    → 已在上一版处理，跳过
 */
'use strict';
const fs = require('fs');
const path = require('path');

const C = 'consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}';
const REPLACERS = [
  [C + '}});', C + '});'],
  [C + '} });', C + '});'],
];

let total = 0;
fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.js') && f !== '_fix_dollar12.js' && f !== '_fix_brace.js')
  .forEach((f) => {
    const p = path.join(__dirname, f);
    let s = fs.readFileSync(p, 'utf8');
    let n = 0;
    REPLACERS.forEach(([from, to]) => {
      while (s.indexOf(from) >= 0) { s = s.split(from).join(to); n++; }
    });
    if (n) { fs.writeFileSync(p, s, 'utf8'); console.log(f + '  ' + n + ' 处'); total += n; }
  });
console.log('合计修正 ' + total + ' 处');
