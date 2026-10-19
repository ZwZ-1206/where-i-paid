/**
 * 版本号 bump。
 *
 * 旧版把 FROM/TO 都写死在文件里，跑过一次就过期，下次直接跑等于空转
 * （运维复盘：_test/bump.js:2 停在 1.13.0→1.13.1，而项目已经是 1.13.1）。
 * 现在改成：
 *   FROM 从 sw.js 的 CACHE 自动读，永远准
 *   TO   从命令行参数传，不传就自动 patch+1
 *   跑完自动校验 index.html 的 ?v= 与 sw.js 的 CACHE 是否全等，不等就非零退出
 *
 * 用法：
 *   node _test/bump.js            # 1.13.1 -> 1.13.2
 *   node _test/bump.js 1.14.0     # 指定版本
 *   node _test/bump.js --check    # 只校验，不改
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const IDX = path.join(ROOT, 'index.html');
const SW = path.join(ROOT, 'sw.js');

function readCache() {
  const s = fs.readFileSync(SW, 'utf8');
  const m = s.match(/CACHE\s*=\s*'jizhang-v([0-9]+\.[0-9]+\.[0-9]+)'/);
  if (!m) throw new Error('sw.js 里找不到 CACHE = \'jizhang-vX.Y.Z\'');
  return m[1];
}

function readTags() {
  const h = fs.readFileSync(IDX, 'utf8');
  const all = h.match(/\?v=([0-9]+\.[0-9]+\.[0-9]+)/g) || [];
  const set = {};
  all.forEach((t) => {
    const v = t.slice(3);
    set[v] = (set[v] || 0) + 1;
  });
  return { count: all.length, set };
}

/** 校验三处一致，返回 { ok, msg } */
function verify() {
  const cache = readCache();
  const tags = readTags();
  const versions = Object.keys(tags.set);
  const ok = versions.length === 1 && versions[0] === cache;
  let msg = 'sw.js CACHE : v' + cache + '\n';
  msg += 'index.html ?v= : ' + tags.count + ' 处';
  if (versions.length) msg += ' [' + versions.map((v) => 'v' + v + '×' + tags.set[v]).join(', ') + ']';
  msg += '\n';
  return { ok, msg, cache, tags };
}

function bump(from, to) {
  let h = fs.readFileSync(IDX, 'utf8');
  const n = h.split('?v=' + from).length - 1;
  h = h.split('?v=' + from).join('?v=' + to);
  fs.writeFileSync(IDX, h);

  let s = fs.readFileSync(SW, 'utf8');
  const before = s;
  s = s.split('jizhang-v' + from).join('jizhang-v' + to);
  fs.writeFileSync(SW, s);

  // 剥 BOM（PowerShell 有时会加）
  for (const f of [IDX, SW]) {
    const b = fs.readFileSync(f);
    if (b[0] === 0xef) {
      fs.writeFileSync(f, b.slice(3));
      console.log('stripped BOM:', path.basename(f));
    }
  }

  console.log('index.html query tags bumped: ' + n);
  console.log('sw.js changed: ' + (before !== s));
}

function nextPatch(v) {
  const p = v.split('.').map(Number);
  p[2] += 1;
  return p.join('.');
}

// ---- 主流程 ----
const arg = process.argv[2] || '';

if (arg === '--check') {
  const r = verify();
  console.log(r.msg);
  console.log(r.ok ? '✓ 版本号一致' : '✗ 版本号不一致');
  process.exit(r.ok ? 0 : 1);
}

const from = readCache();

if (arg) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(arg)) {
    console.error('版本号格式不对，要 x.y.z：' + arg);
    process.exit(2);
  }
}

const to = arg || nextPatch(from);

if (from === to) {
  console.log('当前已经是 v' + from + '，不用改');
  process.exit(0);
}

console.log('v' + from + '  ->  v' + to);
bump(from, to);

const r = verify();
console.log('\n' + r.msg);
if (!r.ok) {
  console.error('✗ 版本号不一致，检查 index.html 里有没有漏掉的 ?v= 或写错的版本');
  process.exit(1);
}
console.log('✓ 版本号一致');
