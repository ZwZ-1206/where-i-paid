/**
 * 测试用浏览器 profile 的统一出口。
 *
 * 为什么要有这个文件：
 * 以前 50 个测试脚本各自写 `path.join(__dirname, '.edge-xxx')`，把 Edge 的
 * 用户数据目录放在源码树里，跑完还不删。每个 profile 约 59 MB（大头是
 * component_crx_cache 里那个 12.86 MB 的 Edge 组件包），于是一轮回归下来
 * 源码目录凭空长出几百 MB，删掉还会在下一轮立刻回来。
 *
 * 现在统一走这里：目录落在系统临时目录，名字带进程号，进程退出时自动清理。
 *
 * 用法（三行）：
 *   const env = require('./_env');
 *   const PROFILE = env.profile('verify-couple');
 *   ...
 *   const proc = spawn(EDGE, [...env.edgeArgs(PORT, PROFILE), URL], { stdio: 'ignore' });
 *   ...
 *   await env.stop(proc);          // 关浏览器 + 删目录，必须在所有分支都调到
 *
 * 或者直接用 env.launch('verify-couple', PORT, URL)，它把 spawn 和参数都包了。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ROOT = path.join(os.tmpdir(), 'jizhang-edge');

/**
 * 同步等一会儿。
 *
 * 为什么不用 await：进程退出钩子里不能 await，而删目录必须在那里做完。
 * 只用来等文件句柄（Windows 上几百毫秒就够），不会长时间卡住。
 */
function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy wait */ }
}

/**
 * 删目录，失败重试。
 *
 * 历史坑（m03720）：`proc.kill()` 只杀 Edge 的入口进程，渲染进程 / GPU 进程
 * 还活着，profile 里的文件被它们攥着，`rmSync` 直接 EPERM/EBUSY。
 * 原来的代码把异常吞了，于是每跑一轮回归就在 %TEMP% 里留几十个目录 ——
 * 实测残留 298 MB，run-all 的收尾检查因此一直报 ✗。
 */
function rmDir(dir, tries) {
  if (!dir) return true;
  for (let i = 0; i < (tries || 8); i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) { /* 文件还被占用，等一下再试 */ }
    if (!fs.existsSync(dir)) return true;
    sleepSync(120);
  }
  return !fs.existsSync(dir);
}

/**
 * 杀进程树。Windows 上必须走 taskkill /T，否则 Edge 派生的子进程会活下来
 * 继续占着 profile（见上面 rmDir 的注释）。
 */
function killTree(proc) {
  if (!proc || !proc.pid) return;
  if (process.platform === 'win32') {
    try {
      // status 0 = 真的杀掉了；找不到进程 / 没权限都不算，交给下面的兜底
      const r = spawnSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      if (r && r.status === 0) return;
    } catch (e) { /* 退回到普通 kill */ }
  }
  try { proc.kill('SIGKILL'); } catch (e) {}
}

/** 收集本次进程建过的所有目录，退出时一把清掉 */
const created = [];
let hooked = false;

function hookExit() {
  if (hooked) return;
  hooked = true;
  const wipe = () => {
    created.forEach((d) => { rmDir(d, 4); });
  };
  process.on('exit', wipe);
  process.on('SIGINT', () => {
    wipe();
    process.exit(130);
  });
  process.on('uncaughtException', (e) => {
    console.error(e);
    wipe();
    process.exit(1);
  });
}

/**
 * 新建一个临时 profile 目录。
 * @param {string} name 套件名，只用来让目录可读，不参与去重
 * @returns {string} 绝对路径
 */
function profile(name) {
  hookExit();
  const safe = String(name || 'suite').replace(/[^a-zA-Z0-9_-]/g, '');
  const dir = path.join(ROOT, safe + '-' + process.pid + '-' + Date.now().toString(36));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  created.push(dir);
  return dir;
}

/**
 * Edge 的启动参数。把那些「每跑一次白烧 12.86 MB」的功能全关掉。
 * @param {number} port 调试端口
 * @param {string} profileDir profile 绝对路径
 * @param {object} extra 额外参数
 */
function edgeArgs(port, profileDir, extra) {
  const base = [
    '--headless=new',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profileDir,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-default-apps',
    '--disable-features=Translate,OptimizationHints,MediaRouter',
    '--metrics-recording-only',
    '--mute-audio',
    // m03610：Edge 除了 --user-data-dir 还会在 %TEMP% 根下散落
    // msedge_chrome_Unpacker_* / msedge_url_fetcher_* / HeadlessEdge* 一堆目录
    // （每次 1-20 MB），run-all 量「临时 profile 残留」时这些不算在 ROOT 里，
    // 但它们是这台机器上真实的垃圾。让 Edge 把缓存/临时文件都收进 profile，
    // 这样 stop() 删目录时一起带走。
    '--disk-cache-dir=' + path.join(profileDir, 'DiskCache'),
    '--crash-dumps-dir=' + path.join(profileDir, 'Crashpad'),
    '--disable-breakpad',
    '--disable-crash-reporter',
  ];
  return base.concat(extra || []);
}

/** 起一个浏览器 */
function launch(name, port, url, extra) {
  const dir = profile(name);
  const proc = spawn(EDGE, edgeArgs(port, dir, extra).concat([url]), { stdio: 'ignore' });
  proc.__profileDir = dir;
  return proc;
}

/**
 * 关掉浏览器并删目录。所有失败分支也必须走到这里，
 * 否则孤儿 msedge 进程会继续攥着几十 MB 内存。
 *
 * 顺序很关键：先杀整棵进程树 → 等它真的放开文件 → 再删。
 * 只 kill 父进程就删，在 Windows 上必然删不掉（见 rmDir 注释）。
 */
async function stop(proc, waitMs) {
  killTree(proc);
  await new Promise((r) => setTimeout(r, waitMs || 420));

  // env.launch 起的浏览器自带 __profileDir；套件自己 spawn 的没有，
  // 这时按「最后建的那个目录」收（每个套件只有一个 profile，见 run-all 清单）。
  let dir = proc && proc.__profileDir;
  if (!dir) {
    for (let i = created.length - 1; i >= 0; i--) {
      if (fs.existsSync(created[i])) { dir = created[i]; break; }
    }
  }
  if (!dir) return;

  for (let i = 0; i < 8; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) { /* 还被占用，重试 */ }
    if (!fs.existsSync(dir)) break;
    await new Promise((r) => setTimeout(r, 160));
  }
  const idx = created.indexOf(dir);
  if (idx >= 0 && !fs.existsSync(dir)) created.splice(idx, 1);
}

/** 名字里的 pid 还活着吗（`<套件名>-<pid>-<随机>`）。读不出来就当没有。 */
function ownerAlive(name) {
  const m = String(name).match(/-(\d+)-[a-z0-9]+$/i);
  if (!m) return true; // 不认识的目录别乱删
  const pid = Number(m[1]);
  if (!pid) return true;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/**
 * 兜底：把临时根目录里的残留清掉。
 * 两种都算残留：① 超过 15 分钟没动静的（单个套件最长也就一分钟）；② 建它的进程已经不在了。
 * 之前只认「超过 1 小时」，于是一轮里新留下的垃圾要等一小时才消失，run-all 的量尺一直报警。
 * 15 分钟这个数还带一层保护：万一 pid 被系统复用给了别的进程，时间也能兜住它。
 */
function sweep() {
  let names = [];
  try {
    names = fs.readdirSync(ROOT);
  } catch (e) {
    return 0;
  }
  const now = Date.now();
  const STALE_MS = 15 * 60 * 1000;
  let n = 0;
  names.forEach((nm) => {
    const p = path.join(ROOT, nm);
    try {
      const old = now - fs.statSync(p).mtimeMs > STALE_MS;
      if (old || !ownerAlive(nm)) {
        if (rmDir(p, 3)) n++;
      }
    } catch (e) {}
  });
  return n;
}

/** 当前临时根目录占多大（字节） */
function usage() {
  let total = 0;
  const walk = (d) => {
    let es = [];
    try {
      es = fs.readdirSync(d, { withFileTypes: true });
    } catch (e) {
      return;
    }
    es.forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        try {
          total += fs.statSync(p).size;
        } catch (x) {}
      }
    });
  };
  walk(ROOT);
  return total;
}

/**
 * 截图输出目录：系统临时目录，不进源码树。
 *
 * 以前 shoot-*.js / art-*.js 全写 `_test/shots`，一轮跑屏就是几十 MB 的 PNG
 * （单张 300–600KB，上百张，实测 _test 一度 42MB）。这些是纯产出物，
 * 看一眼就过期，没道理留在项目里被当成交付物、被 SW 缓存策略扫到。
 *
 * @param {string} name 子目录名，按套件分开放，方便一次跑多个脚本
 * @returns {string} 绝对路径（已创建）
 */
function shots(name) {
  const safe = String(name || 'shots').replace(/[^a-zA-Z0-9_-]/g, '');
  const dir = path.join(os.tmpdir(), 'jizhang-shots', safe);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { EDGE, ROOT, profile, edgeArgs, launch, stop, sweep, usage, shots, rmDir, killTree };
