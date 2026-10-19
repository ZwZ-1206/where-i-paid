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
const APK_DIR = path.join(ROOT, 'dist-apk');

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

/* ---- 2.6 把 APK 也放到官网下载目录 ----
 *
 * 以前 APK 只挂在 GitHub Releases：国内打不开 GitHub 的人，连「检查更新」
 * 都给不出一条能走的路。现在官网自己托管安装包，版本清单里写清文件名，
 * App 的更新按钮直接指向自己的域名。GitHub 退回成「源码备份」，不再是下载通道。
 *
 * 找不到对应版本的 APK 时**不报错**：正常开发时可能只想发网页版。
 * 这时保留 GitHub 链接，并在结尾提示一句。
 */
function shipApk(ver) {
  const name = `whereipaid-v${ver}.apk`;
  const src = path.join(APK_DIR, name);
  if (!fs.existsSync(src)) {
    console.log('· APK 未找到（' + path.relative(ROOT, src) + '），官网继续指向 GitHub');
    return null;
  }
  fs.mkdirSync(DL, { recursive: true });
  // 只留当前这一版，避免下载目录越攒越大
  for (const f of fs.readdirSync(DL)) {
    if (f.endsWith('.apk') && f !== name) fs.unlinkSync(path.join(DL, f));
  }
  const dest = path.join(DL, name);
  fs.copyFileSync(src, dest);
  const bytes = fs.statSync(dest).size;

  // 版本清单补上安装包：App 读到它就直接给官网地址
  const vj = path.join(SITE, 'app', 'version.json');
  const j = JSON.parse(read(vj));
  j.apk = name;
  j.apkBytes = bytes;
  write(vj, JSON.stringify(j, null, 2) + '\n');

  console.log(`· APK → site/download/${name}  ${(bytes / 1048576).toFixed(2)} MB`);
  return { name, bytes };
}

/** 把首页那个「从 GitHub 下载 APK」换成官网自己的文件 */
function relinkApk(apk) {
  if (!apk) return 0;
  const mb = (apk.bytes / 1048576).toFixed(1) + ' MB';
  // 两种起点都要认：
  //   ① 第一次发版前的「从 GitHub 下载 APK」
  //   ② 已经指向官网、但版本号是上一版的那个按钮
  // 只匹配 ① 的话，第二次发版就改不动了（自检会报「出现别的版本号」）。
  const A = /<a class="btn btn--primary btn--wide" href="(?:https:\/\/github\.com\/ZwZ-1206\/where-i-paid\/releases\/latest|download\/whereipaid-v[\d.]+\.apk)"[^>]*>\s*(?:从 GitHub 下载 APK|下载 APK（[^）]*）)\s*<\/a>/;
  const B = '<a class="btn btn--primary btn--wide" href="download/' + apk.name + '" download>下载 APK（' + mb + '）</a>';
  let n = 0;
  for (const f of ['index.html', 'changelog.html']) {
    const p = path.join(SITE, f);
    if (!fs.existsSync(p)) continue;
    const s = read(p);
    if (!A.test(s)) continue;
    write(p, s.replace(A, B));
    n++;
  }
  return n;
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
function check(ver, bytes, apk) {
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

  // APK 一旦放进官网，就必须真的能下到，而且首页不能再把人往 GitHub 送
  if (apk) {
    if (!fs.existsSync(path.join(DL, apk.name))) problems.push(`APK 没落盘：${apk.name}`);
    const vj = JSON.parse(read(path.join(SITE, 'app', 'version.json')));
    if (vj.apk !== apk.name) problems.push(`version.json 的 apk 字段是「${vj.apk || '空'}」，不是 ${apk.name}`);
    if (html.indexOf('从 GitHub 下载 APK') >= 0) problems.push('首页还在写「从 GitHub 下载 APK」');
    if (html.indexOf('download/' + apk.name) < 0) problems.push('首页没有指向自己的 APK 文件');
  }
  return problems;
}

(function main() {
  buildApp();
  publishApp();
  const ver = version();   // 打包之后再取，避免 build-dist 顺带升版本导致页码落后一版
  console.log(`\n花哪儿了 · 官网构建  v${ver}\n`);
  const apk = shipApk(ver);
  const relinked = relinkApk(apk);
  const { out, bytes } = zipup(ver);
  const changed = inject(ver, bytes);
  const problems = check(ver, bytes, apk);

  console.log(`\n· zip   ${path.relative(ROOT, out)}  ${kb(bytes)}`);
  if (apk) console.log(`· APK   ${path.relative(ROOT, path.join(DL, apk.name))}  ${(apk.bytes / 1048576).toFixed(2)} MB（首页链接已指向官网）`);
  console.log(`· 注入  ${changed} 个 HTML 已更新${relinked ? '，' + relinked + ' 处 APK 链接改到官网' : ''}`);
  console.log(problems.length ? `\n✗ 自检未通过：\n  - ${problems.join('\n  - ')}` : '\n✓ 自检通过：版本与体积只有一处来源');
  console.log('\n下一步：npx wrangler pages deploy site --project-name where-i-paid');
  process.exit(problems.length ? 1 : 0);
})();
