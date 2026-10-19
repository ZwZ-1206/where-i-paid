/* 花哪儿了 · 打包发布
 * 只把「真正要传到网上的文件」复制到 dist/，避免把 _test/（几百 MB 的
 * 浏览器测试缓存）一起传上去。
 *
 * 用法：双击「打包发布.bat」，或 node build-dist.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'dist');

// 需要发布的顶层文件
const FILES = ['index.html', 'manifest.webmanifest', 'sw.js', '_routes.json'];
// 需要整目录发布的文件夹
const DIRS = ['assets'];

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dest, stat) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d, stat);
    else {
      fs.copyFileSync(s, d);
      stat.count++;
      stat.bytes += st.size;
    }
  }
}

(function main() {
  rmrf(OUT);
  fs.mkdirSync(OUT, { recursive: true });

  const stat = { count: 0, bytes: 0 };

  for (const f of FILES) {
    const s = path.join(ROOT, f);
    if (!fs.existsSync(s)) {
      console.error('  缺少文件：' + f);
      process.exit(1);
    }
    fs.copyFileSync(s, path.join(OUT, f));
    stat.count++;
    stat.bytes += fs.statSync(s).size;
  }
  for (const d of DIRS) {
    const s = path.join(ROOT, d);
    if (fs.existsSync(s)) copyDir(s, path.join(OUT, d), stat);
  }

  // 顺手校验：sw.js 的 CACHE 名和 index.html 的 ?v= 是否一致
  const sw = fs.readFileSync(path.join(OUT, 'sw.js'), 'utf8');
  const m = /CACHE\s*=\s*['"]([^'"]+)['"]/.exec(sw);
  const cacheName = m ? m[1] : '';
  const version = cacheName.replace(/^jizhang-/, '').replace(/^v/, '');
  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  const verSet = new Set((html.match(/\?v=([0-9A-Za-z.\-]+)/g) || []).map((x) => x.slice(3)));

  // 给 APK / 网页的「检查更新」用：这是唯一可靠的版本来源。
  // APK 壳里加载的是本地文件，没法知道线上有没有新版；GitHub API 在国内又常常连不上，
  // 所以由我们的官网提供 /app/version.json，客户端先读它，GitHub 只作兜底。
  fs.writeFileSync(
    path.join(OUT, 'version.json'),
    JSON.stringify({ app: version || '', built: new Date().toISOString() }, null, 2) + '\n'
  );
  stat.count++;
  stat.bytes += fs.statSync(path.join(OUT, 'version.json')).size;

  console.log('');
  console.log('  打包完成 → dist\\');
  console.log('  文件 ' + stat.count + ' 个，共 ' + (stat.bytes / 1024).toFixed(0) + ' KB');
  console.log('  版本号（sw.js）: ' + (version ? 'v' + version : '读不到'));
  console.log('  index.html 里的 ?v=: ' + (verSet.size ? Array.from(verSet).join(', ') : '无'));

  if (!version) {
    console.log('');
    console.log('  ⚠ sw.js 里没找到 CACHE 版本号，发布前请检查。');
  } else {
    const bad = Array.from(verSet).filter((v) => v !== version);
    if (bad.length) {
      console.log('');
      console.log('  ⚠ 版本号不一致：sw.js 是 v' + version + '，index.html 里有 ' + bad.join(', '));
      console.log('    两边必须一样，否则用户拿不到新脚本。');
    } else if (!verSet.size) {
      console.log('');
      console.log('  ⚠ index.html 里没有 ?v= 版本号，浏览器可能继续用旧缓存。');
    } else {
      console.log('  ✓ 版本号一致');
    }
  }

  console.log('');
  console.log('  下一步：把 dist 文件夹整个拖进 Cloudflare Pages / Vercel / Netlify，');
  console.log('  或者上传到你自己的服务器（国内服务器需要域名已备案）。');
  console.log('');
  console.log('  注意：不要直接上传整个项目文件夹 —— _test/ 是测试脚本，不是发布内容。');
  console.log('');
})();
