/**
 * 生日：开通页能选、能存进 settings、日历上能标出来。
 * 这是美工交付时留下的唯一缺口（dayEvents 读 cfg().meBirthday/peerBirthday，但没人写）。
 */
const env = require('./_env');
const { spawn } = require('child_process');
const PORT = 9447;
const PROFILE = env.profile('bday');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const t = async (name, fn) => {
  let ok = false, err = '';
  try { ok = await fn(); } catch (e) { err = ' · ' + (e && e.message || e); }
  if (ok) { pass += 1; console.log('  ✅ ' + name); } else { fail += 1; console.log('  ❌ ' + name + err); }
};

(async () => {
  const proc = spawn(env.EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
    '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });
  let ws = null;
  const errs = [];
  try {
    let ver = null;
    for (let i = 0; i < 80; i += 1) {
      try { ver = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await sleep(250); }
    }
    ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const waits = new Map();
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && waits.has(d.id)) { waits.get(d.id)(d); waits.delete(d.id); return; }
      if (d.method === 'Runtime.exceptionThrown') {
        const ex = d.params.exceptionDetails;
        errs.push(String((ex.exception && ex.exception.description) || ex.text));
      }
    };
    const send = (method, params, sessionId) => new Promise((res) => {
      id += 1; const my = id; waits.set(my, res);
      ws.send(JSON.stringify({ id: my, method, params: params || {}, sessionId }));
    });
    const tg = await send('Target.getTargets');
    const page = tg.result.targetInfos.find((x) => x.type === 'page');
    const att = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    const sid = att.result.sessionId;
    await send('Page.enable', {}, sid); await send('Runtime.enable', {}, sid);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sid);
    await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' }, sid);
    const ev = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: '(async () => { ' + expr + ' })()', awaitPromise: true, returnByValue: true }, sid);
      if (r.result && r.result.exceptionDetails) {
        const ex = r.result.exceptionDetails;
        return { ERR: String((ex.exception && ex.exception.description) || ex.text) };
      }
      return r.result && r.result.result ? r.result.result.value : undefined;
    };
    await send('Page.navigate', { url: 'http://127.0.0.1:4180/index.html' }, sid);
    await sleep(2500);

    console.log('\n=== 生日 ===');
    await ev(`localStorage.clear(); return 1;`);
    await send('Page.navigate', { url: 'http://127.0.0.1:4180/index.html' }, sid);
    await sleep(2200);

    // ⚠️ 前置：必须先真正开通情侣账本（on() 为真），否则 render() 一直落在
    // 开通页上，日历根本不会出现 —— 之前这里少了这一步，后 4 项全红，
    // 看上去像「生日没渲染」，实际是根本没进主界面。
    await ev(`
      const S = window.Store;
      S.clearAll();
      S.enableCouple({
        meName: '小懒', peerName: '小满', mode: 'local', togetherSince: '2024-05-20',
        consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)}
      });
      window.App.go('couple');
      return 1;
    `);
    await sleep(400);

    await t('开通页有「你的生日」「TA 的生日」两个入口', () => ev(`
      // ⚠️ 账本已经开通时 setStep('profile') 是没用的：render() 里 on() 为真就直接走
      // renderMain，step 根本不被看。所以这里临时把 enabled 设回 false，
      // 渲染完立刻还原，避免影响后面的日历断言。
      const S = window.Store;
      const keep = S.settings.couple.enabled;
      S.settings.couple.enabled = false;
      window.App.go('couple');
      const v = document.querySelector('.view[data-view="couple"]');
      window.ViewCouple.setStep('profile');
      window.ViewCouple.render(v);
      await new Promise((r) => setTimeout(r, 300));
      const html = v.innerHTML || '';
      const hasMy = html.indexOf('id="cp-mybd"') >= 0;
      const hasPeer = html.indexOf('id="cp-peerbd"') >= 0;
      const hasOpt = html.indexOf('cp-label-opt') >= 0;
      S.settings.couple.enabled = keep;
      window.ViewCouple.setStep('intro');
      window.ViewCouple.render(v);
      await new Promise((r) => setTimeout(r, 150));
      return hasMy && hasPeer && hasOpt;
    `));

    await t('选填：不填生日也能点「继续」', () => ev(`
      const v = document.querySelector('.view[data-view="couple"]');
      v.querySelector('#cp-me').value = '小懒';
      v.querySelector('#cp-me').dispatchEvent(new Event('input', { bubbles: true }));
      v.querySelector('#cp-peer').value = '小满';
      v.querySelector('#cp-peer').dispatchEvent(new Event('input', { bubbles: true }));
      window.ViewCouple.setStep('profile');
      window.ViewCouple.render(v);
      await new Promise((r) => setTimeout(r, 200));
      v.querySelector('#cp-me').value = '小懒';
      v.querySelector('#cp-me').dispatchEvent(new Event('input', { bubbles: true }));
      v.querySelector('#cp-peer').value = '小满';
      v.querySelector('#cp-peer').dispatchEvent(new Event('input', { bubbles: true }));
      // 用日期选择器选在一起的日子
      v.querySelector('#cp-since').click();
      await new Promise((r) => setTimeout(r, 400));
      const ok1 = document.querySelectorAll('#sheet-root [data-act="ok"]');
      ok1[ok1.length - 1].click();
      await new Promise((r) => setTimeout(r, 400));
      return !v.querySelector('#cp-profile-ok').disabled;
    `));

    await t('生日按钮点开是日期选择器', () => ev(`
      const v = document.querySelector('.view[data-view="couple"]');
      v.querySelector('#cp-mybd').click();
      await new Promise((r) => setTimeout(r, 400));
      const sheets = document.querySelectorAll('#sheet-root .sheet');
      const top = sheets[sheets.length - 1];
      const has = !!top && /生日/.test(top.textContent);
      return has;
    `));

    await t('选完生日，按钮上的文案变成「M 月 D 日」', () => ev(`
      // 直接调 ViewCouple 内部不可行，走真实点击：选当年 3 月 8 日
      const body = document.body;
      const sheets = document.querySelectorAll('#sheet-root .sheet');
      const top = sheets[sheets.length - 1];
      // 翻到 3 月
      let guard = 0;
      while (guard < 12) {
        const t2 = top.querySelector('.cp-cal-title, .dp-title, [data-part="month"]');
        const label = (top.textContent || '');
        if (/3\\s*月/.test(label)) break;
        const prev = top.querySelector('[data-nav="-1"]');
        if (!prev) break;
        prev.click();
        await new Promise((r) => setTimeout(r, 60));
        guard += 1;
      }
      const days = Array.from(top.querySelectorAll('.dp-day, .dp-cell')).filter((x) => (x.textContent || '').trim() === '8');
      if (days[0]) days[0].click();
      await new Promise((r) => setTimeout(r, 100));
      const ok = top.querySelector('[data-act="ok"]');
      if (ok) ok.click();
      await new Promise((r) => setTimeout(r, 400));
      const v = document.querySelector('.view[data-view="couple"]');
      const txt = (v.querySelector('#cp-mybd') || {}).textContent || '';
      return /\\d{1,2} 月 \\d{1,2} 日/.test(txt);
    `));

    await t('存进 settings.couple 后仍然是空字符串或合法日期', () => ev(`
      const c = window.Store.settings.couple;
      const ok = (s) => s === '' || /^\\d{4}-\\d{2}-\\d{2}$/.test(s);
      return ok(c.meBirthday) && ok(c.peerBirthday);
    `));

    await t('写进 settings 后，日历上生日那天出现「我的生日」', () => ev(`
      const S = window.Store;
      const y = new Date().getFullYear();
      S.setSettings({ couple: { meBirthday: y + '-03-08', peerBirthday: y + '-09-15' } });
      window.App.go('couple');
      const v = document.querySelector('.view[data-view="couple"]');
      window.ViewCouple.setPage('memories');
      window.ViewCouple.render(v);
      await new Promise((r) => setTimeout(r, 400));
      // 每个月都翻一遍，找带 aria-label 提到「生日」的格子。
      // ⚠️ 不要在 JS 模板串里写 [data-calday="年初-03-08"] —— 一年前的 bug：
      // y + '-03-08' 拼出来是 "2026-03-08"，而 DOM 上的属性值也是同一个串，
      // 但当时写成固定月份、日历不在那个月，selector 恒为 null，误判成「没渲染」。
      let hits = 0;
      for (let i = 0; i < 12; i++) {
        const cells = Array.from(v.querySelectorAll('.cp-cal-cell[aria-label]'));
        hits += cells.filter((x) => /生日/.test(x.getAttribute('aria-label') || '')).length;
        const prev = v.querySelector('[data-cp="cal-prev"]');
        if (!prev) break;
        prev.click();
        await new Promise((r) => setTimeout(r, 90));
      }
      return hits >= 1;
    `));

    await t('生日小字真的画成了 DOM 节点而不是只写进 aria', () => ev(`
      const S = window.Store;
      const y = new Date().getFullYear();
      S.setSettings({ couple: { meBirthday: y + '-10-08', peerBirthday: y + '-10-15' } });
      const v = document.querySelector('.view[data-view="couple"]');
      window.ViewCouple.setPage('memories');
      window.ViewCouple.render(v);
      await new Promise((r) => setTimeout(r, 400));
      // 日历停在哪个月没法从外部控制（memoOffset 是模块级状态，只有「返回」和「选年」会归零），
      // render() 不会把它重置。所以不假设当前月份：先一路往回扫到不能再翻，
      // 再一路往后扫半年，一年覆盖。
      const has = () => {
        const s = Array.from(v.querySelectorAll('.cp-cal-ev-i')).map((x) => x.textContent.trim());
        return s.indexOf('我的生日') >= 0 || s.indexOf('TA 生日') >= 0;
      };
      let found = 0;
      for (let i = 0; i < 14; i++) {
        if (has()) found += 1;
        const prev = v.querySelector('[data-cp="cal-prev"]');
        if (!prev) break;
        prev.click();
        await new Promise((r) => setTimeout(r, 90));
      }
      for (let i = 0; i < 20; i++) {
        if (has()) found += 1;
        const next = v.querySelector('[data-cp="cal-next"]');
        if (!next) break;
        next.click();
        await new Promise((r) => setTimeout(r, 90));
      }
      return found >= 1;
    `));

    await t('几行小字都没有被省略号截断', () => ev(`
      const v = document.querySelector('.view[data-view="couple"]');
      const evs = Array.from(v.querySelectorAll('.cp-cal-ev, .cp-cal-cell span'));
      let bad = 0;
      evs.forEach((x) => { if (x.scrollWidth > x.clientWidth + 1) bad += 1; });
      return bad === 0;
    `));

    await t('「我的生日」那条文案正确', () => ev(`
      const S = window.Store;
      const y = new Date().getFullYear();
      S.setSettings({ couple: { meBirthday: y + '-10-08', peerBirthday: y + '-10-15' } });
      const v = document.querySelector('.view[data-view="couple"]');
      window.ViewCouple.setPage('memories');
      window.ViewCouple.render(v);
      await new Promise((r) => setTimeout(r, 400));
      // 同样先往回扫到底，再往后扫半年，收集所有出现过的生日小字文案
      const seen = {};
      const take = () => {
        Array.from(v.querySelectorAll('.cp-cal-ev-i')).forEach((x) => { seen[x.textContent.trim()] = 1; });
      };
      for (let i = 0; i < 14; i++) {
        take();
        if (seen['我的生日'] && seen['TA 生日']) break;
        const prev = v.querySelector('[data-cp="cal-prev"]');
        if (!prev) break;
        prev.click();
        await new Promise((r) => setTimeout(r, 90));
      }
      for (let i = 0; i < 20; i++) {
        take();
        if (seen['我的生日'] && seen['TA 生日']) break;
        const next = v.querySelector('[data-cp="cal-next"]');
        if (!next) break;
        next.click();
        await new Promise((r) => setTimeout(r, 90));
      }
      // 实际文案是「我的生日」「TA 生日」（中间有空格），别写成「我生日」
      return !!seen['我的生日'] && !!seen['TA 生日'];
    `));

    // ---- 翻月的边界（顺手修掉的一个真 bug 的守门断言）----
    // 曾：往回翻过头会得到 mon = -1，标题渲染成「2026年 -1月」，
    // 日网格空白，且 cal-next 的守卫让右箭头点不动 —— 整页卡死。
    await t('往回翻跨年不会翻出「0 月」', () => ev(`
      const v = document.querySelector('.view[data-view="couple"]');
      const nums = () => Array.from(v.querySelectorAll('.cp-cal-title-num')).map((x) => +x.textContent.trim());
      // 先一路翻回最远
      for (let i = 0; i < 40; i++) {
        const p = v.querySelector('[data-cp="cal-prev"]');
        if (!p) break;
        const before = nums().join('-');
        p.click();
        await new Promise((r) => setTimeout(r, 50));
        if (nums().join('-') === before) break;
      }
      const far = nums();
      // 全都必须是合法月份
      const okMon = far.length === 2 && far[1] >= 1 && far[1] <= 12 && far[0] >= 1970;
      // 而且还得能翻回来
      const beforeBack = nums().join('-');
      const nx = v.querySelector('[data-cp="cal-next"]');
      if (nx) nx.click();
      await new Promise((r) => setTimeout(r, 80));
      return okMon && nums().join('-') !== beforeBack;
    `));

    await t('一直往回翻到底，日网格也不会空', () => ev(`
      const v = document.querySelector('.view[data-view="couple"]');
      // 上一条已经把日历翻到很早了，这里检查还有格子
      const cells = v.querySelectorAll('.cp-cal-cell').length;
      const nums = Array.from(v.querySelectorAll('.cp-cal-title-num')).map((x) => +x.textContent.trim());
      return cells >= 28 && nums[1] >= 1 && nums[1] <= 12;
    `));

    await t('整个过程页面没有 JS 异常', () => errs.length === 0);
  } catch (e) {
    console.log('ERR', (e && e.stack) || e); fail += 1;
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    await env.stop(proc);
  }
  console.log('\n通过 ' + pass + ' / ' + (pass + fail));
  process.exit(fail ? 1 : 0);
})();
