#!/usr/bin/env node
/* ============================================================
 * 花哪儿了 · 手机安装助手
 * 一键做两件事：
 *   1. 启动本地服务器（如果还没启动）
 *   2. 通过 HTTPS 隧道把它映射到公网，让手机能「真正安装」
 *
 * HTTPS 是关键：浏览器只在安全上下文（HTTPS 或 localhost）里
 * 才允许 Service Worker 与 PWA 安装。局域网 http://192.168.x.x
 * 只能「添加书签到桌面」，不是真安装。
 * ============================================================ */
'use strict';

const http = require('http');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PORT = Number(process.env.PORT) || 4173;
const ROOT = path.join(__dirname, '..');
const TOOLS = __dirname;

/* ---------- 小工具 ---------- */
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  green: '\x1b[32m', cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m',
};

function line(ch = '─', n = 54) { return ch.repeat(n); }
function banner(text) {
  console.log('');
  console.log(C.cyan + '  ╭' + line('─', 52) + '╮' + C.reset);
  console.log(C.cyan + '  │' + C.reset + C.bold + text.padEnd(52) + C.reset + C.cyan + '│' + C.reset);
  console.log(C.cyan + '  ╰' + line('─', 52) + '╯' + C.reset);
}

/* ---------- 1. 确认本地服务器在跑 ---------- */
function probe() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function ensureServer() {
  if (await probe()) {
    console.log(`  ${C.dim}本地服务器已在运行 :${PORT}${C.reset}`);
    return null;
  }
  console.log(`  ${C.dim}正在启动本地服务器 :${PORT} …${C.reset}`);
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, stdio: 'ignore', windowsHide: true,
  });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await probe()) {
      console.log(`  ${C.green}✓${C.reset} 本地服务器就绪`);
      return child;
    }
  }
  throw new Error('本地服务器启动失败');
}

/* ---------- 2. 打印二维码（用打包的 python + qrcode） ---------- */
function printQR(url) {
  const candidates = [
    process.env.PYTHON,
    path.join(process.env.USERPROFILE || '', '.dsh', 'dsh-runtimes',
      'dsh-primary-runtime', 'dependencies', 'python', 'python.exe'),
    'python', 'python3',
  ].filter(Boolean);

  const pyCode = `
import sys
try:
    import qrcode
except ImportError:
    sys.exit(3)
qr = qrcode.QRCode(border=1)
qr.add_data(${JSON.stringify(url)})
qr.make(fit=True)
m = qr.get_matrix()
pad = "  "
print()
for row in m:
    print(pad + "".join("  " if not c else "\\u2588\\u2588" for c in row))
print()
`;

  for (const py of candidates) {
    try {
      execFileSync(py, ['-c', pyCode], { stdio: 'inherit', windowsHide: true });
      return true;
    } catch (_) { /* 换下一个 */ }
  }
  return false;
}

/* ---------- 3. 主流程 ---------- */
(async () => {
  banner('花哪儿了 · 手机安装助手');

  let serverChild = null;
  let tunnel = null;

  const cleanup = () => {
    try { if (tunnel) tunnel.close(); } catch (_) {}
    try { if (serverChild) serverChild.kill(); } catch (_) {}
  };
  process.on('SIGINT', () => { console.log('\n  已停止。\n'); cleanup(); process.exit(0); });
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });

  try {
    serverChild = await ensureServer();
  } catch (e) {
    console.error(`  ${C.red}✗ ${e.message}${C.reset}`);
    process.exit(1);
  }

  let mod;
  try {
    mod = require(path.join(TOOLS, 'node_modules', 'tunnelmole'));
  } catch (_) {
    console.error(`\n  ${C.red}✗ 缺少隧道组件。${C.reset}`);
    console.error(`    请在本目录执行一次：`);
    console.error(`      pnpm add tunnelmole`);
    console.error(`    或把整个 _tools 目录连同 node_modules 一起保留。\n`);
    process.exit(1);
  }

  console.log(`  ${C.dim}正在建立 HTTPS 隧道 …${C.reset}`);

  let url;
  try {
    url = await mod.tunnelmole({ port: PORT });
  } catch (e) {
    console.error(`\n  ${C.red}✗ 隧道建立失败：${e.message}${C.reset}`);
    console.error(`    可能原因：网络受限 / 被代理拦截。`);
    console.error(`    退路：手机连同一 Wi-Fi 用局域网地址访问（只能加书签，不能真安装）。\n`);
    cleanup();
    process.exit(1);
  }

  const https = url.replace(/^http:/, 'https:');

  banner('✅  手机安装地址已就绪');
  console.log('');
  console.log(`  ${C.bold}${C.green}${https}${C.reset}`);
  console.log('');

  const gotQR = printQR(https);

  console.log(`  ${C.bold}手机怎么装（Android / 鸿蒙）${C.reset}`);
  console.log(`    1. 手机扫码或输入上面的网址（用 Chrome / Edge / 华为浏览器）`);
  console.log(`    2. 打开后等 1~2 秒，底部会弹出 ${C.bold}「安装应用 / 添加到主屏幕」${C.reset}`);
  console.log(`    3. 点它 → 桌面出现「花哪儿了」图标，点开是全屏 APP，${C.bold}断网也能用${C.reset}`);
  console.log('');
  console.log(`  ${C.bold}iPhone / iPad${C.reset}`);
  console.log(`    1. 用 ${C.bold}Safari${C.reset} 打开上面的网址（必须 Safari）`);
  console.log(`    2. 点底部 ${C.bold}分享按钮${C.reset} → ${C.bold}「添加到主屏幕」${C.reset}`);
  console.log(`    3. 桌面出现图标，点开即全屏运行`);
  console.log('');
  console.log(`  ${C.dim}──────────────────────────────────────────────────${C.reset}`);
  console.log(`  ${C.yellow}注意${C.reset}：这个公网地址是临时的，关掉窗口就失效。`);
  console.log(`  ${C.dim}装好之后，图标和数据都在手机上，不再需要这个地址。${C.reset}`);
  console.log(`  ${C.dim}地址每次启动会变，重新装需要重新扫码。${C.reset}`);
  if (!gotQR) {
    console.log(`  ${C.dim}（未能生成二维码，手动输入上面的网址即可）${C.reset}`);
  }
  console.log('');
  console.log(`  ${C.dim}按 Ctrl+C 关闭隧道${C.reset}`);
  console.log('');

  // 保持进程存活
  setInterval(() => {}, 1 << 30);
})();
