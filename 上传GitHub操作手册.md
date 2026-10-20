# 上传 GitHub 操作手册

> 目标：源码放仓库、APK 挂 Release，别人能一行命令 clone、能一键下载安装包。
> 仓库已经初始化好了（`.git` 已建、240 个文件已纳入版本控制），下面只剩「建仓库 + 推 + 发版」三步。

---

## 0. 已经替你做完的事

| 项 | 状态 |
|---|---|
| Git 仓库初始化 | ✅ 已 `git init`，分支 `master`（推送时会改名 `main`） |
| `.gitignore` | ✅ 已补齐：`node_modules/` `dist/` `.wrangler/` `.workbuddy/` `android/.gradle/` `android/app/build/` |
| 签名密钥 | ✅ **已排除**。`android/keystore/`、`android/keystore.properties`、`android/local.properties` 都不进仓库 |
| APK | ✅ 特意放进仓库：`dist-apk/whereipaid-v1.17.8.apk` |
| `.gitattributes` | ✅ 源码统一 LF、`.bat` 保持 CRLF、图片/APK 按二进制处理 |
| 上传脚本 | ✅ `上传到GitHub.bat`（壳）+ `_tools/upload-github.js`（逻辑），支持 `--dry-run` |
| Git | ⚠️ 系统里没装，脚本会自动改用 WorkBuddy 内置版，详见 1.5 节 |
| 隐私清理 | ✅ 施工方案里的真实邮箱和 Cloudflare Account ID 已替换成占位符 |

**没进仓库的东西**（都是可重建的，不用心疼）：`node_modules`（176M）、`android/app/build`、`android/.gradle`、`dist`、`.wrangler`。

---

## 1. 在 GitHub 上建一个空仓库
打开 <https://github.com/new>，只填三处：

| 字段 | 填什么 |
|---|---|
| Repository name | `whereipaid` |
| 可见性 | **Public** |
| 初始化选项 | **三个都不要勾**（README / .gitignore / license 都不勾） |

> ⚠️ 勾了任何一个，GitHub 会先建一条提交，和本地历史是两条不相干的线，推送会报 `rejected (fetch first)`。真勾了也别慌：删掉仓库重建，比解冲突快。

建好后页面会给一个地址，形如：

```
https://github.com/<你的用户名>/whereipaid.git
```

---

## 1.5 关于 Git 本身（这台机器没装）

这台机器 **没有独立安装 Git**，只有 WorkBuddy 自带的一份 PortableGit，它不在系统 PATH 里。所以直接敲 `git` 会提示"不是内部或外部命令"——**这不是脚本坏了**。

`_tools/upload-github.js` 会自己按顺序找：

1. 环境变量 `GIT_EXE`（想强制指定就设它）
2. 系统 PATH
3. `C:\Program Files\Git\cmd\git.exe` 等常规位置
4. WorkBuddy 内置的 PortableGit

找到后会顺带把它的 `cmd` 和 `mingw64\bin` 加进子进程 PATH，否则 `credential.helper=manager` 找不到凭据管理器，推送会卡在"输用户名密码"。

**现在能直接用**，但建议还是装个正式版——WorkBuddy 一旦升级或卸载，内置那份就没了：

```powershell
winget install --id Git.Git -e
```

装完重开命令行，`git --version` 有输出就对了，脚本会自动优先用 PATH 里的。

---

## 2. 推上去（两种方式，选一种）

### 方式 A：双击脚本（推荐）

双击 **`上传到GitHub.bat`**，它会依次问你：

1. 第一次跑 → 问你的 GitHub 用户名（只问一次，写进本地 git 配置）
2. 没绑远程 → 让你粘贴仓库地址（只问一次）
3. 问「这次改了什么」→ 直接回车用默认
4. 推送时弹出浏览器 → **登录并点授权**

看到「上传完成」就好了。

**只想看看会发生什么、不真传？** 把 bat 拖进命令行加 `--dry-run`：

```bash
上传到GitHub.bat --dry-run
```

它会走完身份和远程检查、列出本次涉及多少文件，**不改配置、不提交、不推送**。

> bat 只是壳，真正干活的是 `_tools/upload-github.js`。想改提示语、改默认提交信息，改那个 js 就行，不用碰批处理。

### 方式 B：手动敲命令

```bash
cd /c/Code/Jizhang

git config user.name  "你的用户名"
git config user.email "你的用户名@users.noreply.github.com"

git add -A
git commit -m "初始化：花哪儿了 记账本 v1.17.8"

git branch -M main                      # 分支改名为 main
git remote add origin https://github.com/<你的用户名>/whereipaid.git
git push -u origin main
```

第一次 `push` 会弹 GitHub 登录窗口（Git Credential Manager），授权一次之后就不用了——凭据存在 Windows 凭据管理器里。

### 方式 C：`git push` 被网络挡住时（自动走 API 推送）

有些环境下 `https://github.com` 被代理挡住，`git push` 会直接报：

```
fatal: unable to access 'https://github.com/.../': Failed to connect to github.com:443
```

**先判断是不是这个原因**（不用猜）：

```bash
curl -s -o /dev/null -m 15 -w "github.com %{http_code}\n" https://github.com      # 502/000 = 被挡
curl -s -o /dev/null -m 15 -w "api.github.com %{http_code}\n" https://api.github.com  # 200 = API 通
```

这台机器上就是这个情况：`github.com` 返回 502，`api.github.com` 返回 200。既然 API 通，`_tools/push-github-api.js` 就按 GitHub 的 Git Data API 手动推（blob → tree → commit → 更新 ref）：

```bash
node _tools/push-github-api.js --dry-run   # 先看会传哪些文件
node _tools/push-github-api.js             # 真的推
```

`上传到GitHub.bat` 已经内置了这个兜底：`git push` 失败会自动接上 API 推送，你只会看到一行「git push 没成功，改用 GitHub API 推送……」，然后照常完成。

> 令牌从 Git 凭据管理器里读（`git credential fill`），不落盘、不打印。
> 中文文件名用 `git ls-tree -z` 读，否则路径会被引号包起来变成打不开的鬼东西。

---

## 3. 把 APK 挂成 Release

仓库里的 APK 要 clone 才能拿到，不友好。**Release 才是给普通用户下载的地方**。

1. 打开仓库首页 → 右侧栏 **Releases** → **Draft a new release**
2. **Choose a tag** 输入 `v1.17.8` → 点 **Create new tag: v1.17.8 on publish**
3. **Release title** 填 `花哪儿了 v1.17.8`
4. 描述里写这几版改了什么（可以直接抄 `README.md` 的更新段落）
5. **Attach binaries** 拖入 `dist-apk/whereipaid-v1.17.8.apk`
6. 点 **Publish release**

发布后的固定下载链接长这样（把 `<用户名>` 换掉即可，以后换版本只改版本号）：

```
https://github.com/<用户名>/whereipaid/releases/latest/download/whereipaid-v1.17.8.apk
```

`releases/latest/download/<文件名>` 这个形式永远指向最新一版，**适合直接写进官网下载按钮**。

> 注意：文件名参与 URL，所以每次发版**文件名要一致**（都是 `whereipaid-v<版本>.apk`），否则老链接会 404。

---

## 4. 以后每次更新，只有三步

```bash
# 1. 重新打包（生成 dist-apk/whereipaid-v<新版本>.apk）
双击 打包APK.bat

# 2. 上传源码和 APK
双击 上传到GitHub.bat

# 3. 网页上发新 Release，把新 APK 拖进去
```

APK 文件名里的版本号一改，仓库里就会同时留新旧两个包。想只留最新的：

```bash
git rm dist-apk/whereipaid-v1.17.8.apk
```

（历史里那份删不掉，但仓库体积影响很小，3M 而已。）

---

## 5. 五个必须知道的坑

### ① 签名密钥泄了 = 应用被劫持

`android/keystore/whereipaid-release.jks` 和 `android/keystore.properties` 里的口令，**绝对不能进仓库**。这两样已经在 `.gitignore` 里了，但有两个动作会绕过它：

- 用 `git add -f` 强推
- 建完仓库后手动把这些文件拖进网页上传

一旦公开，任何人有私钥就能签一个「冒充你」的更新包装到用户手机上。真泄露了只能换密钥重新发版，老用户没法覆盖升级。

**另存一份**到密码管理器或网盘，丢了就永远无法给已安装的用户发更新。

> 上传脚本里加了一道防呆：提交前会扫暂存区，一旦发现 `keystore` / `.jks` / `local.properties`，**立刻清空暂存区并中止**，就算你手动 `git add -f` 也传不上去。

### ② 令牌只走环境变量

如果你哪天改用 Personal Access Token 而不是浏览器登录：

```bash
# 正确：让 git 自己问，别写进命令历史
git push https://github.com/<用户名>/whereipaid.git main

# 错误：令牌会留在 .git/config 和 shell 历史里
git remote add origin https://ghp_xxxxx@github.com/...
```

### ③ 公开仓库前先搜一遍隐私

```bash
git grep -nE "1[3-9][0-9]{9}|@(qq|163|gmail)\.com" -- "*.md" "*.js"
```

邮箱、手机号、真实姓名、服务器 IP、数据库 ID，公开仓库全都能被搜到。已处理的那处是 `情侣账本-双人同步-Cloudflare施工方案.md`。

### ④ `wrangler.toml` 里的 database_id 要不要删

`e5644e25-ac90-4263-95e9-1cbddaa34e24` 只是一个**标识符**，不是凭据——光有它连不上你的 D1，必须配合 Cloudflare 账号登录才行。留着方便别人复现部署，删了也不影响。留着没问题。

### ⑤ GitHub Pages 和这个项目的关系

`dist/` 是构建产物，被忽略了，所以**不能**直接用 Pages 的 "Deploy from a branch" 发官网。官网（`site/`）目前走的是 Cloudflare Pages，跟 GitHub 无关。如果以后想用 GitHub Pages 托管，得加一个 Actions workflow，先跑 `build-site.js` 再发布——需要的话再说。

### ⑥ 批处理文件必须 CRLF

这版最初踩过：脚本用 LF 换行保存，双击后满屏「`1.` 不是内部或外部命令」「`Release` 不是内部或外部命令」，最后一行还变成乱码。

原因是 **cmd.exe 解析 bat 时按 CRLF 算字节偏移**。纯 LF 会让它跳到半行、甚至跳进汉字中间，于是半个句子被当成命令执行，多字节字符被切碎成乱码。

规矩：

- `.bat` / `.cmd` / `.ps1` 一律 **CRLF**
- `.js` / `.css` / `.md` 用 LF（`.gitattributes` 已经定好这条，克隆下来自动分流）
- 新建 bat 别用「另存为 UTF-8」，用 VS Code 右下角把 `LF` 点成 `CRLF`

本项目所有 bat 已统一成 CRLF。

---

## 6. 可选的加分项

| 想做的事 | 做法 |
|---|---|
| 加开源协议 | 仓库页 **Add file → Create new file**，文件名 `LICENSE`，右侧 **Choose a license template**。不加的话默认「保留所有权利」，别人只能看不能用 |
| 让别人一眼看懂 | README 开头已经很完整了，可以考虑补一张真机截图（`site/assets/shots/` 里现成的） |
| 自动打包 APK | 加 GitHub Actions，pushtag 时自动跑 gradle 并附到 Release，就不用本地双击了。前提是签名密钥要放进仓库 Secrets，有泄露风险，建议等项目稳定后再说 |
| 官网下载按钮指向 Release | 把官网按钮链接换成第 3 节那条 `releases/latest/download/...`，就不用把 zip 塞进 `site/download/` 了 |
