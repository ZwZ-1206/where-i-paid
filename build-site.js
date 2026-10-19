/* 花哪儿了 · 官网构建
 *
 *   node build-site.js
 *
 * 做四件事，顺序不能反：
 *   1. 跑 build-dist.js，把 App 打进 dist/
 *   2. 把 dist/ 打成 site/download/huanaer-<版本>.zip（根目录直接是 index.html）
 *   3. 回读 zip 体积，把 {{版本}} 与 {{体积}} 写进 site 的 HTML
 *   4. 打印构建结果
 *
 * 为什么要"先打包后注入"：体积是产物的属性，先写死再打包，
 * 页面上标的数字和用户下到的东西永远是两回事（v1.3 就把 529 KB 写成了 1.2 MB）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const SITE = path.join(ROOT, 'site');
const DIST = path.join(ROOT, 'dist');
const DL = path.join(SITE, 'download');

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s);

/* ---- 1. 版本号：唯一来源是 sw.js 的 CACHE ---- */
function version() {
  const m = /CACHE\s*=\s*['"]([^'"]+)['"]/.exec(read(path.join(ROOT, 'sw.js')));
  if (!m) throw new Error('sw.js 里读不到 CACHE');
  return m[1].replace(/^jizhang-/, '').replace(/^v/, '');
}

/* ---- 2. 打 App 包 ---- */
function buildApp() {
  console.log('· build-dist.js');
  execFileSync(process.execPath, [path.join(ROOT, 'build-dist.js')], { stdio: 'inherit' });
}

/* ---- 2.5 把 App 一起发到 /app/：一个域名，官网在根、应用在子目录 ---- */
function publishApp() {
  const APP = path.join(SITE, 'app');
  fs.rmSync(APP, { recursive: true, force: true });
  // 直接递归拷 dist/：App 里全是相对路径（./assets/…），放到 /app/ 下天然成立，
  // manifest 的 start_url 与 SW 的 scope 都会自动落在 /app/
  fs.cpSync(DIST, APP, { recursive: true });
  // Pages 的 Functions 只该拦 /api/*，其它一律走静态；没有这个文件所有请求都会过一遍函数
  fs.writeFileSync(
    path.join(SITE, '_routes.json'),
    JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] }, null, 2) + '\n'
  );
  console.log('· App → site/app/');
}

/* ---- 3. 打 zip：根目录必须直接是 index.html（D-08） ---- */
function zipup(ver) {
  fs.mkdirSync(DL, { recursive: true });
  for (const f of fs.readdirSync(DL)) if (f.endsWith('.zip')) fs.unlinkSync(path.join(DL, f));
  const out = path.join(DL, `huanaer-${ver}.zip`);
  console.log('· 打包 zip');
  execFileSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `Compress-Archive -Path '${path.join(DIST, '*')}' -DestinationPath '${out}' -CompressionLevel Optimal -Force`,
  ], { stdio: 'ignore' });
  if (!fs.existsSync(out)) throw new Error('zip 没生成');
  return { out, bytes: fs.statSync(out).size };
}

const kb = (n) => `${Math.round(n / 1024)} KB`;

/* ---- 4. 注入：版本与体积只在这里出现 ---- */
function inject(ver, bytes) {
  const files = ['index.html', 'privacy.html', 'changelog.html'];
  let changed = 0;
  for (const f of files) {
    const p = path.join(SITE, f);
    let s = read(p);
    const before = s;
    s = s.replace(/(data-build="version"[^>]*>)[^<]*(<)/g, `$1v${ver}$2`);
    s = s.replace(/(data-build="size"[^>]*>)[^<]*(<)/g, `$1${kb(bytes)}$2`);
    // 注意 `v?`：第一次注入会把 v 去掉，之后若不兼容两种写法，文件名就永远停在旧版本
    s = s.replace(/huanaer-v?[\d.]+\.zip/g, `huanaer-${ver}.zip`);
    if (s !== before) { write(p, s); changed++; }
  }
  return changed;
}

/* ---- 5. 自检：页面上不许出现第二个版本号/体积 ---- */
function check(ver, bytes) {
  const html = read(path.join(SITE, 'index.html'));
  const problems = [];
  const vers = [...html.matchAll(/v(\d+\.\d+\.\d+)/g)].map((m) => m[1]);
  if (vers.some((v) => v !== ver)) problems.push(`index.html 里出现了别的版本号：${[...new Set(vers)]}`);
  const sizes = [...html.matchAll(/(\d+)\s*KB/g)].map((m) => +m[1]);
  if (sizes.some((n) => Math.abs(n - bytes / 1024) / (bytes / 1024) > 0.1)) {
    problems.push(`体积文案与实物差超过 10%：${sizes} vs ${kb(bytes)}`);
  }
  if (!fs.existsSync(path.join(SITE, 'assets', 'shots', 'shot-home.webp'))) problems.push('缺首屏截图');
  // App 必须真的在 /app/ 下，而且它的入口和 SW 都得在
  for (const f of ['app/index.html', 'app/sw.js', 'app/manifest.webmanifest', '_routes.json']) {
    if (!fs.existsSync(path.join(SITE, f))) problems.push(`缺 ${f}（App 没发布到 /app/）`);
  }
  // 页面指向的 zip 必须真的存在——否则用户点下载会拿到一张 HTML（Pages 会回落到首页）
  const zips = [...new Set([...html.matchAll(/huanaer-v?[\d.]+\.zip/g)].map((m) => m[0]))];
  for (const z of zips) {
    if (!fs.existsSync(path.join(SITE, 'download', z))) problems.push(`页面指向的 ${z} 不存在（实际是 ${fs.readdirSync(path.join(SITE, 'download')).join(', ')}）`);
  }
  return problems;
}

(function main() {
  buildApp();
  publishApp();
  const ver = version();   // 打包之后再取，避免 build-dist 顺带升版本导致页码落后一版
  console.log(`\n花哪儿了 · 官网构建  v${ver}\n`);
  const { out, bytes } = zipup(ver);
  const changed = inject(ver, bytes);
  const problems = check(ver, bytes);

  console.log(`\n· zip   ${path.relative(ROOT, out)}  ${kb(bytes)}`);
  console.log(`· 注入  ${changed} 个 HTML 已更新`);
  console.log(problems.length ? `\n✗ 自检未通过：\n  - ${problems.join('\n  - ')}` : '\n✓ 自检通过：版本与体积只有一处来源');
  console.log('\n下一步：npx wrangler pages deploy site --project-name where-i-paid');
  process.exit(problems.length ? 1 : 0);
})();
