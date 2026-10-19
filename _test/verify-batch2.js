/**
 * 这一批六条改动的验证（DOM 探针，不靠看截图）。
 *
 *   1. 历史账本「永久删除」成功后列表立刻变（不再要退出去重进）
 *   2. 「目标」页不再有「两个人的钱在「情侣」栏」那块提示
 *   3. 设置页不再有「添加到主屏幕」
 *   4. 设置页出现「赞助作者」，点开是一屏内容、微信收款码能显示、文案与实际数据口径一致
 *   5. 情侣账本只记支出：账单页没有「收入」筛选、记账弹层没有支出/收入切换
 *   6. 退款按净额算、红包进基金不进列表
 */
const path = require('path');
const env = require('./_env');
const { spawn } = require('child_process');

const EDGE = env.EDGE;
const PORT = 9431;
const PROFILE = env.profile('batch2');
const URL = 'http://127.0.0.1:4180/index.html';

let pass = 0;
let fail = 0;
const failed = [];

function ok(name, cond, extra) {
  if (cond) { pass += 1; console.log('  ✓ ' + name); }
  else { fail += 1; failed.push(name); console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const proc = spawn(EDGE, [
    '--headless=new',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--disable-extensions', '--disable-component-update',
    '--disable-background-networking', '--disable-sync',
    '--window-size=390,844',
    'about:blank',
  ], { stdio: 'ignore' });

  let ws = null;
  try {
    let ver = null;
    for (let i = 0; i < 60; i += 1) {
      try {
        ver = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json();
        break;
      } catch (e) { await sleep(250); }
    }
    if (!ver) throw new Error('CDP 没起来');

    ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

    let id = 0;
    const waits = new Map();
    const events = [];
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && waits.has(d.id)) { waits.get(d.id)(d); waits.delete(d.id); }
      else if (d.method) events.push(d);
    };
    const send = (method, params, sessionId) => new Promise((res) => {
      id += 1;
      const myId = id;
      waits.set(myId, res);
      ws.send(JSON.stringify({ id: myId, method, params: params || {}, sessionId }));
    });

    const tg = await send('Target.getTargets');
    const page = tg.result.targetInfos.find((t) => t.type === 'page');
    const att = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    const sid = att.result.sessionId;

    await send('Page.enable', {}, sid);
    await send('Runtime.enable', {}, sid);
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
    }, sid);
    await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' }, sid);

    const evalJs = async (expr) => {
      const r = await send('Runtime.evaluate', {
        expression: '(async () => { ' + expr + ' })()',
        awaitPromise: true, returnByValue: true,
      }, sid);
      if (r.result && r.result.exceptionDetails) {
        throw new Error(JSON.stringify(r.result.exceptionDetails.exception || r.result.exceptionDetails));
      }
      return r.result && r.result.result ? r.result.result.value : undefined;
    };

    await send('Page.navigate', { url: URL }, sid);
    await sleep(2000);

    // 先清空，造一份干净数据
    await evalJs(`
      const S = window.Store;
      S.clearAll(false);
      window.App.refresh();
      return 1;
    `);
    await sleep(400);

    // =========================================================
    console.log('\n=== 1. 历史账本永久删除后立刻消失 ===');
    await evalJs(`
      const S = window.Store;
      S.clearAll(false);
      S.enableCouple({
        meName: '阿甲', peerName: '阿乙', mode: 'local',
        togetherSince: '2024-05-20',
        consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}
      });
      S.cpAddTx({ amount: 3000, catId: 'food', attrib: 'me' });
      window.App.go('couple');
      const v = document.querySelector('.view[data-view="couple"]');
      window.ViewCouple.setPage('home');
      window.ViewCouple.render(v);
      return 1;
    `);
    await sleep(400);

    // 造两本历史账本：关掉当前这本 + 再开一本再关
    const bookCount = await evalJs(`
      const S = window.Store;
      S.startNewCpBook({ meName: '阿甲', peerName: '阿丙', mode: 'local', togetherSince: '2025-01-01' });
      S.enableCouple({ meName: '阿甲', peerName: '阿丙', mode: 'local', togetherSince: '2025-01-01' });
      S.cpAddTx({ amount: 5000, catId: 'fun', attrib: 'peer' });
      S.closeCouple('pause');
      S.startNewCpBook({ meName: '阿甲', peerName: '阿丁', mode: 'local', togetherSince: '2025-06-01' });
      S.enableCouple({ meName: '阿甲', peerName: '阿丁', mode: 'local', togetherSince: '2025-06-01' });
      S.cpAddTx({ amount: 8000, catId: 'travel', attrib: 'both' });
      const v = document.querySelector('.view[data-view="couple"]');
      window.ViewCouple.render(v);
      return { books: S.cpBooks().length, active: S.cpActiveId() };
    `);
    console.log('    账本数 = ' + bookCount.books + '，当前 = ' + bookCount.active);
    ok('造出多本账本', bookCount.books >= 3, JSON.stringify(bookCount));

    // 打开历史账本
    const opened = await evalJs(`
      const v = document.querySelector('.view[data-view="couple"]');
      const link = v.querySelector('.cp-hist-link');
      if (!link) return { err: 'no .cp-hist-link' };
      const label = link.textContent.trim();
      link.click();
      await new Promise((r) => setTimeout(r, 400));
      const rows = document.querySelectorAll('#sheet-root .cpb-item');
      return { label, rows: rows.length, dels: document.querySelectorAll('#sheet-root [data-del]').length };
    `);
    console.log('    入口文案 = ' + opened.label + '，行数 = ' + opened.rows);
    ok('历史账本里有账本', opened.rows >= 2, JSON.stringify(opened));
    ok('每行都带「永久删除」', opened.dels === opened.rows, opened.dels + ' vs ' + opened.rows);

    // 删除第一本
    const afterDel = await evalJs(`
      const dels = document.querySelectorAll('#sheet-root [data-del]');
      const targetId = dels[0].getAttribute('data-del');
      dels[0].click();
      await new Promise((r) => setTimeout(r, 400));
      // 第一关：点「删除」
      const next = document.querySelector('#sheet-root [data-cq="next"]');
      if (!next) return { err: 'no confirm-1' };
      next.click();
      await new Promise((r) => setTimeout(r, 500));
      // 第二关：输入「删除」
      const inp = document.querySelector('#sheet-root #cpq-del-input');
      const go = document.querySelector('#sheet-root #cpq-del-go');
      if (!inp || !go) return { err: 'no confirm-2' };
      const beforeRows = document.querySelectorAll('#sheet-root .cpb-item').length;
      const beforeDisabled = go.disabled;
      inp.value = '删除';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      const afterDisabled = go.disabled;
      go.click();
      await new Promise((r) => setTimeout(r, 600));
      const afterRows = document.querySelectorAll('#sheet-root .cpb-item').length;
      const stillThere = !!document.querySelector('#sheet-root [data-del="' + targetId + '"]');
      const linkNow = (document.querySelector('.view[data-view="couple"] .cp-hist-link') || {}).textContent || '';
      const sheetOpen = !!document.querySelector('#sheet-root .sheet');
      return {
        targetId, beforeRows, afterRows, stillThere, beforeDisabled, afterDisabled,
        link: linkNow.trim() || '(首页此刻不在情侣页，稍后单独验)', linkPresent: !!linkNow.trim(),
        sheetOpen,
        books: window.Store.cpBooks().length,
      };
    `);
    console.log('    beforeRows=' + afterDel.beforeRows + ' afterRows=' + afterDel.afterRows
      + ' 仍在=' + afterDel.stillThere + ' 入口=' + afterDel.link);
    ok('删之前输入框是禁用的', afterDel.beforeDisabled === true, String(afterDel.beforeDisabled));
    ok('打了「删除」两个字后按钮才可用', afterDel.afterDisabled === false, String(afterDel.afterDisabled));
    ok('删除后行数立刻少一行', afterDel.afterRows === afterDel.beforeRows - 1,
      afterDel.beforeRows + ' → ' + afterDel.afterRows);
    ok('删除后那一行立刻不见了（不用退出重进）', afterDel.stillThere === false);
    ok('历史账本弹层还开着（没有把人踹出去）', afterDel.sheetOpen === true);

    // 首页入口的数字：单独验一次。
    // 注意：删完之后当前这本可能已经是关掉状态（显示的是恢复页），
    // 恢复页上也有「历史账本（N）」入口，所以两种页面都要认。
    const histLabel = await evalJs(`
      window.UI.closeAllSheets();
      const v = document.querySelector('.view[data-view="couple"]');
      window.ViewCouple.setPage('home');
      window.ViewCouple.render(v);
      await new Promise((r) => setTimeout(r, 300));
      // 首页上是 .cp-hist-link（淡字），恢复页上是 [data-cp="books"] 胶囊，
      // 两处都算「历史账本入口」，测试不能只认一个类名。
      const link = v.querySelector('.cp-hist-link') || v.querySelector('[data-cp="books"]');
      const S = window.Store;
      return {
        text: link ? link.textContent.trim() : '(没有这个入口)',
        main: !!v.querySelector('.cp-main'),
        reopen: !!v.querySelector('[data-cp="resume"], [data-cp="undo-close"]'),
        n: S.cpBooks().filter((b) => b.id !== S.cpActiveId()).length,
        on: S.cpOn(),
        enabled: S.state.settings.couple.enabled,
        hasBook: S.cpBooks().length > 0,
        html: v.innerHTML.slice(0, 160),
      };
    `);
    console.log('    诊断 = ' + JSON.stringify(histLabel));
    console.log('    首页/恢复页入口 = ' + histLabel.text + '（主界面=' + histLabel.main + '，真实本数=' + histLabel.n + '）');
    ok('页面上有「历史账本」入口', /历史账本/.test(histLabel.text), histLabel.text);
    ok('入口里的数字和真实本数一致',
      histLabel.text === (histLabel.n > 0 ? `历史账本（${histLabel.n}）` : '历史账本'),
      histLabel.text + ' vs n=' + histLabel.n);

    // 再删掉一本（删到只剩当前这本为止，不要连当前这本一起删光）
    const wiped = await evalJs(`
      const S = window.Store;
      // 用 store 直接删历史账本：走 UI 点击时，删到最后一本会触发
      // 「情侣功能自动关闭 → 退到引导/恢复页」，弹层被重渲染顶掉，
      // 点不到 [data-del]，于是永远删不空。空态本身我们还是从 UI 上验，
      // 所以删完再重新打开「历史账本」弹层读 DOM。
      const keep = S.cpActiveId();
      S.cpBooks().filter(function (b) { return b.id !== keep; })
        .forEach(function (b) { S.wipeCpBook(b.id); });
      window.UI.closeAllSheets();
      const v = document.querySelector('#view-couple');
      if (v) {
        try { window.ViewCouple.setPage('home'); } catch (e) {}
        window.ViewCouple.render(v);
      }
      await new Promise(function (r) { setTimeout(r, 400); });
      const link = v && (v.querySelector('.cp-hist-link') || v.querySelector('[data-cp="books"]'));
      if (link) link.click();
      await new Promise(function (r) { setTimeout(r, 700); });
      return {
        rows: document.querySelectorAll('#sheet-root .cpb-item').length,
        empty: !!document.querySelector('#sheet-root .cpb-empty'),
        emptyText: (document.querySelector('#sheet-root .cpb-empty') || {}).textContent || '',
        books: S.cpBooks().length,
        active: S.cpActiveId(),
        sheets: document.querySelectorAll('#sheet-root .sheet').length,
        listHTML: (document.querySelector('#sheet-root #cpb-list') || {}).innerHTML || '(no #cpb-list)',
        lastSheetText: (() => {
          const ss = document.querySelectorAll('#sheet-root .sheet');
          const t = ss[ss.length - 1];
          return t ? t.textContent.replace(/\\s+/g, ' ').slice(0, 120) : '(no sheet)';
        })(),
      };
    `);
    console.log('    删光后 books=' + wiped.books + ' active=' + wiped.active + ' 行=' + wiped.rows);
    console.log('    弹层数=' + wiped.sheets + ' 最上层文案=' + wiped.lastSheetText);
    console.log('    #cpb-list = ' + String(wiped.listHTML).slice(0, 120));
    ok('历史账本删空后显示空态', wiped.books === 1 && wiped.empty === true,
      JSON.stringify({ books: wiped.books, empty: wiped.empty }));
    ok('空态文案说清了为什么是空的', /还没有别的历史账本|还没有历史账本/.test(wiped.emptyText),
      wiped.emptyText.slice(0, 40));

    // =========================================================
    console.log('\n=== 2. 「目标」页不再有情侣提示 ===');
    const goals = await evalJs(`
      window.UI.closeAllSheets();
      window.App.go('goals');
      await new Promise((r) => setTimeout(r, 500));
      const v = document.querySelector('.view[data-view="goals"]');
      const t = v ? v.textContent : '';
      return {
        hasTip: /两个人的钱在/.test(t),
        hasBtn: /去情侣页看看/.test(t),
        hasCoupleBtn: !!v.querySelector('[data-act="to-couple"]'),
      };
    `);
    ok('没有「两个人的钱在「情侣」栏」', goals.hasTip === false);
    ok('没有「去情侣页看看」按钮', goals.hasBtn === false && goals.hasCoupleBtn === false);

    // =========================================================
    console.log('\n=== 3. 设置页：去掉主屏幕、加上赞助作者 ===');
    const settings = await evalJs(`
      window.App.go('settings');
      // 版本号是异步补上去的（要读 caches），等它真的变成 v1.18.x 再断言
      for (let i = 0; i < 25; i++) {
        const el = document.querySelector('.view[data-view="settings"] [data-ver]');
        if (el && /^v\d+\.\d+/.test(el.textContent)) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      const v = document.querySelector('.view[data-view="settings"]');
      const t = v ? v.textContent : '';
      const sp = v ? v.querySelector('[data-act="sponsor"]') : null;
      return {
        hasInstall: /添加到主屏幕/.test(t),
        hasInstallAct: !!v.querySelector('[data-act="install"]'),
        hasSponsor: !!sp,
        sponsorName: sp ? sp.querySelector('.set-name').textContent : '',
        groups: Array.from(v.querySelectorAll('.set-group-title')).map((x) => x.textContent),
        ver: (v.querySelector('[data-ver]') || {}).textContent || '',
        verFoot: (v.querySelector('[data-ver-foot]') || {}).textContent || '',
        footnote: (v.querySelector('.center.small.muted') || {}).textContent || '',
      };
    `);
    ok('「添加到主屏幕」已删除', settings.hasInstall === false && settings.hasInstallAct === false);
    ok('出现「赞助作者」入口', settings.hasSponsor === true, settings.sponsorName);
    ok('入口名字对', settings.sponsorName === '赞助作者', settings.sponsorName);
    ok('没有留下空的「其他」组', settings.groups.indexOf('其他') < 0, settings.groups.join('/'));
    // 页脚以前写死 "花哪儿了 v1.8.1"，跟上面「当前版本 v1.18.x」自相矛盾，
    // 还写着「数据仅保存在本机…不上传服务器」（情侣账已经加密上云了）。
    ok('页脚版本与「当前版本」是同一个数，且不出现 vv', /^v\d+\.\d+\.\d+$/.test(settings.verFoot)
      && settings.verFoot === settings.ver && settings.footnote.indexOf('vv') < 0,
      settings.ver + ' / ' + settings.verFoot);
    ok('页脚不再写「不上传服务器」', settings.footnote.indexOf('不上传服务器') < 0, settings.footnote.replace(/\s+/g, ' ').trim());

    // 旧版把「连不上服务器」报成 offline，界面就写「现在连不上网」——
    // 用户 5G 满格却被说没网。现在失败原因必须区分：network 才是服务器连不上。
    const net = await evalJs(`
      const old = window.fetch;
      window.fetch = () => Promise.reject(new Error('NETWORK_DOWN'));
      let r;
      try { r = await window.App.checkUpdate(); } finally { window.fetch = old; }
      return r;
    `);
    ok('检查更新失败时 reason 是 network（不冒充 offline）',
      !!net && net.ok === false && net.reason === 'network', JSON.stringify(net));
    const hasSiteVer = await evalJs(`return typeof window.App.siteVersion`);
    ok('APK 的更新源里有官网清单（GitHub 之外还有一条路）', hasSiteVer === 'function', hasSiteVer);

    // 官网清单里带了安装包文件名 → App 直接把用户送到自己的下载地址，
    // 不用再翻 GitHub（国内打不开）。这里用桩 fetch 验解析与清洗。
    const man = await evalJs(`
      const old = window.fetch;
      window.fetch = async () => new Response(
        JSON.stringify({ app: '9.9.9', apk: 'whereipaid-v9.9.9.apk', apkBytes: 3215439 }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
      let r; try { r = await window.App.siteManifest(); } finally { window.fetch = old; }
      return r;
    `);
    ok('版本清单能读出 APK 文件名', !!man && man.version === '9.9.9'
      && man.apk === 'whereipaid-v9.9.9.apk', JSON.stringify(man));

    const manBad = await evalJs(`
      const old = window.fetch;
      window.fetch = async () => new Response(
        JSON.stringify({ app: '9.9.9', apk: 'javascript:alert(1)' }), { status: 200 }
      );
      let r; try { r = await window.App.siteManifest(); } finally { window.fetch = old; }
      return r;
    `);
    ok('清单里不是文件名的 apk 字段被丢掉', !!manBad && manBad.apk === '', JSON.stringify(manBad));

    // APK 壳里注入了原生桥 JZApp（MainActivity.UpdateBridge）：
    // 有桥就在 App 内用系统下载器下新包，不再把用户踢到浏览器。
    const bridge = await evalJs(`
      window.__apk = '';
      window.JZApp = { downloadApk(u) { window.__apk = u; } };
      let r;
      try {
        r = window.App.openApkDownload('https://where-i-paid.pages.dev/download/whereipaid-v9.9.9.apk');
      } finally { delete window.JZApp; }
      return { r: r, u: window.__apk };
    `);
    ok('有原生桥时，APK 走 App 内下载（不跳浏览器）',
      bridge.r === true && /\/download\/whereipaid-v9\.9\.9\.apk$/.test(bridge.u), JSON.stringify(bridge));

    const sponsor = await evalJs(`
      document.querySelector('.view[data-view="settings"] [data-act="sponsor"]').click();
      await new Promise((r) => setTimeout(r, 700));
      const sheets = document.querySelectorAll('#sheet-root .sheet');
      const top = sheets[sheets.length - 1];
      if (!top) return { err: 'no sheet' };
      const r = top.getBoundingClientRect();
      const img = top.querySelector('.sp-qr img');
      return {
        title: (top.querySelector('.sheet-title') || {}).textContent || '',
        text: top.textContent.replace(/\\s+/g, ' ').trim(),
        qr: top.querySelectorAll('.sp-qr img').length,
        qrSrc: img ? img.getAttribute('src') : '',
        qrLoaded: !!(img && img.complete && img.naturalWidth > 0),
        qrW: img ? Math.round(img.getBoundingClientRect().width) : 0,
        facts: top.querySelectorAll('.sp-fact').length,
        h: Math.round(r.height),
        w: Math.round(r.width),
      };
    `);
    console.log('    面板标题 = ' + sponsor.title + '，高 = ' + sponsor.h + 'px');
    ok('弹出的面板叫「赞助作者」', sponsor.title === '赞助作者', sponsor.title);
    // m03611：作者把收款码放进来了，这里从「没有二维码占位」改成「二维码真的能显示」
    ok('微信收款码在，且图片已加载', sponsor.qr === 1 && sponsor.qrLoaded === true
      && /wechat-pay\.png/.test(sponsor.qrSrc || ''), sponsor.qrSrc + ' loaded=' + sponsor.qrLoaded);
    ok('收款码尺寸正常（120–220px）', sponsor.qrW >= 120 && sponsor.qrW <= 220, String(sponsor.qrW));
    ok('三格事实都在', sponsor.facts === 3, String(sponsor.facts));
    ok('第三格写的是「只有情侣账上云」', /只有情侣账上云/.test(sponsor.text), sponsor.text.slice(0, 80));
    // 文案必须跟实际一致：个人账本不上传，情侣账会同步到 Cloudflare
    ok('写清了情侣账同步到 Cloudflare、个人账本不上传',
      /Cloudflare/.test(sponsor.text) && /个人账本永远只在这台手机上/.test(sponsor.text),
      sponsor.text.slice(0, 120));
    ok('不再声称「没有任何上传」', !/0 KB/.test(sponsor.text));
    ok('面板不超过一屏', sponsor.h <= 844, String(sponsor.h));

    // =========================================================
    console.log('\n=== 4. 情侣账本只记支出 ===');
    await evalJs(`
      window.UI.closeAllSheets();
      const S = window.Store;
      S.clearAll(false);
      S.enableCouple({
        meName: '阿甲', peerName: '阿乙', mode: 'local',
        togetherSince: '2024-05-20',
        consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}
      });
      S.cpAddTx({ amount: 12000, catId: 'food', attrib: 'me', note: '火锅' });
      S.cpAddTx({ amount: 4000, catId: 'fun', attrib: 'peer' });
      window.App.go('couple');
      const v = document.querySelector('.view[data-view="couple"]');
      window.ViewCouple.setPage('bill');
      window.ViewCouple.render(v);
      return 1;
    `);
    await sleep(500);

    const bill = await evalJs(`
      const v = document.querySelector('.view[data-view="couple"]');
      const t = v.textContent;
      return {
        tabs: v.querySelectorAll('.cp-bill-tab').length,
        inc: /收入/.test(t),
        rows: v.querySelectorAll('.cp-bill-row').length,
        hero: (v.querySelector('.cp-bill-hero-val') || {}).textContent || '',
      };
    `);
    ok('账单页没有「收入」筛选', bill.tabs === 0, String(bill.tabs));
    ok('账单页一个字都没提「收入」', bill.inc === false);
    ok('两笔都还在', bill.rows === 2, String(bill.rows));

    const editor = await evalJs(`
      const v = document.querySelector('.view[data-view="couple"]');
      v.querySelector('[data-cp="bill-add"]').click();
      await new Promise((r) => setTimeout(r, 500));
      const sheets = document.querySelectorAll('#sheet-root .sheet');
      const top = sheets[sheets.length - 1];
      const t = top ? top.textContent : '';
      return {
        amounts: top ? top.querySelectorAll('[data-e="type"]').length : -1,
        hasExpenseWord: /支出/.test(t),
        hasIncomeWord: /收入/.test(t),
        links: top ? Array.from(top.querySelectorAll('.cbe-link')).map((x) => x.textContent.trim()) : [],
        hasIncomeLink: !!(top && top.querySelector('[data-e="income"]')),
      };
    `);
    ok('记账弹层没有「支出/收入」切换', editor.amounts === 0, String(editor.amounts));
    ok('弹层里不出现「收入」两个字', editor.hasIncomeWord === false, editor.links.join('/'));
    ok('弹层里有「收了一笔」入口', editor.hasIncomeLink === true, editor.links.join('/'));

    // =========================================================
    console.log('\n=== 5. 退款按净额算 ===');
    const refund = await evalJs(`
      window.UI.closeAllSheets();
      const S = window.Store;
      const list = S.cpTxs();
      const src = list.filter((t) => t.amount === 12000)[0];
      if (!src) return { err: 'no src' };
      const before = S.cpSummary(S.scopePeriod('month', new Date()), S.cpTxs());
      S.cpRefundTx(src.id, 2000, '退回来一部分');
      const after = S.cpSummary(S.scopePeriod('month', new Date()), S.cpTxs());
      return {
        beforeExp: before.expense,
        afterExp: after.expense,
        beforeCount: before.count,
        afterCount: after.count,
        refundTotal: after.refundTotal || 0,
        net: S.cpNetOf(src),
        raw: S.cpTxs().length,
      };
    `);
    console.log('    花销 ' + refund.beforeExp + ' → ' + refund.afterExp + '，笔数 ' + refund.beforeCount + ' → ' + refund.afterCount);
    ok('退款后花销变少（按净额）', refund.afterExp === refund.beforeExp - 2000,
      refund.beforeExp + ' → ' + refund.afterExp);
    ok('退款记录不单独算一笔', refund.afterCount === refund.beforeCount,
      refund.beforeCount + ' → ' + refund.afterCount);
    ok('原支出的净额对得上', refund.net === 10000, String(refund.net));
    ok('退款金额被记进 refundTotal', refund.refundTotal === 2000, String(refund.refundTotal));

    // =========================================================
    console.log('\n=== 6. 收了一笔进基金、不进列表 ===');
    const income = await evalJs(`
      window.UI.closeAllSheets();
      const S = window.Store;
      const before = { tx: S.cpTxs().length, goals: S.coupleGoals().length };
      const g = S.cpFundDeposit('', 60000, '爸妈给的见面红包');
      const after = { tx: S.cpTxs().length, goals: S.coupleGoals().length, saved: g ? g.saved : -1 };
      return { before, after, name: g ? g.name : '' };
    `);
    ok('收了一笔不产生交易记录', income.after.tx === income.before.tx,
      income.before.tx + ' → ' + income.after.tx);
    ok('钱进了基金', income.after.saved > 0, String(income.after.saved));
    ok('自动建了小金库', /小金库/.test(income.name), income.name);

    // 日历上那天有 ❤️
    const cal = await evalJs(`
      const S = window.Store;
      const p = S.monthPeriod(new Date());
      const c = S.cpCalendar(p);
      const today = S.state.cpTxs.length ? null : null;
      const keys = Object.keys(c.days);
      let hearts = 0;
      keys.forEach((k) => { if (c.days[k].deposits && c.days[k].deposits.length) hearts += 1; });
      return { days: keys.length, hearts, depositCount: c.depositCount };
    `);
    ok('日历上标出了存钱的那一天', cal.hearts >= 1, JSON.stringify(cal));

    // =========================================================
    const errs = events.filter((e) => e.method === 'Runtime.exceptionThrown');
    ok('整个过程没有 JS 异常', errs.length === 0, errs.length ? JSON.stringify(errs[0].params.exceptionDetails.text) : '');

    console.log('\n通过 ' + pass + ' / ' + (pass + fail));
    if (fail) console.log('失败：' + failed.join('；'));
  } catch (e) {
    fail += 1;
    console.log('测试失败: ' + (e && e.stack ? e.stack : e));
    console.log('\n通过 ' + pass + ' / ' + (pass + fail));
  } finally {
    try { if (ws) ws.close(); } catch (e) { /* 忽略 */ }
    await env.stop(proc);
  }
})();
