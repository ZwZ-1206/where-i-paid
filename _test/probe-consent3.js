/* 探针：勾选后等过渡结束再量颜色；并验证「点 label 也能勾上」 */
const { spawn } = require('child_process');
const env = require('./_env');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9413;
const PROFILE = env.profile('probe-consent3');

async function main() {
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
  const child = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + PROFILE, '--no-first-run', '--disable-gpu',
    '--window-size=390,844', 'about:blank'], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
      target = list.find((t) => t.type === 'page');
    } catch (e) {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params) => new Promise((res) => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return 'ERR: ' + JSON.stringify(r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const sleep = (n) => new Promise((r) => setTimeout(r, n));

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:4173/?p=' + Date.now() });
  await sleep(2600);
  await ev(`localStorage.clear(); location.reload(); 1`); await sleep(2600);
  await ev(`App.go('couple'); 1`); await sleep(400);
  await ev(`document.querySelector('#view-couple [data-cp="to-consent"]').click(); 1`); await sleep(500);

  const probe = `(() => {
    const box = document.querySelector('.cp-box');
    const cs = getComputedStyle(box);
    const ok = document.querySelector('#cp-consent-ok');
    return JSON.stringify({
      bg: cs.backgroundColor, border: cs.borderTopColor,
      icon: getComputedStyle(box.querySelector('.ic')).opacity,
      disabled: ok.disabled,
      checked: document.querySelector('#cp-agree').checked,
    });
  })()`;

  console.log('初始      :', await ev(probe));

  // 先滚到底（协议页要求滚到底才允许勾选）
  await ev(`(() => { const sc=document.querySelector('#cp-consent-scroll'); sc.scrollTop = sc.scrollHeight; return 1; })()`);
  await sleep(300);

  // 走真实点击路径：点 label
  await ev(`document.querySelector('#view-couple .cp-check').click(); 1`);
  await sleep(450);
  console.log('点 label 后:', await ev(probe));

  // 再点一次应该取消
  await ev(`document.querySelector('#view-couple .cp-check').click(); 1`);
  await sleep(450);
  console.log('再点一次后:', await ev(probe));

  ws.close(); child.kill();
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (e) {}
}
main().catch((e) => { console.error(e); process.exit(1); });
