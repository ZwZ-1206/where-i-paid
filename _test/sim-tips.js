// 模拟「同一天稳定、换一天变化」的选句效果
// 用法: node _test/sim-tips.js [组名] [天数]
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'tips.js'), 'utf8');
const key = 'const COPY = ';
const at = src.indexOf(key);
const from = at + key.length;

let depth = 0, i = from, inStr = false, quote = '', esc = false, endIdx = -1;
for (; i < src.length; i++) {
  const ch = src[i];
  if (inStr) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === quote) inStr = false;
    continue;
  }
  if (ch === '"' || ch === "'" || ch === '`') { inStr = true; quote = ch; continue; }
  if (ch === '{') depth++;
  else if (ch === '}') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
}
const COPY = eval('(' + src.slice(from, endIdx) + ')');

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const group = process.argv[2] || 'food_low';
const days = Number(process.argv[3] || 21);
const g = COPY[group];
if (!g) { console.log('没有这个键：' + group); process.exit(1); }

console.log(`=== ${group}（共 ${g.lines.length} 句）连续 ${days} 天的选句 ===`);
const used = {};
for (let d = 0; d < days; d++) {
  const dt = new Date(2026, 9, 1 + d); // 2026-10-01 起
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const dateKey = `${y}-${m}-${dd}`;
  const idx = hash(dateKey + ':' + group + ':0') % g.lines.length;
  used[idx] = (used[idx] || 0) + 1;
  const short = g.lines[idx].replace(/\{\w+\}/g, 'X');
  console.log(`${dateKey}  第${idx + 1}句  ${short.slice(0, 30)}${short.length > 30 ? '…' : ''}`);
}
console.log('\n分布：');
for (let n = 0; n < g.lines.length; n++) {
  console.log(`  第${n + 1}句  ${used[n] || 0} 次`);
}
