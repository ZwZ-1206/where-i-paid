/* 一条命令发版：构建 → 部署 → 验证
 *
 *   node deploy.js                  # 按当前版本发一版
 *   node deploy.js --ver=1.19.0     # 先升版本再发
 *   node deploy.js --dry            # 只构建，不部署（看看产物）
 *   node deploy.js --no-verify      # 部署但不跑线上冒烟（冒烟会在生产 D1 建一个临时房间）
 *
 * 它做四件事，顺序不能反：
 *   1. 升版本（可选）—— 版本号只认 _test/bump.js，不手改
 *   2. build-site.js —— 打 dist、拷进 site/app、打 zip、注入版本与体积、自检
 *   3. wrangler pages deploy —— 官网 + App + Functions 一起上
 *   4. 验证 —— 健康检查、静态资源、SW 里的版本号、线上端到端冒烟
 *
 * 任何一步失败就非零退出，不会出现「部署了但其实是旧包」。
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PROJECT = 'where-i-paid';
const SITE = 'https://where-i-paid.pages.dev';

const args = process.argv.slice(2);
const has = (n) => args.includes('--' + n);
const opt = (n) => {
  const a = args.find((x) => x.startsWith('--' + n + '='));
  return a ? a.slice(n.length + 3) : null;
};

const dry = has('dry');
const noVerify = has('no-verify');
const verifyOnly = has('verify-only');   // 只验线上，不构建不部署
const wantVer = opt('ver');

function log(msg) { process.stdout.write(msg + '\n'); }
function step(msg) { process.stdout.write('\n▶ ' + msg + '\n'); }
function die(msg) { process.stderr.write('\n✗ ' + msg + '\n'); process.exit(1); }

function run(cmd, argv, opts) {
  const r = spawnSync(cmd, argv, Object.assign({ cwd: ROOT, stdio: 'inherit', shell: false }, opts || {}));
  if (r.status !== 0) die(`${cmd} ${argv.join(' ')} 退出码 ${r.status}`);
  return r;
}

function readVersion() {
  const s = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const m = /CACHE\s*=\s*'jizhang-v([\d.]+)'/.exec(s);
  if (!m) die('sw.js 里读不到 CACHE');
  return m[1];
}

async function get(urlPath) {
  // 不走代理：本机代理访问 pages.dev 会 522（见 SKILL.md 的坑）
  const r = await fetch(SITE + urlPath, { cache: 'no-store', headers: { 'user-agent': 'Mozilla/5.0 (deploy-check)' } });
  const body = await r.text();
  return { status: r.status, body };
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'build-site.js'))) die('不在项目根目录（找不到 build-site.js）');

  // ---- 1. 版本 ----
  if (wantVer) {
    step('升版本 → ' + wantVer);
    run(process.execPath, [path.join('_test', 'bump.js'), wantVer]);
  } else {
    step('校验版本一致性');
    run(process.execPath, [path.join('_test', 'bump.js'), '--check']);
  }
  const ver = readVersion();
  log('  当前版本 v' + ver);

  if (!verifyOnly) {
    // ---- 2. 构建 ----
    step('构建（dist → site/app → apk → zip → 注入 → 自检）');
    run(process.execPath, ['build-site.js']);

    if (dry) {
      log('\n✓ 只构建，已停在本地。产物在 dist/ 与 site/。');
      process.exit(0);
    }

    // ---- 3. 部署 ----
    step('部署到 Cloudflare Pages: ' + PROJECT);
    const before = Date.now();
    run('npx', ['wrangler', 'pages', 'deploy', 'site',
      '--project-name', PROJECT, '--branch', 'main', '--commit-dirty=true'], { shell: true });
    log('  用时 ' + Math.round((Date.now() - before) / 1000) + 's');

    if (noVerify) {
      log('\n✓ 已部署（跳过了验证）。地址：' + SITE + '/app/');
      process.exit(0);
    }
  }

  // ---- 4. 验证 ----
  step('验证线上');
  const fails = [];

  const health = await get('/api/couple/health');
  if (health.status !== 200 || !/"ok"\s*:\s*true/.test(health.body)) fails.push('健康检查 /api/couple/health → ' + health.status);
  else log('  ✓ /api/couple/health 200');

  const home = await get('/');
  if (home.status !== 200 || home.body.indexOf('花哪儿了') < 0) fails.push('官网首页异常 → ' + home.status);
  else log('  ✓ 官网首页 200');

  const app = await get('/app/');
  if (app.status !== 200 || app.body.indexOf('assets/js/app.js') < 0) fails.push('/app/ 不是应用页 → ' + app.status);
  else log('  ✓ /app/ 200');

  const sw = await get('/app/sw.js');
  if (sw.status !== 200) fails.push('/app/sw.js → ' + sw.status);
  else if (sw.body.indexOf('jizhang-v' + ver) < 0) fails.push('线上 sw.js 版本不是 v' + ver + '（部署没生效或被缓存）');
  else log('  ✓ /app/sw.js 版本 = v' + ver);

  if (!fails.length) {
    step('线上端到端冒烟（会建一个临时房间，跑完自删）');
    const env = Object.assign({}, process.env, { SYNC_BASE: SITE });
    const r = spawnSync(process.execPath, [path.join('_test', 'verify-sync-live.js')], {
      cwd: ROOT, stdio: 'inherit', env,
    });
    if (r.status !== 0) fails.push('线上冒烟失败（看上面的断言）');
  }

  if (fails.length) {
    process.stderr.write('\n✗ 部署完成但验证没过：\n  - ' + fails.join('\n  - ') + '\n');
    process.exit(1);
  }

  log('\n✓ 发版完成 v' + ver);
  log('  官网  ' + SITE + '/');
  log('  应用  ' + SITE + '/app/');
})().catch((e) => die(e && e.message ? e.message : String(e)));
