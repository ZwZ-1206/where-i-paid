/**
 * 唯一回归入口。
 *
 * 以前 74 个脚本散在 _test 下，靠人记得跑哪几个；一次性脚本和正式套件混在一起。
 * 现在只用这一条命令：
 *   node _test/run-all.js
 *
 * 它做四件事：
 *   1. 串行跑完所有回归套件（顺序固定，各自独立进程、独立浏览器 profile）
 *   2. 解析每个套件的「通过 N / M」，汇总断言总数
 *   3. 结束时打印临时 profile 目录的占用体积，超标直接报警（运维指标：必须接近 0）
 *   4. 任何套件红 / 断言总数不等于基线，非零退出
 *
 * 加 --fast 只跑逻辑单测和两个核心 verify；加 --only=名字 跑单个。
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const env = require('./_env');

/**
 * 回归需要的两个静态服务器端口。
 *
 * 历史坑：套件里一半写死 4173、一半写死 4180，但 run-all 自己一个都不起。
 * 于是只要事先没手动开满两个端口，那批套件就会因为页面拿不到 App 而
 * 报「0 / 0」——看起来像语法错，实际是服务器没起。这里统一兜底：
 * 已有人在监听就复用，没有就自己起一个，跑完（含异常退出）再关掉。
 */
const PORTS = [4173, 4180];
const servers = [];

function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.setTimeout(800, () => { s.destroy(); resolve(false); });
  });
}

async function ensureServers() {
  for (const port of PORTS) {
    if (await portOpen(port)) {
      console.log('  复用已在监听的 ' + port);
      continue;
    }
    const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
      cwd: path.join(__dirname, '..'),
      env: Object.assign({}, process.env, { PORT: String(port) }),
      stdio: 'ignore',
    });
    servers.push(p);
    let ok = false;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 120));
      if (await portOpen(port)) { ok = true; break; }
    }
    if (!ok) {
      console.error('\n✗ 端口 ' + port + ' 起不来，回归无法进行');
      stopServers();
      process.exit(1);
    }
    console.log('  已启动静态服务器 ' + port);
  }
}

function stopServers() {
  servers.forEach((p) => { try { p.kill(); } catch (e) {} });
  servers.length = 0;
}
process.on('exit', stopServers);
process.on('SIGINT', () => { stopServers(); process.exit(130); });

/** 回归套件清单。改这里就是改「什么算回归」。 */
const SUITES = [
  'run-logic.js',
  'verify-sync-crypto.js',
  'verify-sync-queue.js',
  'verify-sync-merge.js',
  'verify-sync-server.js',
  'verify-sync-converge.js',
  'e2e.js',
  'verify-couple.js',
  'verify-cplife.js',
  'verify-bank-csv.js',
  'verify-funds.js',
  'verify-goal-date.js',
  'verify-fresh.js',
  'verify-new.js',
  'verify-tip-ui.js',
  'verify-ai-ui.js',
  'verify-datepicker.js',
  'verify-tz.js',
  'verify-fix2.js',
  'verify-fix3.js',
  'verify-batch2.js',
  'verify-bday.js',
  'art-probe.js',
  'art-favor.js',
  'verify-favor-add.js',
  'art-cfa.js',
  'verify-offline-local.js',
  'verify-sync-ui.js',
  'verify-sync-store.js',
];

/**
 * 基线断言数。运维指标：低于这个数就必须解释原因。
 * 2026-10 从 714 → 771：
 *   run-logic     +12（退款净额 / 来自 TA 的偏爱 / 红包分类）
 *   verify-couple +1 （账单页没有收入筛选，原来的两项收入筛选改成一项）
 *   verify-funds  24（「去情侣页看看」那块路标改成验它不该存在，项数不变）
 *   verify-batch2 +38（新套件：删除刷新 / 目标页 / 设置页 / 只记支出 / 退款 / 偏爱）
 *
 * 2026-10 从 771 → 836：
 *   verify-bday +12（新套件：开通页双方生日 / 日历上的生日小字 / 翻月跨年不卡死）
 *   art-probe   +30（美工验收：日历纸面 / 红包图标 / 同城异地一屏 / 偏爱卡）
 *   art-favor   +13（偏爱卡与记账弹层的红包提示）
 *   art-cfa     +20（「这笔情侣账」弹层重排 + 改完当场刷新）
 *
 * 2026-10 从 836 → 864：
 *   run-logic     +2（红包次数统计 / 归属兜底）
 *   verify-couple +10（点月份选月 ×3；弹层无标题 / 收了一笔是按钮 / 选完某天真的落到那天 / 选中印章居中 / 日历补记 ×3）
 *   verify-favor-add +7（重写：弹层没有方向选择 / 退款按净额 / 退款不单独成行）
 *   verify-batch2 +3（赞助页：收款码能加载 / 尺寸正常 / 文案改成「只有情侣账上云」）
 *   顺手补了退出码检查：套件中途抛异常但 finally 里 exit(0) 的假绿不再算通过。
 *
 * 2026-10 从 864 → 1012（双人同步 M1）：
 *   verify-sync-crypto   +23（HKDF 双子键 / AAD / IV / 篡改 / 手抄容错）
 *   verify-sync-queue    +42（outbox 合并 / 上限 / 离线 / 批量 50 / join）
 *   verify-sync-merge    +20（只按 seq / 墓碑 / 乱序 / 脏数据）
 *   verify-sync-server   +41（auth 401 / 幂等 / create / 抢注 409 / pull 分页 / 真删）
 *   verify-sync-converge +22（200 轮随机交错 + 删改冲突 + 换机恢复）
 *   verify-sync-ui       +25（M2：同步灯三态 / 配对面板 / 拼接校验 / 再看一次 / 解除）
 *   verify-sync-store    +21（M2：记/改/删、基金、资料、换本/关本/删本 都真的入队）
 *   前五个纯 Node（真 Functions + node:sqlite）；UI 与 store 两个用 Edge。
 *
 * 2026-10 从 1012 → 1077：
 *   （中间 1059 那版漏记在这里，实际是 sync-live / 协议 v3 那一轮）
 *   verify-sync-ui +7（「TA 刚记了 N 笔」：不出现 / 出现 / 位置 / 累加改口径 / 点击进账单 / 账单页不累计）；
 *   顺带修了 verify-sync-converge 的一条假红：查子串 'note' 会被 base64 随机拼出来。
 */
const BASELINE = 1130;
const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith('--only=')) || '').slice(7);
const fast = args.indexOf('--fast') >= 0;

function runSuite(file) {
  return new Promise((resolve) => {
    const p = path.join(__dirname, file);
    if (!fs.existsSync(p)) return resolve({ file, pass: 0, total: 0, out: '文件不存在', ms: 0 });
    const t0 = Date.now();
    const proc = spawn(process.execPath, [p], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (out += d.toString()));
    proc.on('close', (code) => {
      const ms = Date.now() - t0;
      // 取最后一条计数行。两种写法都得认：
      //   正式套件：通过 12 / 12
      //   美工探针：通过 30 / 失败 0   ← 分子是「通过数」，分母是「失败数」
      const N = [...out.matchAll(/通过\s+(\d+)\s*\/\s*(\d+)/g)];
      const F = [...out.matchAll(/通过\s+(\d+)\s*\/\s*失败\s+(\d+)/g)];
      const lastF = F.length ? F[F.length - 1] : null;
      let pass = 0;
      let total = 0;
      if (lastF) {
        pass = Number(lastF[1]);
        total = pass + Number(lastF[2]);
      } else if (N.length) {
        pass = Number(N[N.length - 1][1]);
        total = Number(N[N.length - 1][2]);
      }
      // 退出码也要看：有套件把「打印计数 + process.exit」写在 finally 里，
      // 中途抛异常时计数只统计到一半就退 0，光看「通过 N / N」会以为全绿
      // （verify-favor-add 就这样假绿过：实际 9 条断言只跑了 5 条）。
      resolve({ file, pass, total, out, ms, code: typeof code === 'number' ? code : 1 });
    });
  });
}

(async () => {
  let list = SUITES;
  if (only) list = SUITES.filter((s) => s.indexOf(only) >= 0);
  if (fast) {
    list = ['run-logic.js', 'verify-couple.js', 'verify-fresh.js',
      'verify-sync-crypto.js', 'verify-sync-queue.js', 'verify-sync-merge.js'];
  }

  // 开工前扫一遍上次崩溃留下的残留
  const swept = env.sweep();
  if (swept) console.log('清掉 ' + swept + ' 个上次残留的 profile 目录\n');

  console.log('回归套件：' + list.length + ' 个\n');
  await ensureServers();
  console.log('');
  const results = [];
  for (const s of list) {
    process.stdout.write(('  ' + s).padEnd(30));
    const r = await runSuite(s);
    results.push(r);
    const ok = r.total > 0 && r.pass === r.total && r.code === 0;
    console.log(
      (ok ? '✓ ' : '✗ ') + String(r.pass) + '/' + String(r.total) + '   ' + (r.ms / 1000).toFixed(1) + 's'
      + (r.code === 0 ? '' : '   退出码 ' + r.code)
    );
    if (!ok) {
      const red = (r.out.match(/^\s*❌.*$/gm) || []).slice(0, 8);
      red.forEach((line) => console.log('      ' + line.trim()));
    }
  }

  const pass = results.reduce((a, r) => a + r.pass, 0);
  const total = results.reduce((a, r) => a + r.total, 0);
  const red = results.filter((r) => r.total === 0 || r.pass !== r.total);

  console.log('\n' + '-'.repeat(52));
  console.log('断言合计 : ' + pass + ' / ' + total + '   套件 ' + results.length + ' 个');
  console.log('基线     : ' + BASELINE + (total >= BASELINE ? '  ✓'
    : ((only || fast) ? '  （过滤模式不校验）' : '  ✗ 低于基线，需说明原因')));

  // 运维指标：临时 profile 必须自清理干净
  //
  // 注意这里有几百毫秒的窗口：最后一个套件的 Edge 进程刚退出，
  // 文件句柄还没释放，立刻 stat 会把「正在关闭」读成「泄漏」。
  // 所以先等一拍、再扫一次死进程的目录，然后才量 —— 这不放水，
  // 真泄漏（进程还活着）sweep 是扫不掉的，照样会被算进 usage。
  await new Promise((r) => setTimeout(r, 1500));
  const lateSwept = env.sweep();
  if (lateSwept) console.log('  收尾清理 ' + lateSwept + ' 个已退出的 profile 目录');
  const usage = env.usage();
  console.log('临时 profile 残留 : ' + (usage / 1024 / 1024).toFixed(1) + ' MB' + (usage < 5 * 1024 * 1024 ? '  ✓' : '  ✗ 有目录没清掉'));

  // 源码目录里不该再有 .edge-*
  const dirty = fs.readdirSync(__dirname).filter((f) => f.startsWith('.edge'));
  console.log('源码目录 .edge-* : ' + dirty.length + ' 个' + (dirty.length === 0 ? '  ✓' : '  ✗ ' + dirty.join(', ')));

  if (red.length) {
    console.log('\n✗ 失败套件：' + red.map((r) => r.file).join(', '));
    process.exit(1);
  }
  if (total < BASELINE) {
    // 用 --only / --fast 只跑一部分时，总数当然低于基线 —— 那是调试模式，不算失败。
    // 只有「跑满 20 个套件却比基线少」才是真问题（有套件被误删 / 断言被删）。
    if (only || fast) {
      console.log('\n（过滤模式：只跑了部分套件，不校验基线 ' + BASELINE + '）');
    } else {
      console.log('\n✗ 断言总数低于基线 ' + BASELINE);
      process.exit(1);
    }
  }
  if (usage >= 5 * 1024 * 1024 || dirty.length) {
    console.log('\n✗ 临时文件没清干净');
    process.exit(1);
  }
  console.log('\n✓ 全部通过');
  // 必须显式收尾：只要有端口是 run-all 自己起的，那个 server 子进程就一直挂在
  // 事件循环上，「自然退出」永远等不到 —— process.on('exit') 里的 stopServers
  // 也就永远不会执行（实测会一直挂到手动 Ctrl+C，看起来像回归卡死）。
  stopServers();
  process.exit(0);
})();
