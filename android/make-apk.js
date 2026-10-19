#!/usr/bin/env node
/**
 * 花哪儿了 · 一键出 APK
 *
 * 用法：node android/make-apk.js [--debug]
 *
 * 做的事：
 *   1. 同步网页资源（等价于 node android/sync-www.js）
 *   2. 调 gradlew assembleRelease（或 assembleDebug）
 *   3. 把产物拷到 dist-apk/whereipaid-vX.Y.Z.apk，方便直接上传官网
 *
 * 依赖：JAVA_HOME 指向 JDK 17；ANDROID_HOME 指向 Android SDK。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');

const isDebug = process.argv.includes('--debug');
const androidDir = __dirname;
const root = path.resolve(androidDir, '..');

function fail(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

// ---------- 环境检查 ----------
const javaHome = process.env.JAVA_HOME;
if (!javaHome || !fs.existsSync(path.join(javaHome, 'bin', 'java.exe'))) {
  fail('JAVA_HOME 没指到有效的 JDK。应指向 JDK 17，例如 C:\\Apps\\JDK-17');
}
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk || !fs.existsSync(sdk)) {
  fail('ANDROID_HOME 没指到 Android SDK。例如 C:\\Apps\\Android-SDK');
}

// ---------- 1. 同步资源 ----------
console.log('▶ 同步网页资源');
execFileSync(process.execPath, [path.join(androidDir, 'sync-www.js')], {
  cwd: root,
  stdio: 'inherit',
});

// ---------- 2. 读版本号 ----------
const gradle = fs.readFileSync(path.join(androidDir, 'app', 'build.gradle.kts'), 'utf8');
const version = gradle.match(/versionName\s*=\s*"([^"]+)"/)[1];
const variant = isDebug ? 'debug' : 'release';

// ---------- 3. 构建 ----------
console.log(`\n▶ 开始构建 ${variant}`);
const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const task = isDebug ? 'assembleDebug' : 'assembleRelease';
const r = spawnSync(gradlew, [task, '--console=plain'], {
  cwd: androidDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (r.status !== 0) fail('Gradle 构建失败，看上面的报错（对照《双端打包操作手册》第 8~10 节）');

// ---------- 4. 收集产物 ----------
const apkName = isDebug ? 'app-debug.apk' : 'app-release.apk';
const apkPath = path.join(androidDir, 'app', 'build', 'outputs', 'apk', variant, apkName);
if (!fs.existsSync(apkPath)) fail(`没找到产物：${apkPath}`);

const outDir = path.join(root, 'dist-apk');
fs.mkdirSync(outDir, { recursive: true });
const suffix = isDebug ? '-debug' : '';
const outName = `whereipaid-v${version}${suffix}.apk`;
const outPath = path.join(outDir, outName);
fs.copyFileSync(apkPath, outPath);

const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
console.log(`\n✅ 打包完成`);
console.log(`   文件：${outPath}`);
console.log(`   大小：${sizeMB} MB`);
console.log(`   版本：${version}${suffix}`);
console.log(`\n   下一步：手机连电脑 → adb install -r "${outPath}"`);
