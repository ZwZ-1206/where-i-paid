// 打印暖心提示文案库统计与每组全部句子
// 用法: node _test/dump-tips.js [组名]
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'tips.js'), 'utf8');
const key = 'const COPY = ';
const at = src.indexOf(key);
const from = at + key.length;

// 从 { 开始做花括号配对，取完整对象字面量（跳过字符串内的括号）
let depth = 0, i = from, inStr = false, quote = '', esc = false, endIdx = -1;
for (; i < src.length; i++) {
  const ch = src[i];
  if (inStr) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === quote) { inStr = false; }
    continue;
  }
  if (ch === '"' || ch === "'" || ch === '`') { inStr = true; quote = ch; continue; }
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
}
const lit = src.slice(from, endIdx);
const COPY = eval('(' + lit + ')');

const only = process.argv[2];
let total = 0;
const rows = [];
for (const k of Object.keys(COPY)) {
  total += COPY[k].lines.length;
  rows.push([k, COPY[k].lines.length, COPY[k].tag, COPY[k].tone]);
}
rows.sort((a, b) => b[1] - a[1]);
console.log('条数  组名              标签   语气');
console.log('------------------------------------------------');
rows.forEach(([k, n, tag, tone]) => {
  console.log(`${String(n).padStart(3)}   ${k.padEnd(16)}  ${tag.padEnd(5)}  ${tone}`);
});
console.log('------------------------------------------------');
console.log(`共 ${Object.keys(COPY).length} 组 / ${total} 句`);

if (only === '--all' || only === 'all') {
  for (const k of Object.keys(COPY)) {
    const g = COPY[k];
    console.log(`\n=== ${k}  ${g.emoji} ${g.tag} (${g.tone}) 共 ${g.lines.length} 句 ===`);
    g.lines.forEach((l, n) => console.log(`${n + 1}. ${l}`));
  }
} else if (only) {
  const g = COPY[only];
  if (!g) { console.log('\n没有这个键：' + only); process.exit(1); }
  console.log(`\n=== ${only}  ${g.emoji} ${g.tag} (${g.tone}) 共 ${g.lines.length} 句 ===`);
  g.lines.forEach((l, n) => console.log(`${n + 1}. ${l}`));
}
