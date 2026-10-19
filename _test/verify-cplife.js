/* 情侣账本 · 关闭 / 隐藏 / 删除 / 多本账本
 *
 * 这几件事最容易在真机上出事，因为它们都涉及「数据还在不在」。
 * 所以每一条都在真浏览器里点按钮，不看函数返回值。
 */
const { spawn } = require('child_process');
const env = require('./_env');
const path = require('path');
const fs = require('fs');

const PORT = 9421;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const URL = 'http://127.0.0.1:4180/index.html';
const PROFILE = env.profile('cplife');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--window-size=390,844', 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
    } catch (e) {}
  }
  if (!target) { console.log('浏览器没起来'); await env.stop(edge); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const waiters = new Map();
  const errors = [];
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    }
  };
  const send = (method, params) => new Promise((res) => {
    const i = ++id;
    waiters.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: `(async () => { const S = window.Store; ${expr} })()`, awaitPromise: true, returnByValue: true,
    });
    if (r.result && r.result.exceptionDetails) {
      return { __err: r.result.exceptionDetails.exception.description };
    }
    return r.result && r.result.result ? r.result.result.value : undefined;
  };

  let pass = 0; let fail = 0;
  const t = async (name, expr) => {
    const v = await evalJs(expr);
    if (v && v.__err) { fail++; console.log(`  ❌ ${name}  [${v.__err.split('\n')[0]}]`); return; }
    const ok = typeof v === 'object' && v !== null ? v.ok : !!v;
    if (ok) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}  [${JSON.stringify(v)}]`); }
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Shanghai' });
  await send('Page.navigate', { url: URL });
  await sleep(2200);

  const boot = await evalJs(`
    if (typeof App === 'undefined') return { ok: false, why: 'App 未定义（服务器没起？）' };
    S.clearAll();
    S.enableCouple({ meName: '小鹿', peerName: '阿柚', mode: 'local', togetherSince: '2024-05-20',
      consent:{agreed:true,version:(window.ViewCouple.CONSENT_VERSION||3)} });
    S.cpAddTx({ type: 'expense', amount: 8800, catId: 'food', note: '火锅' });
    S.cpAddTx({ type: 'expense', amount: 12000, catId: 'fun', note: '电影' });
    App.go('couple');
    ViewCouple.setStep('main');
    ViewCouple.render(document.querySelector('.view[data-view="couple"]'));
    return { ok: true, books: S.cpBooks().length, txs: S.cpTxs().length };
  `);
  console.log('起手：', JSON.stringify(boot));
  if (!boot || !boot.ok) { console.log('起手失败', boot && boot.why); await env.stop(edge); process.exit(1); }
  await sleep(300);

  // ============ 1. 隐藏 / 放回 ============
  console.log('\n=== 1. 「从首页收起」已删除（用户要求）===');
  await t('1.1 主界面上没有「从首页收起」按钮了', `
    const v = document.querySelector('.view[data-view="couple"]');
    return { ok: !v.querySelector('[data-cp="hide"]') && v.textContent.indexOf('从首页收起') < 0 };
  `);
  await t('1.2 底栏情侣格一直正常显示，不会出现收起的淡态', `
    App.paintCoupleTab();
    const tab = document.querySelector('.tab--couple');
    return { ok: !!tab && !tab.classList.contains('is-hidden') && parseFloat(getComputedStyle(tab).opacity) > 0.9,
      cls: tab && tab.className };
  `);
  await t('1.3 账本数据一条没少', `
    return { ok: S.cpOn() === true && S.cpTxs().length === 2, on: S.cpOn(), n: S.cpTxs().length };
  `);
  await t('1.4 首页仍保留三个必要的出口', `
    const v = document.querySelector('.view[data-view="couple"]');
    return { ok: !!v.querySelector('[data-cp="switch-mode"]') && !!v.querySelector('[data-cp="off"]')
      && !!v.querySelector('[data-cp="books"]') };
  `);

  // ============ 2. 关闭的四屏 ============
  console.log('\n=== 2. 关闭账本 ===');
  await t('2.1 点「关闭账本」弹出第一屏，主按钮是「再想想」', `
    document.querySelector('.view[data-view="couple"] [data-cp="off"]').click();
    await new Promise(r => setTimeout(r, 320));
    const sh = document.querySelector('#sheet-root .sheet');
    if (!sh) return { ok:false, why:'没弹层' };
    const main = sh.querySelector('.cpq-main');
    return { ok: !!main && main.textContent.trim() === '再想想' && !!sh.querySelector('[data-cq="next"]'), main: main && main.textContent };
  `);
  await t('2.2 主按钮和关闭按钮都在，关闭在下面', `
    const sh = document.querySelector('#sheet-root .sheet');
    const a = sh.querySelector('.cpq-main').getBoundingClientRect();
    const b = sh.querySelector('[data-cq="next"]').getBoundingClientRect();
    return { ok: b.top > a.top - 1, main: Math.round(a.top), sub: Math.round(b.top) };
  `);
  await t('2.3 点「再想想」只关弹层，账本还开着', `
    document.querySelector('#sheet-root .sheet .cpq-main').click();
    await new Promise(r => setTimeout(r, 400));
    return { ok: !document.querySelector('#sheet-root .sheet') && S.cpOn() === true, on: S.cpOn() };
  `);
  await t('2.4 第二屏列出可以选的原因', `
    document.querySelector('.view[data-view="couple"] [data-cp="off"]').click();
    await new Promise(r => setTimeout(r, 320));
    document.querySelector('#sheet-root .sheet [data-cq="next"]').click();
    await new Promise(r => setTimeout(r, 420));
    const opts = document.querySelectorAll('#sheet-root .sheet [data-reason]');
    const sh = document.querySelector('#sheet-root .sheet');
    return { ok: opts.length >= 5 && /我们分开了/.test(sh.textContent) && !!sh.querySelector('[data-reason=""]'), n: opts.length };
  `);
  await t('2.5 选「我们分开了」进第三屏，写明 7 天可恢复', `
    document.querySelector('#sheet-root [data-reason="split"]').click();
    await new Promise(r => setTimeout(r, 420));
    const sh = document.querySelector('#sheet-root .sheet');
    return { ok: !!sh && /7 天/.test(sh.textContent) && /还在这台手机上/.test(sh.textContent) };
  `);
  await t('2.6 第三屏只有「关闭账本」一个按钮，没有删除入口', `
    const sh = document.querySelector('#sheet-root .sheet');
    const btns = sh.querySelectorAll('.cpq-acts .btn');
    return { ok: btns.length === 1 && !/删除/.test(sh.textContent.replace(/不会删掉|不删/g,'')), n: btns.length };
  `);
  await t('2.7 关闭后进入「账本收好了」，写着数据还在', `
    document.querySelector('#sheet-root .sheet [data-cq="do"]').click();
    await new Promise(r => setTimeout(r, 520));
    const sh = document.querySelector('#sheet-root .sheet');
    if (!sh) return { ok:false, why:'没弹层' };
    return { ok: /账本收好了/.test(sh.textContent) && /都留在手机上/.test(sh.textContent) && S.cpOn() === false };
  `);
  await t('2.8 收好的那一页有两个按钮 + 一行淡的删除入口', `
    const sh = document.querySelector('#sheet-root .sheet');
    return { ok: sh.querySelectorAll('.cpq-acts .btn').length === 2 && !!sh.querySelector('.cpq-del') };
  `);
  await t('2.9 关闭后数据一条没删', `
    return { ok: S.cpTxsOf('cp1').length === 2 && S.coupleGoals().length >= 1, n: S.cpTxsOf('cp1').length };
  `);
  await t('2.10 关闭原因只存在本机', `
    return { ok: S.settings.couple.closeReason === 'split' && S.settings.couple.closedAt > 0,
      r: S.settings.couple.closeReason };
  `);
  await t('2.11 7 天内可以一键反悔', `
    return { ok: S.cpCanUndo() === true };
  `);

  // ============ 3. 关闭之后重新进来 ============
  console.log('\n=== 3. 关掉之后再进情侣页 ===');
  await t('3.1 页面变成「最近关掉的那一本」，带恢复按钮', `
    document.querySelector('#sheet-root .sheet .cpq-main').click();
    await new Promise(r => setTimeout(r, 700));
    try { UI.closeAllSheets(); } catch(e){}
    App.go('couple');
    ViewCouple.setStep('intro');
    ViewCouple.render(document.querySelector('.view[data-view="couple"]'));
    await new Promise(r => setTimeout(r, 300));
    const v = document.querySelector('.view[data-view="couple"]');
    return { ok: /最近关掉的那一本/.test(v.textContent) && !!v.querySelector('[data-cp="undo-close"]'), t: v.textContent.slice(0,30) };
  `);
  await t('3.2 这一页不再出现「重新走一遍开通」当主按钮', `
    const v = document.querySelector('.view[data-view="couple"]');
    const btns = Array.from(v.querySelectorAll('.cp-onboard .btn')).map(x => x.textContent.trim());
    return { ok: btns.indexOf('重新走一遍开通') < 0, btns };
  `);
  await t('3.3 点恢复 → 回主界面，账目还在', `
    const btn = document.querySelector('.view[data-view="couple"] [data-cp="undo-close"]');
    if (!btn) return { ok:false, why:'恢复页上没有恢复按钮' };
    btn.click();
    await new Promise(r => setTimeout(r, 420));
    const v = document.querySelector('.view[data-view="couple"]');
    return { ok: !!v.querySelector('.cp-bill-entry') && S.cpOn() === true && S.cpTxs().length === 2,
      on: S.cpOn(), n: S.cpTxs().length, status: (S.cpActiveBook() || {}).status };
  `);

  // ============ 4. 多本账本 ============
  console.log('\n=== 4. 换一本新的 ===');
  await t('4.1 首页不直接放「换一本新的」，只在历史账本里', `
    const v = document.querySelector('.view[data-view="couple"]');
    return { ok: !v.querySelector('[data-cp="new-book"]') && !!v.querySelector('[data-cp="books"]') };
  `);
  await t('4.2 打开历史账本：底部才有「再开一本新的」', `
    document.querySelector('.view[data-view="couple"] [data-cp="books"]').click();
    await new Promise(r => setTimeout(r, 340));
    const all = Array.from(document.querySelectorAll('#sheet-root .sheet'));
    const top = all[all.length - 1];
    return { ok: !!top && !!top.querySelector('[data-cq="newbook"]') };
  `);
  await t('4.3 点「再开一本新的」先确认会收进历史', `
    const all = Array.from(document.querySelectorAll('#sheet-root .sheet'));
    const top = all[all.length - 1];
    top.querySelector('[data-cq="newbook"]').click();
    await new Promise(r => setTimeout(r, 460));
    const all2 = Array.from(document.querySelectorAll('#sheet-root .sheet'));
    const t2 = all2[all2.length - 1];
    return { ok: !!t2 && /历史账本/.test(t2.textContent) && /先不了/.test(t2.textContent) };
  `);
  await t('4.4 确认后回到开通页，老的收进历史', `
    const all = Array.from(document.querySelectorAll('#sheet-root .sheet'));
    const top = all[all.length - 1];
    top.querySelector('[data-cq="do"]').click();
    await new Promise(r => setTimeout(r, 620));
    try { UI.closeAllSheets(); } catch(e){}
    await new Promise(r => setTimeout(r, 200));
    return { ok: S.cpBooks().length === 2 && S.cpTxsOf('cp1').length === 2,
      books: S.cpBooks().length, old: S.cpTxsOf('cp1').length };
  `);
  await t('4.5 新的那本一条记录都没有（不会串本）', `
    const cur = S.cpActiveId();
    return { ok: cur === 'cp2' && S.cpTxs().length === 0, cur, mine: S.cpTxs().length };
  `);
  await t('4.6 新记一笔只进新这本', `
    S.cpAddTx({ type: 'expense', amount: 5000, catId: 'food', note: '新的一本' });
    return { ok: S.cpTxsOf('cp1').length === 2 && S.cpTxsOf('cp2').length === 1,
      a: S.cpTxsOf('cp1').length, b: S.cpTxsOf('cp2').length };
  `);
  await t('4.7 基金抽屉不串本：新这本还没有小金库', `
    return { ok: S.coupleVault() === null || S.coupleVault().cpBookId === S.cpActiveId(),
      v: S.coupleVault() && S.coupleVault().cpBookId };
  `);
  await t('4.8 历史账本按钮显示还有几本', `
    S.enableCouple({ meName: '小鹿', peerName: '阿柚', mode: 'local', togetherSince: '2024-05-20' });
    App.go('couple'); ViewCouple.setStep('main'); ViewCouple.render(document.querySelector('.view[data-view="couple"]'));
    await new Promise(r => setTimeout(r, 300));
    const btn = document.querySelector('.view[data-view="couple"] [data-cp="books"]');
    return { ok: !!btn && /历史账本/.test(btn.textContent), label: btn && btn.textContent.trim() };
  `);
  await t('4.9 历史账本里只列「关闭过的」，当前这本不列进来', `
    const v = document.querySelector('.view[data-view="couple"]');
    v.querySelector('[data-cp="books"]').click();
    await new Promise(r => setTimeout(r, 340));
    const all = Array.from(document.querySelectorAll('#sheet-root .sheet'));
    const top = all[all.length - 1];
    const rows = top ? top.querySelectorAll('.cpb-row') : [];
    const ids = Array.from(rows).map(r => r.dataset.book);
    // 用户要求：只有选择「关闭账本」后，那本才进历史账本；
    // 正在用的这一本永远在首页，不该出现在历史里。
    return { ok: ids.indexOf(S.cpActiveId()) < 0 && ids.length === S.cpBooks().length - 1,
      ids: ids.join(','), cur: S.cpActiveId() };
  `);
  await t('4.10 每一行都带「永久删除」', `
    const all = Array.from(document.querySelectorAll('#sheet-root .sheet'));
    const top = all[all.length - 1];
    const dels = top ? top.querySelectorAll('[data-del]') : [];
    const names = Array.from(dels).map(d => d.getAttribute('data-del'));
    return { ok: dels.length === top.querySelectorAll('.cpb-row').length && dels.length > 0,
      n: dels.length, names: names.join(',') };
  `);
  await t('4.11 点老的那本能重新打开，看到那 2 笔', `
    const all = Array.from(document.querySelectorAll('#sheet-root .sheet'));
    const top = all[all.length - 1];
    const rows = Array.from(top.querySelectorAll('.cpb-row'));
    const old = rows.find(r => r.dataset.book === 'cp1');
    old.click();
    await new Promise(r => setTimeout(r, 500));
    return { ok: S.cpActiveId() === 'cp1' && S.cpTxs().length === 2 && S.cpOn() === true,
      cur: S.cpActiveId(), n: S.cpTxs().length, on: S.cpOn() };
  `);

  // ============ 5. 彻底删除 ============
  console.log('\n=== 5. 彻底删除 ===');
  await t('5.1 删除入口在第一屏不显眼，要点「不再需要它了」才进', `
    App.go('couple'); ViewCouple.setStep('main'); ViewCouple.render(document.querySelector('.view[data-view="couple"]'));
    await new Promise(r => setTimeout(r, 260));
    document.querySelector('.view[data-view="couple"] [data-cp="off"]').click();
    await new Promise(r => setTimeout(r, 320));
    // 走完整关闭流程到「收好了」那屏
    document.querySelector('#sheet-root .sheet [data-cq="next"]').click();
    await new Promise(r => setTimeout(r, 420));
    document.querySelector('#sheet-root [data-reason="pause"]').click();
    await new Promise(r => setTimeout(r, 420));
    document.querySelector('#sheet-root .sheet [data-cq="do"]').click();
    await new Promise(r => setTimeout(r, 520));
    const sh = document.querySelector('#sheet-root .sheet');
    return { ok: !!sh && !!sh.querySelector('.cpq-del') && !sh.querySelector('.btn--danger') };
  `);
  await t('5.2 删除第一屏：说明后果，主按钮是「先不删」', `
    document.querySelector('#sheet-root .sheet .cpq-del').click();
    await new Promise(r => setTimeout(r, 420));
    const sh = document.querySelector('#sheet-root .sheet');
    return { ok: !!sh && /彻底删除/.test(sh.textContent) && sh.querySelector('.cpq-main').textContent.trim() === '先不删'
      && !!sh.querySelector('.btn--danger') };
  `);
  await t('5.3 第二屏必须打字才能删，按钮初始是灰的', `
    document.querySelector('#sheet-root .sheet [data-cq="next"]').click();
    await new Promise(r => setTimeout(r, 420));
    const inp = document.querySelector('#cpq-del-input');
    const ok = document.querySelector('#sheet-root .sheet [data-cq="do"]');
    return { ok: !!inp && !!ok && ok.disabled === true };
  `);
  await t('5.4 打错字按钮还是灰的', `
    const inp = document.querySelector('#cpq-del-input');
    inp.value = '删';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const ok = document.querySelector('#sheet-root .sheet [data-cq="do"]');
    return { ok: ok.disabled === true, dis: ok.disabled };
  `);
  await t('5.5 打对字按钮才亮', `
    const inp = document.querySelector('#cpq-del-input');
    inp.value = '删除';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const ok = document.querySelector('#sheet-root .sheet [data-cq="do"]');
    return { ok: ok.disabled === false };
  `);
  const before = await evalJs(`
    return { n: S.cpTxsOf('cp2').length, other: S.cpTxsOf('cp1').length, books: S.cpBooks().length };
  `);
  await t('5.6 删掉当前这本：只删这一本，另一本一条没动', `
    // 这一关删的是「当前在用的那本」。第 5.1 步把 cp1 关掉后重新打开过，
    // 当前可能已经是 cp2，所以不能写死编号 —— 先记下删前是谁。
    const victim0 = S.cpActiveId();
    const other0 = S.cpBooks().map(b => b.id).filter(id => id !== victim0)[0];
    const otherN = other0 ? S.cpTxsOf(other0).length : -1;
    document.querySelector('#sheet-root .sheet [data-cq="do"]').click();
    await new Promise(r => setTimeout(r, 620));
    const left = S.cpBooks().map(b => b.id);
    return { ok: S.cpBooks().length === ${before.books - 1}
      && left.indexOf(victim0) < 0 && left.indexOf(other0) >= 0
      && S.cpTxsOf(other0).length === otherN,
      victim: victim0, other: other0, left: left.join(','), otherN };
  `);
  await t('5.7 删完显示「删掉了」', `
    const sh = document.querySelector('#sheet-root .sheet');
    return { ok: !!sh && /删掉了/.test(sh.textContent) };
  `);
  await t('5.8 删完自动落到剩下那本，不会显示空白的开通页', `
    document.querySelector('#sheet-root .sheet .cpq-main').click();
    await new Promise(r => setTimeout(r, 500));
    try { UI.closeAllSheets(); } catch(e){}
    App.go('couple'); ViewCouple.render(document.querySelector('.view[data-view="couple"]'));
    await new Promise(r => setTimeout(r, 300));
    const v = document.querySelector('.view[data-view="couple"]');
    // 剩下那本是之前关掉过的，所以落在「最近关掉的那一本」是**对的** ——
    // 关键是不能显示成一本新账本（那会让人以为数据没了）。
    const txt = v.textContent.replace(/\\s+/g, ' ');
    const st = (S.cpActiveBook() || {}).status;
    // 删掉的是当前这本（cp2），剩下 cp1 —— 不能写死编号，按实际剩下的那本断言
    const rest = S.cpBooks()[0] || {};
    return { ok: S.cpBooks().length === 1 && S.cpActiveId() === rest.id
      && (/最近关掉的那一本/.test(txt) || !!v.querySelector('.cp-bill-entry')),
      books: S.cpBooks().length, cur: S.cpActiveId(), rest: rest.id, status: st, head: txt.slice(0, 24) };
  `);

  // ============ 6. 全部删光 ============
  console.log('\n=== 6. 全部删光 ===');
  await t('6.1 把最后一本也删掉，回到开通页', `
    S.wipeCpBook();
    ViewCouple.setStep('intro');
    App.go('couple'); ViewCouple.render(document.querySelector('.view[data-view="couple"]'));
    await new Promise(r => setTimeout(r, 300));
    const v = document.querySelector('.view[data-view="couple"]');
    return { ok: S.cpBooks().length === 0 && S.cpTxs().length === 0 && /开始/.test(v.textContent)
      && !/上次的情侣账本还在|最近关掉的那一本/.test(v.textContent),
      books: S.cpBooks().length, t: v.textContent.slice(0,26) };
  `);
  await t('6.2 删光之后重新开通，又是一本新的', `
    S.enableCouple({ meName: '我', peerName: '你', mode: 'local', togetherSince: '2026-01-01' });
    return { ok: S.cpBooks().length === 1 && S.cpTxs().length === 0 && S.cpOn() === true };
  `);

  // ============ 7. 旧数据迁移 ============
  console.log('\n=== 7. 老用户升级 ===');
  await t('7.1 没有 cpBookId 的老记录会自动归到第一本', `
    const raw = JSON.parse(JSON.stringify(S.state));
    raw.cpTxs = [{ id: 'old1', type: 'expense', amount: 3300, catId: 'food', ts: Date.now(), attrib: 'me' }];
    raw.cpBooks = [];
    raw.goals = raw.goals.filter(g => g.kind !== 'couple');
    raw.settings.couple = Object.assign({}, raw.settings.couple, { enabled: true, meName: '甲', peerName: '乙', mode: 'local', togetherSince: '2025-01-01', activeId: '' });
    const m = S.migrate(raw);
    return { ok: m.cpBooks.length === 1 && m.cpTxs[0].cpBookId === 'cp1' && m.settings.couple.activeId === 'cp1',
      books: m.cpBooks.length, bid: m.cpTxs[0] && m.cpTxs[0].cpBookId, act: m.settings.couple.activeId };
  `);
  await t('7.2 老数据里已关闭的账本迁移后仍是关闭的', `
    const raw = JSON.parse(JSON.stringify(S.state));
    raw.cpTxs = [];
    raw.cpBooks = [];
    raw.goals = [];
    raw.settings.couple = Object.assign({}, raw.settings.couple, { enabled: false, meName: '甲', peerName: '乙', mode: 'local', togetherSince: '2025-01-01', activeId: '' });
    const m = S.migrate(raw);
    return { ok: m.cpBooks.length === 1 && m.cpBooks[0].status === 'closed', st: m.cpBooks[0] && m.cpBooks[0].status };
  `);

  await sleep(200);
  console.log(`\n${'─'.repeat(50)}`);
  if (errors.length) { console.log('JS 异常：'); errors.slice(0, 6).forEach((e) => console.log('  ' + e.split('\n')[0])); }
  else console.log('JS 异常：none');
  console.log(`通过 ${pass} / ${pass + fail}`);
  ws.close(); await env.stop(edge);
  process.exit(fail ? 1 : 0);
})();
