#!/usr/bin/env node
/**
 * 花哪儿了 · APK 资源同步
 *
 * 作用：一条命令把网页产物同步进安卓壳，并把版本号写进 build.gradle.kts
 * 用法：node android/sync-www.js
 *
 * 做的事：
 *   1. 跑 build-dist.js 重新生成 dist/（会同步升 sw.js 的 CACHE 与所有 ?v=）
 *   2. 从 sw.js 读版本号（唯一真源）
 *   3. 清空并拷贝 dist/ -> android/app/src/main/assets/www/
 *   4. 把 versionName / versionCode 写进 app/build.gradle.kts
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const wwwDir = path.join(__dirname, 'app', 'src', 'main', 'assets', 'www');
const gradleFile = path.join(__dirname, 'app', 'build.gradle.kts');

function step(msg) {
  console.log(`\n▶ ${msg}`);
}

// ---------- 1. 重新生成 dist ----------
step('重新生成 dist（build-dist.js）');
execFileSync(process.execPath, [path.join(root, 'build-dist.js')], {
  cwd: root,
  stdio: 'inherit',
});

if (!fs.existsSync(path.join(distDir, 'index.html'))) {
  console.error('✖ dist/index.html 不存在，构建失败');
  process.exit(1);
}

// ---------- 2. 读版本号 ----------
step('从 sw.js 读取版本号');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const m = sw.match(/CACHE\s*=\s*['"]jizhang-v([\d.]+)['"]/);
if (!m) {
  console.error('✖ 没在 sw.js 里找到 CACHE = "jizhang-vX.Y.Z"');
  process.exit(1);
}
const version = m[1];
const parts = version.split('.').map(Number);
while (parts.length < 3) parts.push(0);
const [major, minor, patch] = parts;
const versionCode = major * 10000 + minor * 100 + patch;
console.log(`  版本 ${version} → versionCode ${versionCode}`);

// ---------- 3. 拷贝资源 ----------
step('同步 dist → assets/www');
fs.mkdirSync(wwwDir, { recursive: true });

// 注意：这里不用「整目录删了重建」，而是覆盖 + 精准清理。
// 原因：一是快，二是避免误删（这个目录是构建产物，但删错代价高）。
fs.cpSync(distDir, wwwDir, { recursive: true, force: true });

// 清掉 dist 里已经不存在的旧文件（改了文件名/删了资源时会残留）
function relFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...relFiles(p, base));
    else out.push(path.relative(base, p));
  }
  return out;
}

const wanted = new Set(relFiles(distDir));
let removed = 0;
for (const rel of relFiles(wwwDir)) {
  if (!wanted.has(rel)) {
    fs.unlinkSync(path.join(wwwDir, rel));
    removed++;
  }
}
if (removed) console.log(`  清理旧文件 ${removed} 个`);

const countFiles = (d) => relFiles(d).length;
console.log(`  已同步 ${countFiles(wwwDir)} 个文件`);

// ---------- 4. 写版本号 ----------
step('更新 app/build.gradle.kts 的版本号');
let gradle = fs.readFileSync(gradleFile, 'utf8');
const before = gradle;
gradle = gradle.replace(/versionCode\s*=\s*\d+/, `versionCode = ${versionCode}`);
gradle = gradle.replace(/versionName\s*=\s*"[^"]*"/, `versionName = "${version}"`);
if (gradle === before) {
  console.warn('  ⚠ 版本号没变化（可能已是该版本）');
}
fs.writeFileSync(gradleFile, gradle);

// ---------- 5. 自检 ----------
const gv = fs.readFileSync(gradleFile, 'utf8');
const okName = gv.includes(`versionName = "${version}"`);
const okCode = gv.includes(`versionCode = ${versionCode}`);
if (!okName || !okCode) {
  console.error('✖ 版本号写入校验失败，请手动检查 build.gradle.kts');
  process.exit(1);
}

console.log(`\n✅ 同步完成：versionName=${version}  versionCode=${versionCode}`);
console.log('   下一步：cd android && gradlew.bat assembleRelease');
