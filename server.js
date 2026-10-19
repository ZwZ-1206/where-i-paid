#!/usr/bin/env node
/* ============================================================
 * 花哪儿了 · 本地服务器
 * 零依赖静态服务器：双击 start.bat 或运行 node server.js
 * 支持手机在同一 Wi-Fi 下访问（终端会打印局域网地址）
 * ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const url = require('url');
const zlib = require('zlib');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

// 文本类压缩收益明显；图片/字体本身已是压缩格式，省下的还不够 gzip 头，白费 CPU
const GZIP_EXT = new Set([
  '.js', '.mjs', '.css', '.html', '.htm', '.csv',
  '.svg', '.json', '.webmanifest', '.xml', '.txt', '.map',
]);
const GZIP_MIN = 1024; // 小于 1KB 收益低于成本

function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0].split('#')[0]);
  const clean = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(root, clean);
  return full.startsWith(root) ? full : root;
}

const server = http.createServer((req, res) => {
  let pathname = url.parse(req.url).pathname || '/';
  if (pathname === '/') pathname = '/index.html';

  let file = safeJoin(ROOT, pathname);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(ROOT, 'index.html');
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const name = path.basename(file).toLowerCase();
    // sw.js / index.html / manifest 必须每次校验，否则改了代码用户永远看不到
    const noCache = ext === '.html' || name === 'sw.js' || ext === '.webmanifest';
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': noCache ? 'no-cache, must-revalidate' : 'public, max-age=3600',
      'Service-Worker-Allowed': '/',
      // Vary 必须加：否则中间缓存会把压缩内容发给不支持 gzip 的客户端
      Vary: 'Accept-Encoding',
    };

    if (/\bgzip\b/.test(req.headers['accept-encoding'] || '') &&
        GZIP_EXT.has(ext) && data.length >= GZIP_MIN) {
      const gz = zlib.gzipSync(data);
      if (gz.length < data.length) { // 个别文件压完反而更大，就发原样
        headers['Content-Encoding'] = 'gzip';
        headers['Content-Length'] = gz.length;
        res.writeHead(200, headers);
        res.end(gz);
        return;
      }
    }

    res.writeHead(200, headers);
    res.end(data);
  });
});

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach((name) => {
    (nets[name] || []).forEach((net) => {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    });
  });
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  const lines = [
    '',
    '  ┌────────────────────────────────────────────┐',
    '  │           花哪儿了 · 本地服务器已启动           │',
    '  └────────────────────────────────────────────┘',
    '',
    `  电脑访问：  http://localhost:${PORT}`,
  ];
  lanAddresses().forEach((ip) => {
    lines.push(`  手机访问：  http://${ip}:${PORT}   （同一 Wi-Fi）`);
  });
  lines.push('');
  lines.push('  提示：手机上打开后，用浏览器菜单「添加到主屏幕」，');
  lines.push('       即可像原生 APP 一样全屏使用，断网也能记账。');
  lines.push('');
  lines.push('  按 Ctrl+C 停止服务');
  lines.push('');
  console.log(lines.join('\n'));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  端口 ${PORT} 已被占用。可换端口启动：\n    set PORT=8080 && node server.js\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
