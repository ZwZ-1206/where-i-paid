#!/usr/bin/env node
/**
 * 上传到 GitHub —— 交互式一键推送
 *
 * 为什么用 Node 而不是纯 bat：
 *   cmd.exe 解析批处理时按 CRLF 计字节，遇到 LF 换行会跳错偏移量，
 *   导致半行代码被当成命令、汉字被截断成乱码。逻辑放 Node 里彻底绕开。
 *
 * 用法：
 *   node _tools/upload-github.js              正常上传
 *   node _tools/upload-github.js --dry-run    只检查，不改动任何东西
 */
'use strict';

const { spawnSync } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');

/**
 * 找 git 可执行文件。
 *
 * 这台机器没装独立 Git，只有 WorkBuddy 内置的 PortableGit，
 * 它不在系统 PATH 里，所以双击 bat 时直接 `git` 会失败。按优先级逐个找：
 *   1. 环境变量 GIT_EXE（想强制指定就设它）
 *   2. 系统 PATH
 *   3. 常规安装位置
 *   4. WorkBuddy 内置的 PortableGit
 */
function resolveGit() {
  const tried = [];
  const candidates = [];

  if (process.env.GIT_EXE) candidates.push(process.env.GIT_EXE);

  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const d of dirs) candidates.push(path.join(d, 'git.exe'));

  const local = process.env.LOCALAPPDATA || '';
  const home = process.env.USERPROFILE || '';
  candidates.push(
    'C:/Program Files/Git/cmd/git.exe',
    'C:/Program Files (x86)/Git/cmd/git.exe',
    path.join(local, 'Programs/Git/cmd/git.exe'),
    'C:/Apps/WorkBuddy/resources/vendor/PortableGit/cmd/git.exe'
  );

  // WorkBuddy 的另一些内置位置：%USERPROFILE%\.workbuddy\binaries\PortableGit\versions\*
  const versionsDir = path.join(home, '.workbuddy', 'binaries', 'PortableGit', 'versions');
  try {
    for (const v of fs.readdirSync(versionsDir)) {
      candidates.push(path.join(versionsDir, v, 'cmd', 'git.exe'));
      candidates.push(path.join(versionsDir, v, 'bin', 'git.exe'));
    }
  } catch (_) {
    /* 目录不存在就算了 */
  }

  for (const exe of candidates) {
    if (!exe) continue;
    tried.push(exe);
    try {
      if (!fs.existsSync(exe)) continue;
      const r = spawnSync(exe, ['--version'], { encoding: 'utf8' });
      if (r.status !== 0) continue;

      // cmd/git.exe 的上一级就是 Git 根目录；PortableGit 还需要把 mingw64\bin
      // 加进 PATH，否则 credential.helper=manager 找不到 GCM，推送时会卡在输密码
      let gitRoot = null;
      const base = path.basename(path.dirname(exe)).toLowerCase();
      if (base === 'cmd' || base === 'bin') gitRoot = path.dirname(path.dirname(exe));

      const pathParts = (process.env.PATH || '').split(path.delimiter);
      if (gitRoot) {
        pathParts.unshift(path.join(gitRoot, 'cmd'), path.join(gitRoot, 'mingw64', 'bin'));
      }

      return {
        exe,
        root: gitRoot,
        version: (r.stdout || '').trim(),
        env: Object.assign({}, process.env, { PATH: pathParts.filter(Boolean).join(path.delimiter) }),
      };
    } catch (_) {
      /* 这个候选不可用，继续下一个 */
    }
  }

  return { exe: null, tried };
}

const GIT = resolveGit();

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function git(args, opts) {
  if (!GIT.exe) return { ok: false, out: '', err: 'GIT_NOT_FOUND', status: 127 };
  const r = spawnSync(GIT.exe, args, Object.assign({ cwd: ROOT, encoding: 'utf8', env: GIT.env }, opts || {}));
  return {
    ok: r.status === 0,
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim(),
    status: r.status,
  };
}

function die(msg, hint) {
  console.error('');
  console.error(C.red('  [失败] ') + msg);
  if (hint) console.error(C.dim('         ' + hint));
  console.error('');
  process.exit(1);
}

/** 问一个问题；直接回车返回 fallback；EOF（管道/双击异常）返回 null */
function ask(question, fallback) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      const v = String(answer || '').trim();
      resolve(v || fallback || '');
    });
    rl.on('close', () => {
      if (!answered) resolve(null);
    });
  });
}

const line = (s) => console.log('  ' + (s || ''));
const gap = () => console.log('');

async function main() {
  console.log('');
  console.log('  ============================================');
  console.log('     花哪儿了 · 上传代码到 GitHub');
  console.log('  ============================================');
  gap();

  if (DRY) {
    console.log(C.cyan('  [试运行] 只检查状态，不会提交也不会推送'));
    gap();
  }

  // ---------- 0. 环境 ----------
  if (!GIT.exe) {
    console.error('');
    console.error(C.red('  [失败] 找不到 git'));
    console.error(C.dim('         系统 PATH 和常规安装位置都没有，WorkBuddy 内置的也没找到。'));
    console.error('');
    console.error('  两个办法，选一个：');
    console.error('    1) 装正式版 Git（推荐，一次装好永久可用）：');
    console.error(C.cyan('       winget install --id Git.Git -e'));
    console.error('    2) 已经有 git.exe 但不在 PATH，直接告诉脚本位置：');
    console.error(C.cyan('       set GIT_EXE=D:\\你的路径\\cmd\\git.exe'));
    console.error('');
    process.exit(1);
  }
  line(C.dim(GIT.version));
  if (/WorkBuddy|workbuddy/.test(GIT.exe)) {
    line(C.dim('用的是 WorkBuddy 内置的 Git（没装独立版，先凑合用）'));
  }

  if (!git(['rev-parse', '--git-dir']).ok) {
    if (DRY) die('当前目录还不是 Git 仓库', '去掉 --dry-run 再跑一次，会自动 git init');
    line('还不是 Git 仓库，正在初始化……');
    git(['init']);
  }
  line(C.dim('仓库：' + ROOT));

  // ---------- 1. 提交身份 ----------
  let email = git(['config', 'user.email']).out;
  let name = git(['config', 'user.name']).out;

  if (!email || !name) {
    console.log('');
    line(C.bold('第一次上传，先记录一下你的 GitHub 用户名（只问一次）'));
    line(C.dim('它只会写进本仓库的 .git/config，不会上传，也不含密码'));

    if (DRY) {
      line(C.dim('（试运行跳过提问，假设用户名已配置）'));
    } else {
      const u = await ask('  用户名: ');
      if (u === null || !u) die('没拿到用户名，已取消', '重跑一次，输入你的 GitHub 用户名');
      if (!/^[A-Za-z0-9-]+$/.test(u)) {
        die('用户名格式不对：' + u, 'GitHub 用户名只含字母、数字、连字符');
      }
      git(['config', 'user.name', u]);
      git(['config', 'user.email', u + '@users.noreply.github.com']);
      name = u;
      email = u + '@users.noreply.github.com';
      line(C.green('  ✓ 已记录：' + u));
    }
  } else {
    line(C.dim('提交身份：' + name + ' <' + email + '>'));
  }

  // ---------- 2. 远程仓库 ----------
  let remote = git(['remote', 'get-url', 'origin']).out;

  if (!remote) {
    console.log('');
    line(C.bold('还没有绑定远程仓库'));
    gap();
    line('先去浏览器打开  ' + C.cyan('https://github.com/new'));
    line('  · Repository name 填  whereipaid');
    line('  · 选 Public');
    line('  · ' + C.bold('三个初始化选项都不要勾') + '（README / .gitignore / license）');
    gap();
    line(C.dim('勾了任意一个，GitHub 会先建一条提交，和本地历史是两条线，推送会被拒绝。'));
    gap();

    if (DRY) {
      line(C.dim('（试运行跳过提问，假设远程已绑定）'));
    } else {
      const url = await ask('  粘贴仓库地址（https://github.com/用户名/whereipaid.git）: ');
      if (url === null || !url) die('没拿到仓库地址，已取消');
      if (!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+?(\.git)?$/.test(url)) {
        die('这不像 GitHub 仓库地址：' + url, '形如 https://github.com/用户名/whereipaid.git');
      }
      const add = git(['remote', 'add', 'origin', url]);
      if (!add.ok) die('绑定远程失败：' + add.err);
      remote = url;
      line(C.green('  ✓ 已绑定：' + url));
    }
  } else {
    line(C.dim('远程仓库：' + remote));
  }

  // ---------- 3. 检查将要提交的内容 ----------
  console.log('');
  line(C.bold('检查改动……'));
  git(['add', '-A']);
  const staged = git(['diff', '--cached', '--name-only']).out;
  const files = staged ? staged.split('\n').filter(Boolean) : [];
  const hasChanges = files.length > 0;

  // 安全网：签名文件绝不能进仓库
  const leaked = files.filter((f) => /keystore|\.jks$|local\.properties$/i.test(f));
  if (leaked.length) {
    git(['reset']);
    die('检测到签名/本机配置文件被加进暂存区：\n         ' + leaked.join('\n         '),
      '这些文件永远不能上传。检查 .gitignore 后重试');
  }

  const author = 'HEAD';
  const commitCount = git(['rev-list', '--count', author]);
  line(C.dim('本次涉及 ' + files.length + ' 个文件，仓库已有 ' + (commitCount.ok ? commitCount.out : 0) + ' 条提交'));

  if (!hasChanges) {
    line(C.dim('没有新改动，跳过提交。'));
  }

  if (DRY) {
    gap();
    line(C.cyan('试运行结束。去掉 --dry-run 就会真的提交并推送。'));
    gap();
    return;
  }

  // ---------- 4. 提交 ----------
  if (hasChanges) {
    gap();
    let msg = await ask('  这次改了什么（直接回车用默认说法）: ', '更新：花哪儿了');
    if (msg === null) msg = '更新：花哪儿了';
    const c = git(['commit', '-m', msg]);
    if (!c.ok) die('提交失败：\n         ' + (c.err || c.out));
    line(C.green('  ✓ 已提交：' + msg));
  }

  // ---------- 5. 推送 ----------
  const branch = git(['symbolic-ref', '--short', 'HEAD']).out || 'main';
  console.log('');
  line(C.bold('正在推送，如果弹出浏览器请点「授权」……'));
  gap();

  const push = spawnSync(GIT.exe, ['push', '-u', 'origin', branch], {
    cwd: ROOT,
    stdio: 'inherit',
    env: GIT.env,
  });
  if (push.status !== 0) {
    console.log('');
    die('推送没成功。常见原因：',
      '1) 浏览器授权窗口被关掉了 → 再跑一次\n' +
      '         2) 建仓库时勾了 README → 删掉仓库重建一个空的\n' +
      '         3) 网络或代理问题');
  }

  // ---------- 6. 收尾 ----------
  const web = remote.replace(/\.git$/, '').replace(/^git@github\.com:/, 'https://github.com/');
  console.log('');
  console.log('  ============================================');
  console.log('     ' + C.green('上传完成'));
  console.log('  ============================================');
  line(web);
  gap();
  line(C.bold('下一步：发 Release 挂 APK（网页上点几下）'));
  line('  仓库页右侧 Releases → Draft a new release');
  line('  tag 填 v1.17.8，把 dist-apk 里的 apk 拖进 binaries');
  line(C.dim('  详见《上传GitHub操作手册.md》第 3 节'));
  gap();
}

main().catch((e) => die(e && e.message ? e.message : String(e)));
