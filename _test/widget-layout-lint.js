#!/usr/bin/env node
/**
 * 桌面小组件布局的「桌面白名单」自检。
 *
 * 为什么要有这个脚本：
 * 小组件布局**不是在 App 进程 inflate，而是在桌面进程 inflate**，桌面有一份
 * View 类白名单。布局里出现裸 <View> / <Space>，桌面会抛
 *   InflateException: Class not allowed to be inflated android.view.View
 * 而这个异常 App 侧的 try/catch 永远抓不到 —— 用户只看到「载入窗口小部件时出现
 * 问题」，代码里一切正常。所以必须靠静态检查卡住，别指望运行时发现。
 *
 * 检查项：
 *   1. 布局里只能用白名单内的 View 类（含 no-View 的撑条写法）
 *   2. 不许用主题属性（?attr/ 、?android:attr/）—— launcher 的 Context 主题不可靠
 *   3. 不许用 previewLayout（会在系统界面进程里再 inflate 一次）
 *   4. 每份 widget_info_*.xml 的 initialLayout 必须指向真实存在的布局
 *   5. 每份 widget_info_*.xml 都要有 minWidth/minHeight（尺寸按 70n-30 的网格算）
 *
 * 用法：node _test/widget-layout-lint.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const LAYOUT = path.join(RES, 'layout');
const XMLDIR = path.join(RES, 'xml');

/** 官方 "Creating App Widget Layouts" 列出的、桌面肯定放行的控件 */
const ALLOWED = new Set([
  'LinearLayout', 'RelativeLayout', 'FrameLayout', 'GridLayout',
  'TextView', 'ImageView', 'ImageButton', 'Button', 'EditText',
  'ProgressBar',          // 官方白名单内，但部分 OEM 边缘 —— 本项目不用它
  'Chronometer', 'AnalogClock',
]);

let failed = 0;
const fail = (msg) => { console.log('  ✗ ' + msg); failed++; };
const ok = (msg) => console.log('  ✓ ' + msg);

const layoutFiles = fs.readdirSync(LAYOUT).filter((f) => /^widget_.*\.xml$/.test(f));
if (!layoutFiles.length) {
  console.error('没找到 widget_*.xml，路径不对？' + LAYOUT);
  process.exit(1);
}

console.log('\n▶ 布局白名单检查（' + layoutFiles.length + ' 个文件）');
for (const f of layoutFiles) {
  const src = fs.readFileSync(path.join(LAYOUT, f), 'utf8')
    // 注释里会写「别用 <View>」这种说明，先剥掉注释再检查，否则自己误伤自己
    .replace(/<!--[\s\S]*?-->/g, '');

  // 1. View 类白名单
  const tags = new Set();
  const re = /<([A-Za-z][\w.]*)/g;
  let m;
  while ((m = re.exec(src))) {
    const tag = m[1];
    if (tag === 'application') continue;
    tags.add(tag);
  }
  // 末尾带点的是自闭合属性值之类，忽略；只看首段类名
  const bad = [...tags].filter((t) => !ALLOWED.has(t.split('.').pop()));
  if (bad.length) fail(`${f}：用了白名单外的 View 类 → ${bad.join(', ')}`);
  else ok(`${f}：只用 ${[...tags].join(' / ')}`);

  // 2. 主题属性
  if (/\?android:attr\/|\?attr\//.test(src)) fail(`${f}：用了主题属性（?attr/ 或 ?android:attr/）`);

  // 3. previewLayout 不在布局里，但顺手查一下 previewImage 用法是否合理
  if (/android:previewLayout/.test(src)) fail(`${f}：布局里不该出现 previewLayout`);
}

console.log('\n▶ 元信息检查');
const infoFiles = fs.readdirSync(XMLDIR).filter((f) => /^widget_info_.*\.xml$/.test(f));
if (!infoFiles.length) fail('没有 widget_info_*.xml —— 桌面里就不会有尺寸入口');
for (const f of infoFiles) {
  const src = fs.readFileSync(path.join(XMLDIR, f), 'utf8');
  const layoutRef = /android:initialLayout="@layout\/([\w]+)"/.exec(src);
  if (!layoutRef) fail(`${f}：缺 initialLayout`);
  else {
    const p = path.join(LAYOUT, layoutRef[1] + '.xml');
    if (!fs.existsSync(p)) fail(`${f}：initialLayout 指向不存在的 @layout/${layoutRef[1]}`);
    else ok(`${f}：initialLayout = ${layoutRef[1]}.xml`);
  }
  if (/android:previewLayout/.test(src)) fail(`${f}：不要用 previewLayout（会在系统界面进程再 inflate 一次）`);
  if (!/android:minWidth=/.test(src) || !/android:minHeight=/.test(src)) {
    fail(`${f}：缺 minWidth/minHeight（桌面靠它算占几格）`);
  }
}

// 4. manifest 里每个 provider 元信息都要对得上
console.log('\n▶ Manifest 与元信息对齐');
const manifest = fs.readFileSync(
  path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const mRefs = [...manifest.matchAll(/android\.appwidget\.provider"\s*\n\s*android:resource="@xml\/([\w]+)"/g)]
  .map((x) => x[1]);
const mRefsAlt = [...manifest.matchAll(/android:resource="@xml\/(widget_info_[\w]+)"/g)].map((x) => x[1]);
const refs = new Set([...mRefs, ...mRefsAlt]);
if (!refs.size) fail('Manifest 里没有注册任何 appwidget 元信息');
for (const r of refs) {
  if (!fs.existsSync(path.join(XMLDIR, r + '.xml'))) fail(`Manifest 引用了不存在的 @xml/${r}`);
}
const sizes = refs.size;
if (sizes && sizeCheck()) ok(`注册了 ${sizes} 个尺寸入口：${[...refs].join(', ')}`);

function sizeCheck() {
  const labels = [...manifest.matchAll(/android:name="\.widget\.(BillWidget\w*Provider)"/g)].map((x) => x[1]);
  if (labels.length !== refs.size) {
    fail(`receiver 数量（${labels.length}）和元信息数量（${refs.size}）不一致`);
    return false;
  }
  return true;
}

console.log(failed ? `\n✖ ${failed} 项不通过\n` : '\n✅ 全部通过\n');
process.exit(failed ? 1 : 0);
