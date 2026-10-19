/**
 * 修「consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}}」这类占位符：一次性脚本，跑完可删。
 *
 * 起因：早先某次把 enableCouple({...}) 的第二个参数模板化时，把
 * `consent:{agreed:true,version:N}` 整段替换成了字面文本 `consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}`（模板里 $1
 * 被当成捕获组、后面又粘了个 2）。结果这些测试脚本起手就抛
 * `SyntaxError: missing ) after argument list`，表现为「0/0 套件」——
 * 不是被测代码坏了，是测试脚本自己语法错。
 *
 * 修法确定：把独立成词的 `consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}` 换成 `consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}`。
 * 只动 _test/ 下的脚本，不动任何运行时代码。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname);
const REPL = 'consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}';
// 只替换「consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}」这个独立记号：前面不是 $（排除 $$12 之类的转义），后面不是数字
const RE = /(?<!\$)\consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}(?!\d)/g;

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));
let total = 0;
files.forEach((f) => {
  const p = path.join(DIR, f);
  const s = fs.readFileSync(p, 'utf8');
  const n = (s.match(RE) || []).length;
  if (!n) return;
  fs.writeFileSync(p, s.replace(RE, REPL), 'utf8');
  console.log(f + '  ' + n + ' 处');
  total += n;
});
console.log('合计替换 ' + total + ' 处');
