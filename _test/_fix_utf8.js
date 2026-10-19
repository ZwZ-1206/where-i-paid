// 扫描并修复 sw.js / index.html 的 UTF-8 损坏：3 字节序列第 3 字节被替换为 0x3F。
// 报告所有坏点；若传 --fix 则把 E2 80 3F -> E2 80 94、E3 80 3F -> E3 80 82、
// E6 9C 3F -> E6 9C AC、E7 9A 3F -> E7 9A 84、E7 AC 3F -> E7 AC 94、E7 94 3F -> E7 94 A8
// （按上下文人工确认后映射；只修注释/文案，不动结构）。
const fs = require('fs');
const file = process.argv[2];
const fix = process.argv.includes('--fix');
const raw = fs.readFileSync(file);
const bad = [];
for (let i = 0; i < raw.length;) {
  const b = raw[i];
  if (b < 0x80) { i++; continue; }
  const need = b >= 0xF0 ? 3 : b >= 0xE0 ? 2 : b >= 0xC0 ? 1 : -99;
  if (need <= 0) { bad.push(i); i++; continue; }
  let ok = true;
  for (let j = 1; j <= need; j++) if (i + j >= raw.length || (raw[i + j] & 0xC0) !== 0x80) { ok = false; break; }
  if (!ok) { bad.push(i); i++; } else i += need + 1;
}
console.log(file, 'bad:', bad.length, bad.slice(0, 40));
if (fix) {
  const MAP = {
    'E2 80 3F': 0x94, // —
    'E3 80 3F': 0x82, // 。
    'E6 9C 3F': 0xAC, // 本
    'E7 9A 3F': 0x84, // 的
    'E7 AC 3F': 0x94, // 笔
    'E7 94 3F': 0xA8, // 用
    'E5 90 3F': 0xAB, // 含
  };
  let n = 0;
  for (const i of bad) {
    const key = [raw[i], raw[i + 1], raw[i + 2]].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
    if (MAP[key] !== undefined) { raw[i + 2] = MAP[key]; n++; }
  }
  fs.writeFileSync(file, raw);
  console.log('fixed', n, 'of', bad.length);
  // re-validate
  const t = raw.toString('utf8');
  console.log('utf8 now:', Buffer.compare(Buffer.from(t, 'utf8'), raw) === 0 ? 'ROUNDTRIP-OK(best-effort)' : 'check');
}
