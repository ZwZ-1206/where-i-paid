#!/usr/bin/env node
/**
 * 更新 GitHub 令牌并验证写权限，然后直接推送
 *
 * 为什么需要它：
 *   Windows 凭据管理器里可能存着一个「能读不能写」的旧令牌，
 *   你在网页上改好的是另一个令牌 —— 两边对不上，推送就永远 403。
 *   这个脚本把**你剪贴板里的令牌**写进凭据管理器，再当场验一次能不能写。
 *
 * 用法：
 *   1) 在 GitHub 复制令牌（或 Regenerate 一个）
 *   2) 双击「更新GitHub令牌.bat」
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/* ---------- 找 git（这台机器没有独立 Git，逻辑同 upload-github.js） ---------- */
function resolveGit() {
  const candidates = [];
  if (process.env.GIT_EXE) candidates.push(process.env.GIT_EXE);
  (process.env.PATH || '').split(path.delimiter).filter(Boolean)
    .forEach((d) => candidates.push(path.join(d, 'git.exe')));
  const home = process.env.USERPROFILE || '';
  candidates.push('C:/Program Files/Git/cmd/git.exe', 'C:/Program Files (x86)/Git/cmd/git.exe');
  const versionsDir = path.join(home, '.workbuddy', 'binaries', 'PortableGit', 'versions');
  try {
    fs.readdirSync(versionsDir).forEach((v) => {
      candidates.push(path.join(versionsDir, v, 'cmd', 'git.exe'));
      candidates.push(path.join(versionsDir, v, 'bin', 'git.exe'));
    });
  } catch (e) { /* 没有就算了 */ }
  for (const exe of candidates) {
    try {
      if (exe && fs.existsSync(exe) && spawnSync(exe, ['--version']).status === 0) return exe;
    } catch (e) { /* 下一个 */ }
  }
  return 'git';
}

const GIT = resolveGit();

function readClipboard() {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8' });
  return String(r.stdout || '').replace(/\s+/g, '');
}

function api(method, urlPath, token, body) {
  const args = ['-s', '-m', '60', '-X', method,
    '-H', 'Authorization: token ' + token,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: huanaer-token-check'];
  if (body) args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(body));
  args.push('-w', '\n%{http_code}', 'https://api.github.com' + urlPath);
  const r = spawnSync('curl', args, { encoding: 'utf8' });
  const out = String(r.stdout || '');
  const nl = out.lastIndexOf('\n');
  return { code: Number(out.slice(nl + 1).trim()), body: out.slice(0, nl) };
}

(async () => {
  const token = readClipboard();
  if (!token) {
    console.error('剪贴板里没有文字。先复制令牌再运行；如果刚截过图，剪贴板里是图片不是文字，重新复制一次令牌。');
    process.exit(1);
  }
  if (!/^(github_pat_|ghp_|gho_|ghs_)/.test(token) || token.length < 20) {
    console.error('剪贴板里不像 GitHub 令牌（应以 github_pat_ 或 ghp_ 开头）：' + token.slice(0, 8) + '…');
    process.exit(1);
  }
  console.log('读到令牌：' + token.slice(0, 12) + '…' + token.slice(-4));

  // 1) 写进 Windows 凭据管理器（只存凭据，不落任何文件）
  const input = 'protocol=https\nhost=github.com\nusername=ZwZ-1206\npassword=' + token + '\n\n';
  const approve = spawnSync(GIT, ['credential', 'approve'], { input, encoding: 'utf8' });
  if (approve.status !== 0) {
    console.error('写入凭据失败：' + (approve.stderr || approve.stdout));
    process.exit(1);
  }
  console.log('已写入 Windows 凭据管理器。');
  try { spawnSync('powershell', ['-NoProfile', '-Command', 'Set-Clipboard -Value " "']); } catch (e) { /* 清空剪贴板 */ }

  // 2) 验证：读仓库 + 试写一个空 blob（写了也不影响任何东西）
  const repo = api('GET', '/repos/ZwZ-1206/where-i-paid', token);
  if (repo.code !== 200) {
    console.error('读仓库失败（HTTP ' + repo.code + '）：令牌可能没勾选这个仓库。');
    process.exit(1);
  }
  const write = api('POST', '/repos/ZwZ-1206/where-i-paid/git/blobs', token,
    { content: Buffer.from('token-check').toString('base64'), encoding: 'base64' });
  if (write.code !== 201) {
    console.error('写权限仍然不足（HTTP ' + write.code + '）。请确认 Contents = Read and write，且 Repository access 勾了这个仓库。');
    process.exit(1);
  }
  console.log('写权限验证通过 ✓');

  // 3) 直接推送
  console.log('\n开始推送……');
  const push = spawnSync(process.execPath, [path.join(ROOT, '_tools', 'push-github-api.js')], {
    cwd: ROOT, stdio: 'inherit', env: Object.assign({}, process.env, { GIT_EXE: GIT }),
  });
  process.exit(push.status == null ? 1 : push.status);
})().catch((e) => {
  console.error('失败：' + e.message);
  process.exit(1);
});
