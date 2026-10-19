// 用假 window/DOM 复刻 view-couple.js 里 consent 步骤的 resize 监听逻辑，
// 模拟「反复进出协议步骤 5 次」，验证 window 上的 resize 监听数量不增长。
// 这是纯逻辑仿真，不加载真实页面。

function makeWindow() {
  const listeners = [];
  return {
    listeners,
    addEventListener(t, fn) { listeners.push({ t, fn }); },
    removeEventListener(t, fn) {
      const i = listeners.findIndex((l) => l.t === t && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    count() { return listeners.filter((l) => l.t === 'resize').length; },
    fire() { listeners.filter((l) => l.t === 'resize').forEach((l) => l.fn()); },
  };
}

// 假节点：每次 render 都是全新对象，isConnected 在被换掉后变 false
function makeNode() { return { isConnected: true, scrollHeight: 2000, scrollTop: 0, clientHeight: 500 }; }

function run(fixed) {
  const win = makeWindow();
  // 模块级句柄：修好后的版本才有
  let consentResizeHandler = null;
  let step = 'intro';
  let currentSc = null;
  const counts = [];

  function bindOnboarding() {
    currentSc = null; // 上一次渲染出来的节点先失效
    if (fixed && consentResizeHandler) {
      win.removeEventListener('resize', consentResizeHandler);
      consentResizeHandler = null;
    }
    if (step !== 'consent' && step !== 'profile' && step !== 'mode') return;

    // 真实代码里这段被 if (sc && cb && okBtn) 包着：只有协议页才有
    // #cp-consent-scroll，profile / mode 页根本拿不到这个节点。
    if (step !== 'consent') return;
    const sc = makeNode();
    currentSc = sc;
    let unlocked = false;
    const TH = 8;
    const atEnd = () => sc.scrollHeight - sc.scrollTop - sc.clientHeight <= TH;
    const overflow = () => sc.scrollHeight - sc.clientHeight > 4;
    if (overflow()) {
      if (fixed) {
        consentResizeHandler = () => {
          if (!sc.isConnected) return;
          if (!unlocked && atEnd()) unlocked = true;
        };
        win.addEventListener('resize', consentResizeHandler);
      } else {
        // 修复前的写法：匿名闭包，从不解绑
        win.addEventListener('resize', () => {
          if (!unlocked && atEnd()) unlocked = true;
        });
      }
    }
  }

  for (let i = 1; i <= 5; i++) {
    step = 'consent';
    bindOnboarding();              // 进协议页
    counts.push(win.count());
    step = 'profile';
    bindOnboarding();              // 同意后进入资料页
    if (currentSc) currentSc.isConnected = false;
    step = 'intro';
    bindOnboarding();              // 退回起手页
  }
  return counts;
}

const before = run(false);
const after = run(true);
console.log('修复前，每轮进协议页后 window 上的 resize 监听数：', before.join(', '));
console.log('修复后，每轮进协议页后 window 上的 resize 监听数：', after.join(', '));
console.log(before[4] === 5 && after.every((c) => c === 1)
  ? '✅ 验证通过：修复前累积到 5 个，修复后恒为 1'
  : '❌ 验证失败');
