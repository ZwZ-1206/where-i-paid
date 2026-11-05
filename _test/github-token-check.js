#!/usr/bin/env node
/**
 * GitHub 令牌体检（只读，绝不打印令牌本身）
 *
 * 用途：推送报 403 时，分清是「令牌类型不对 / 没绑这个仓库 / 没给写权限」中的哪一种。
 * 这三种在 git push 里长得一模一样，但修法完全不同。
 *
 * 用法：node _test/github-token-check.js
 */
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPO = 'ZwZ-1206/where-i-paid';

// 复用 upload-github.js 找 git 的办法（这台机器没独立 Git）
function resolveGit() {
  const home = process.env.USERPROFILE || '';
  const versionsDir = path.join(home, '.workbuddy', 'binaries', 'PortableGit', 'versions');
  const cands = [process.env.GIT_EXE, 'C:/Program Files/Git/cmd/git.exe', 'git'];
  try {
    for (const v of fs.readdirSync(versionsDir)) {
      cands.push(path.join(versionsDir, v, 'cmd', 'git.exe'));
      cands.push(path.join(versionsDir, v, 'bin', 'git.exe'));
    }
  } catch (_) { /* 目录不存在 */ }
  for (const c of cands) {
    if (!c) continue;
    try {
      const r = spawnSync(c, ['--version'], { encoding: 'utf8' });
      if (r.status === 0) return c;
    } catch (_) { /* 试下一个 */ }
  }
  return null;
}

const GIT = resolveGit();
if (!GIT) { console.error('找不到 git'); process.exit(1); }

// 从 Windows 凭据管理器取令牌（cmd.exe 没有 printf，所以用 input 直接喂）
const fill = spawnSync(GIT, ['credential', 'fill'], {
  cwd: ROOT,
  encoding: 'utf8',
  input: 'protocol=https\nhost=github.com\n\n',
});
const out = fill.stdout || '';
const token = (/password=([^\r\n]+)/.exec(out) || [])[1] || '';
const user = (/username=([^\r\n]+)/.exec(out) || [])[1] || '';

if (!token) {
  console.error('凭据管理器里没取到令牌。先跑「更新GitHub令牌.bat」。');
  process.exit(1);
}

// 只暴露「是哪一类令牌」，不打印任何实际字符
const kind = token.startsWith('github_pat_') ? '细粒度令牌（Fine-grained）'
  : token.startsWith('ghp_') ? '经典令牌（Classic）'
    : '未知前缀';

(async () => {
  console.log('\n▶ 令牌体检（只读）');
  console.log('  凭据里的用户名 : ' + (user || '(空)'));
  console.log('  令牌类型      : ' + kind + '（长度 ' + token.length + '）');

  const who = await fetch('https://api.github.com/user', {
    headers: { authorization: 'Bearer ' + token, 'user-agent': 'token-check' },
  });
  if (!who.ok) {
    console.log('  ✗ 令牌无效或已过期（/user → ' + who.status + '）');
    console.log('    换一个新令牌：Settings → Developer settings → Personal access tokens');
    process.exit(1);
  }
  const me = await who.json();
  console.log('  登录身份      : ' + me.login);
  const scopes = who.headers.get('x-oauth-scopes');
  console.log('  令牌作用域    : ' + (scopes ? scopes : '（细粒度令牌不通过此头暴露）'));

  // 注意：这个接口的 permissions 是「你这个用户在仓库里的角色」，
  // 不代表令牌本身的权限 —— 令牌没写权限时这里照样可能显示 push: true。
  const repoRes = await fetch('https://api.github.com/repos/' + REPO, {
    headers: { authorization: 'Bearer ' + token, 'user-agent': 'token-check' },
  });
  console.log('  仓库可见性    : ' + (repoRes.ok ? '能读到 ' + REPO : '读不到（' + repoRes.status + '）'));

  // 真正能说明「能不能写」的：对 git refs 发一个只读的 GET 不够，
  // 这里改用安装列表接口判断令牌能否列出自己有权限的仓库
  const inst = await fetch('https://api.github.com/user/installations', {
    headers: { authorization: 'Bearer ' + token, 'user-agent': 'token-check' },
  });
  console.log('  API 连通性    : ' + (inst.status === 200 ? '正常' : inst.status));

  console.log('\n结论判断：');
  console.log('  · 若上面登录身份正确、但仍 403 —— 就是令牌没拿到这个仓库的 Contents 写权限。');
  console.log('  · 细粒度令牌：点开令牌 → Repository access 选中 where-i-paid →');
  console.log('    Permissions → Contents 改成 Read and write → 保存。');
  console.log('  · 经典令牌：重开一个，勾上 repo 整个大类。');
  console.log('  · 改完双击「更新GitHub令牌.bat」重新写进凭据管理器，再跑上传脚本。\n');
})();
