#!/usr/bin/env node
/**
 * 用 GitHub API 推送（`git push` 不通时的备用通道）
 *
 * 为什么要有这个脚本：
 *   有些网络环境下（公司代理 / 本项目的沙箱）`https://github.com` 被挡，
 *   `git push` 直接报 `Failed to connect to github.com:443`，但
 *   `https://api.github.com` 是通的。既然 API 通，就按 Git Data API
 *   手动把 commit 推上去：blob → tree → commit → 更新 ref。
 *
 * 用法：
 *   node _tools/push-github-api.js              # 推送当前分支到 origin 同名分支
 *   node _tools/push-github-api.js --dry-run    # 只算会传哪些文件，不动远端
 */
'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DRY = process.argv.includes('--dry-run');

/* ---------------- 小工具 ---------------- */
const git = (args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024 * 256 });
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};

/** curl 走环境里的代理（Node 的 fetch 不认 http_proxy，这里必须用 curl） */
function api(method, urlPath, body) {
  const args = ['-s', '-m', '180', '-X', method,
    '-H', 'Authorization: token ' + TOKEN,
    '-H', 'Accept: application/vnd.github+json',
    '-H', 'User-Agent: huanaer-uploader'];
  let tmp = null;
  if (body !== undefined) {
    tmp = path.join(os.tmpdir(), 'gh-api-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json');
    fs.writeFileSync(tmp, JSON.stringify(body));
    args.push('-H', 'Content-Type: application/json', '--data-binary', '@' + tmp);
  }
  // 末尾单独一行输出 HTTP 状态码：GitHub 的 commit 对象本身带 message 字段，
  // 不能拿「有没有 message」判断成败（第一版就在这里翻车）
  args.push('-w', '\n%{http_code}', 'https://api.github.com' + urlPath);
  const r = spawnSync('curl', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 512 });
  if (tmp) { try { fs.unlinkSync(tmp); } catch (e) { /* 忽略 */ } }
  if (r.status !== 0) throw new Error('curl 失败：' + (r.stderr || r.stdout));
  const raw = r.stdout || '';
  const nl = raw.lastIndexOf('\n');
  const text = (nl >= 0 ? raw.slice(0, nl) : raw).trim();
  const code = Number((nl >= 0 ? raw.slice(nl + 1) : '').trim());
  let json = {};
  if (text) { try { json = JSON.parse(text); } catch (e) { throw new Error('接口返回的不是 JSON：' + text.slice(0, 200)); } }
  if (!Number.isFinite(code) || code >= 400) {
    throw new Error('HTTP ' + (Number.isFinite(code) ? code : '?') + '：' + (json.message || text.slice(0, 200) || '未知错误'));
  }
  return json;
}

let TOKEN = '';
function loadToken() {
  const cmd = 'printf "protocol=https\\nhost=github.com\\n\\n" | git credential fill';
  const r = spawnSync(cmd, { cwd: ROOT, encoding: 'utf8', shell: true });
  const m = /password=(.+)/.exec(r.stdout || '');
  if (!m) throw new Error('读不到 GitHub 令牌（git credential fill 没结果）');
  TOKEN = m[1].trim();
}

/* ---------------- 主流程 ---------------- */
(async () => {
  const remoteUrl = git(['remote', 'get-url', 'origin']).out;
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(\.git)?\/?$/.exec(remoteUrl || '');
  if (!m) throw new Error('读不到 GitHub 远程地址：' + remoteUrl);
  const owner = m[1], repo = m[2];
  const branch = git(['symbolic-ref', '--short', 'HEAD']).out || 'main';
  const headSha = git(['rev-parse', 'HEAD']).out;

  console.log('仓库  ' + owner + '/' + repo);
  console.log('分支  ' + branch + '  本地 ' + headSha.slice(0, 8));
  loadToken();

  // 1) 远端当前 commit / tree
  const ref = api('GET', '/repos/' + owner + '/' + repo + '/git/refs/heads/' + encodeURIComponent(branch));
  const remoteSha = ref.object.sha;
  console.log('远端  ' + remoteSha.slice(0, 8));
  if (remoteSha === headSha) {
    console.log('已经一致，不用推。');
    return;
  }
  const remoteCommit = api('GET', '/repos/' + owner + '/' + repo + '/git/commits/' + remoteSha);
  const remoteTreeSha = remoteCommit.tree.sha;

  // 2) 远端文件清单（一次递归拿全）
  const remoteTree = api('GET', '/repos/' + owner + '/' + repo + '/git/trees/' + remoteTreeSha + '?recursive=1');
  const remoteFiles = new Map();
  (remoteTree.tree || []).forEach((e) => {
    if (e.type === 'blob') remoteFiles.set(e.path, e.sha);
  });

  // 3) 本地文件清单（HEAD 里有的，未提交的改动不会进来 —— 调用前先 commit）
  // -z：中文文件名不加引号、不用八进制转义，否则拼出来的路径根本打不开
  const ls = git(['ls-tree', '-r', '-z', 'HEAD']).out.split('\0').filter(Boolean);
  const localFiles = new Map();
  ls.forEach((entry) => {
    const t = entry.split('\t');
    if (t.length < 2) return;
    const meta = t[0].split(/\s+/);
    localFiles.set(t[1], { sha: meta[2], mode: meta[0] === '100755' ? '100755' : '100644' });
  });

  const adds = [], mods = [], dels = [];
  localFiles.forEach((v, p) => {
    const r = remoteFiles.get(p);
    if (!r) adds.push(p);
    else if (r !== v.sha) mods.push(p);
  });
  remoteFiles.forEach((_v, p) => { if (!localFiles.has(p)) dels.push(p); });

  console.log(`变更  +${adds.length} 改 ${mods.length} 删 ${dels.length}`);
  if (DRY) {
    [...adds, ...mods].slice(0, 40).forEach((f) => console.log('    ' + f));
    if (adds.length + mods.length > 40) console.log('    ……');
    console.log('试运行，没有动远端。');
    return;
  }

  // 4) 上传变更文件的 blob
  const tree = [];
  const push = async (p) => {
    const buf = fs.readFileSync(path.join(ROOT, p));
    const blob = api('POST', '/repos/' + owner + '/' + repo + '/git/blobs',
      { content: buf.toString('base64'), encoding: 'base64' });
    tree.push({ path: p, mode: localFiles.get(p).mode, type: 'blob', sha: blob.sha });
  };
  for (const p of adds) { process.stdout.write('  上传 ' + p + '\n'); await push(p); }
  for (const p of mods) { process.stdout.write('  更新 ' + p + '\n'); await push(p); }
  for (const p of dels) { tree.push({ path: p, mode: '100644', type: 'blob', sha: null }); }

  if (!tree.length) { console.log('没有差异，不用推。'); return; }

  // 5) tree → commit → 更新 ref
  const newTree = api('POST', '/repos/' + owner + '/' + repo + '/git/trees',
    { base_tree: remoteTreeSha, tree });
  const msg = git(['log', '-1', '--pretty=%s']).out || '更新：花哪儿了';
  const newCommit = api('POST', '/repos/' + owner + '/' + repo + '/git/commits',
    { message: msg, tree: newTree.sha, parents: [remoteSha] });
  const updated = api('PATCH', '/repos/' + owner + '/' + repo + '/git/refs/heads/' + encodeURIComponent(branch),
    { sha: newCommit.sha, force: false });

  console.log('完成  ' + (updated.ref || branch) + ' → ' + newCommit.sha.slice(0, 8));
})().catch((e) => {
  console.error('失败：' + e.message);
  process.exit(1);
});
