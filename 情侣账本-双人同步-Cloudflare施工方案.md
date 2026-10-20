# 情侣账本 · 双人同步（Cloudflare）施工方案 v2

> 状态：**方案稿，未开工**（v1 2026-10-19 → v2 2026-10-19）
> 项目：`C:\Code\Jizhang`（纯静态 PWA，无构建步骤，`dist/` 是发布目录）
> 前置：`情侣账本-开发任务书.md` §9 的技术选型已经定过（本机实测），本文不重新讨论选型，直接把它落成可执行的施工步骤、接口契约和验收标准。

## 0. v2 改了什么（相对 v1）

v1 的架构是对的，问题集中在**客户端合并语义、配对落点、账本生命周期、写权限**四处。v2 只改这四处，服务端选型和里程碑切法不动。

| # | v1 的问题 | 后果 | v2 的改法 |
|---|---|---|---|
| 1 | `applyRemoteOps` 在 seq 之外又比 `updatedAt` | 删掉的账被 update 复活；时钟偏慢的设备改动静默丢失 | **只认 seq**，实体打 `_seq`，加墓碑表（§6.2） |
| 2 | 配对链接 = `https://域名/#pair=`，默认走微信转发 | 微信内置浏览器的存储与已安装 PWA 隔离，B「配对成功」但 App 仍只在本机 | 主路径改**复制 43 字符 → App 内粘贴**，链接只做面对面辅助（§4.3） |
| 3 | `cpBooks.id = 'cp' + order` 各设备独立推导 | A、B 各自换本都得到 `cp2`，两本不同的账混成一本 | 同步开启后**新建账本用随机 id**（§3.2） |
| 4 | 白名单缺 `book.close` / `book.wipe`；`profile.set` 不带 bookId | A 彻底删除后 B 把账推回来；换本重置的资料被推回 | 补两个 op，`profile.set` 带 `bookId`（§3） |
| 5 | `push` / `DELETE room` 只凭 `room`，`verifier` 另存一份密文 | 有 room 就能灌垃圾 op、能删房间；与「能读同一把钥匙」的说法不符 | 派生 `encKey`/`authKey` 双子键，服务端只存 `SHA256(authKey)`（§4、§5） |
| 6 | `PBKDF2(secret, salt, 200k)` | 对 128 位随机 secret 无增益，只增加配对延迟 | 换 **HKDF**（§4.1） |
| 7 | ntfy 信号 | 前台本来就在轮询，后台收不到任何东西，价值≈0 却多一个国内不稳的依赖 | **砍掉**（§1、§2） |
| 8 | 密文未绑 AAD | 服务端可把一条 op 换个 opId 重放 | AAD = `room\|opId\|proto`（§4.1） |
| 9 | 排期 6–8 天 | 偏乐观 | 改 **10–14 天**（§14） |

下面提到「为什么」时只说结论，论证见 §0 的表和对应小节。

---

## 1. 先看这四句

1. **服务端零知识**：D1 里只有「房间号 + 密文 + 时间戳」，金额、备注、昵称、日期全在密文里。作者自己登录 Cloudflare 也看不到你们花了多少钱。
2. **服务端既不能读、也不能伪造写**：`encKey` 永不出设备；服务端只持有 `SHA256(authKey)`，能拒掉伪造请求，推不出 `encKey`。它能做的只剩「删库 / 拒服务」，也就是可用性层面的破坏。
3. **配对用「43 字符配对串」，不用 6 位数字**：6 位数字做钥匙可穷举（100 万种），做房号又意味着服务端知道钥匙 —— 两者都不成立（§4.2，这点与任务书原文的说法有出入，**以本文为准**）。
4. **先做能用的最小闭环**：一对情侣、两台手机、离线能补发、数据不丢。多本历史账本、只分享比例、想你的时候排到 M3 之后。

## 2. 范围

### 要做

| 能力 | 说明 |
|---|---|
| 配对 | A 生成配对串（可复制文本 + 二维码），B 粘贴或扫，两台设备建立同一个「房间」 |
| 增量同步 | 记账 / 改账 / 删账 / 存钱 / 改资料，几秒内出现在对方手机上 |
| 离线可用 | 断网照常记账，联网后自动补发（幂等，不会重复） |
| 多设备一致 | 冷启动先拉后推，冲突按「后到者胜」，墓碑挡乱序旧改动 |
| 云端删除 | 设置里「删除云端数据」，删完两台都只剩本机（另一台下次同步会提示） |
| 状态可见 | 主页右上角同步灯：绿=已同步 / 黄=同步中或待发 / 灰=离线；设置里显示「上次同步时间」 |

### 不做（本阶段明确不做）

- 不做账号、手机号、密码、验证码 —— 配对串就是全部凭证。
- 不做 Web Push / 后台常驻同步（只在打开 App 时同步 + 前台轮询）。
- **不做 ntfy 推送信号**（v2 砍掉）。理由：PWA 在后台本来就收不到任何东西，而前台每 20s 已经在轮询；ntfy 唯一买到的是「前台空闲时从 20s 变 1s」，代价是一个国内随时可能不通的外部依赖和 1–2 天工期。M3 如果真觉得慢，再讨论长轮询，不引第三方。
- 不做 OT / CRDT：情侣记账不存在「同一笔账两人同时改」的场景，LWW + seq 足够。
- 不同步：个人账本 `state.tx`、个人目标、预算、AI Key、订阅、愿望、设置里的一切。**一条都不传。**
- 不做 op log 压缩（compact / snapshot），M3 视体量再定（§10）。

## 3. 架构

```
手机 A（PWA）                          手机 B（PWA）
┌────────────────────┐              ┌────────────────────┐
│ store.js           │              │ store.js           │
│  cpTxs / 情侣目标   │              │  cpTxs / 情侣目标   │
│      │ emit        │              │      │ emit        │
│      ▼             │              │      ▼             │
│ couple-sync.js     │              │ couple-sync.js     │
│  outbox + 墓碑      │              │  outbox + 墓碑      │
│  HKDF → encKey     │              │  HKDF → encKey     │
│  AES-GCM(+AAD)     │              │  AES-GCM(+AAD)     │
└────────┬───────────┘              └────────┬───────────┘
         │  HTTPS                           │
         │  /api/couple/*                   │
         │  x-couple-auth: <authKey>        │
         ▼                                  ▼
   Cloudflare Pages Functions ──────►  D1（SQLite）
   （验 auth_hash、分配 seq、存密文）    rooms / ops
```

关键点：

- **同源部署**：前端和 Functions 在同一个 `pages.dev` 域名下，不需要 CORS，也不需要把 API 域名写死。
- **两把子键**：`encKey` 只留在设备内存里；`authKey` 每次请求带着走（HTTPS 内），服务端只存它的 SHA-256。服务端拿到 `authKey` 也推不出 `encKey`（HKDF 单向）。
- **同步是附加功能**：任何网络/加密异常都必须被 `couple-sync.js` 吞掉，绝不能让记账本身失败（现有骨架已经是这个原则，保持）。

## 3.1 同步哪些数据（白名单）

只同步「情侣空间」里的东西，且按 op 类型白名单：

| op 类型 | 对应数据 | 触发点 |
|---|---|---|
| `cptx.add` / `cptx.update` / `cptx.remove` | `state.cpTxs` 一条账 | `cpAddTx` / `cpUpdateTx` / `cpRemoveTx` |
| `goal.add` / `goal.update` / `goal.remove` | 情侣目标（小金库 / 约会 / 见面基金），`cpBookId` 有值的那些 | `addGoal` / `updateGoal` / `removeGoal` |
| `goal.deposit` | 往情侣基金里存/取一笔（`goal.logs` 追加） | `depositGoal` |
| `book.add` | 新建一本（含 `id`、`title`、`order`、`startAt`） | `startNewCpBook` |
| `book.update` | 改名 / 换起始日 | 书相关操作 |
| `book.close` | 关闭当前这本（`status='closed'`） | `closeCouple` |
| `book.wipe` | **彻底删除**某一本（账、基金、书本身） | `wipeCpBook` |
| `profile.set` | 情侣资料，**必须带 `bookId`** | `setCoupleConfig` |
| `ping` | 「想你的时候」一颗心（不入库，只走轮询；见 §1 不做 ntfy） | 新按钮 |

**不同步**：`state.tx`（个人账目）、`books`、`settings`（含 AI Key）、`goals` 里没有 `cpBookId` 的、`repeats`、`wishlist`、`subs`、`recon`、`alertLog`、`cpBooks` 之外的任何东西。

> 落地时在 `couple-sync.js` 里用一个 `ALLOW = { cptx: 1, goal: 1, book: 1, profile: 1 }` 白名单兜底：不是白名单里的 op 一律丢弃，防止以后有人从 `emit` 里顺手多传了别的。

### 3.2 三个生命周期细节（v1 漏掉的）

1. **`book.wipe` 必须真的发 op**。现在的 `wipeCpBook` 只删本地数组；如果不同步，A 删掉一本之后，B 下次推自己的 `cptx` 就会把账原样推回来。做法：`book.wipe` 携带 `bookId`，收到的一侧（a）删掉该 `cpBookId` 的所有账与基金，（b）把 `bookId` 记进墓碑，（c）**清空 outbox 里所有 `payload.cpBookId === bookId` 的待发项**（否则那些还没发出去的账会把它复活）。
2. **`closeCouple` 发 `book.close`**：只改 `status`，不删数据，双方状态灯和列表要对齐，否则 B 那边还以为这本开着。
3. **新建账本的 id 改随机**。`store.js:1140` 现在是 `id: 'cp' + order`，`order = 现有最大 order + 1` —— 这是**每台设备各自推导**的确定性 id。A 和 B 各自「换一本新的」，都会算出 `cp2`，同步后两本不同的账落进同一个 id，账目混在一起、`cpActiveId` 也对不上。改法：

```js
// store.js · startNewCpBook
const syncOn = global.CoupleSync && global.CoupleSync.ready && global.CoupleSync.ready();
const book = {
  id: syncOn ? U.uid('cp') : ('cp' + order),   // 开着同步就用随机 id
  order,                                       // order 只用于显示排序，不再当主键
  title: '在一起的第 ' + order + ' 本',
  ...
};
```

   老数据不动（已有 `cp2` 的照旧），只是从此新建的不会再撞。

### 3.3 `profile.set` 带 `bookId`

`settings.couple` 里的资料是**全局单份**，而 `startNewCpBook` 会重置它。如果 `profile.set` 不带 bookId，A 换本后推一次资料，会把 B 那边「老本的资料」一起覆盖掉。

v2 的取舍（不做 per-book 存储，避免数据迁移）：

- `profile.set` 的载荷里带 `bookId`；接收侧**只在 `bookId === cpActiveId()` 时应用**，否则落到 `pendingProfiles[bookId]`，等切换到那本时再用。
- 换本时的本地重置**不推送**（它是「这一本的开始」这个本地语义），所以 B 那边可能仍显示老资料，直到用户在新本里改一次。这是已知限制，写进 §10 的风险表。

## 4. 密钥与配对

### 4.1 配对串的构成

| 字段 | 长度 | 作用 | 谁知道 |
|---|---|---|---|
| `room` | 16 字节随机 | 房间 ID，服务端主键 | 服务端知道（必须） |
| `secret` | 16 字节随机 | 派生两把子键的种子 | **只有两台手机** |
| `encKey` | 32 字节 | AES-GCM | 两台手机内存里 |
| `authKey` | 32 字节 | 服务端认证（明文走 HTTPS） | 两台手机 + 服务端（只存哈希） |

- 配对串 = `base64url(room16 ‖ secret16)`，**32 字节 → 43 个字符**。
- **canonical 形式**（v1 没说清，会炸）：配对串解码得到 32 字节，**前 16 字节按 hex 展开成 32 个小写 hex 字符**，这个 32-hex 才是接口里的 `room`；后 16 字节是 `secret` 的原始字节。服务端只认 32-hex。
- 两把子键（HKDF，不是 PBKDF2）：

```js
// salt 用 room 的原始 16 字节；info 绑定用途，两把键互不可推
const ikm = await crypto.subtle.importKey('raw', secret16, 'HKDF', false, ['deriveKey', 'deriveBits']);
const encKey = await crypto.subtle.deriveKey(
  { name: 'HKDF', hash: 'SHA-256', salt: room16, info: enc('jz1/enc/v1') },
  ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const authBits = await crypto.subtle.deriveBits(
  { name: 'HKDF', hash: 'SHA-256', salt: room16, info: enc('jz1/auth/v1') }, ikm, 256);
const authKey = b64url(new Uint8Array(authBits));       // 43 字符，随请求头发出去
```

> **为什么去掉 PBKDF2**：PBKDF2 的作用是给低熵口令加成本。这里的 `secret` 是 128 位 CSPRNG，熵已经拉满，20 万次迭代一点安全性都不增加，只在配对时多花 300ms（老手机上更久）。HKDF 是这类场景的标准答案。

- 每条 op：随机 12 字节 IV，**AAD 绑定 `room|opId|proto`**：

```js
const aad = enc(`${room}|${opId}|${PROTO}`);
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, encKey, plain);
cipher = b64(iv ‖ ct);
```

   AAD 挡的是「服务端把一条旧 op 换个 opId 重放」和「把 room X 的 op 挂到同一把钥匙的另一处」这类搬运。
- 服务端只看得到 `room`、`op_id`（随机 UUID）、`seq`、`ts`、`auth_hash`。

43 个字符足够放进二维码，也能手动抄。**分组只许用空格**（`AbCd EfGh ...`），**不能用连字符**——`-` 本身就是 base64url 的合法字符，用户手抄时插进去的 `-` 会被当成有效字符，解码直接错位，最后报的是「配对串不对」，极难排查。解析时统一剔除空白和换行，其余字符原样保留。

### 4.2 为什么不用 6 位数字

| 方案 | 问题 |
|---|---|
| 6 位数字当钥匙 | 100 万种组合，离线可穷举；服务端一旦拿到密文就能爆破 |
| 6 位数字当房号，服务端存映射 | 服务端知道你用哪把钥匙（它给了映射），零知识破功 |
| 6 位数字 + 服务端限流 | 只能防在线爆破，防不了「拿到 D1 备份的人」 |

结论：**配对串必须自带 128 位随机 secret**。如果以后要做「口头报 6 位数字配对」，只能做成「6 位数字 → 服务端换一次性配对串」，且要接受「服务端短暂知道配对串」的取舍，这件事本阶段不做。

### 4.3 配对流程（v2 改主路径）

v1 把「扫码打开链接」当主路径，这在真实环境里会失败：链接几乎必然走微信转发，而**微信内置浏览器有自己的存储域，和已安装的 PWA 完全隔离**。B 在微信里点开、写入 `room/secret`，回到桌面上那个 App，它还是「只在本机」。

所以 v2 把主路径倒过来：

```
A（发起方）                                   B（加入方）
设置 → 情侣 → 双人同步 → 发起配对
  ├ 生成 room / secret
  ├ 主按钮：「复制配对串」（43 字符，按 4 个一组显示）
  ├ 次按钮：「显示二维码」（面对面扫，同屏用）
  └ 状态：「等 TA 加入」
                                              ← 主路径：TA 把 43 字符发给你（微信也行）
                                                打开**已安装的 App** → 设置 → 情侣 → 加入配对 → 粘贴
                                              ← 次路径：扫二维码（必须是已安装的 App 在扫，
                                                或在系统相机扫到后用「在 App 中打开」）
                                              ↓
                                        写入 settings.couple.room / secret（secret 加密后存本机）
                                              ↓
                                        pull(since=0)（带 x-couple-auth）
                                              ↓
                                        401 BAD_AUTH → 「配对串不对或已失效」
                                        200        → 配对成功，落 lastSeq
                                              ↓
                                        成功后两台各自推一次自己的本地数据
```

- **检测与引导**：`display-mode: standalone` 为假、或 UA 里出现 `MicroMessenger` / `QQ` / `Weibo` 时，**不给「加入」按钮**，而是显示一句：「请在已安装到桌面的 App 里打开设置 → 情侣 → 加入配对；配对串可以复制到那边粘贴。」不要试图在 webview 里「也能用」——那会让用户以为配好了。
- **A 端已有的本地数据**：首次配对后把现有 `cpTxs` / 情侣目标用 `op_id = "boot_" + tx.id` 逐条推上去（幂等：重复推不会重复）。
- **B 端**：先 `pull(0)` 拉全量，再推自己的（通常 B 是空的）。
- **失败提示**：先报网络（`health` 不通 → 「连不上服务器，检查网络」），**再**报密钥（401 → 「配对串不对」）。顺序不能反：`pages.dev` 在国内时通时不通，反过来会让用户怀疑自己抄错了一位。
- **配对串丢失**：主恢复路径是「让对方在设置里再看一次，重新发给你」，不是备份文件。真·最坏情况是两台设备同时丢失 + 备份里也没有配对串 —— 这时云端数据永久解不开，文案必须写明（§9）。

## 5. 服务端（Pages Functions + D1）

### 5.1 目录结构

```
C:\Code\Jizhang\
├── functions/                     ← 必须在项目根，不能放进 dist（官方文档明确要求）
│   └── api/
│       └── couple/
│           ├── push.js            POST /api/couple/push   （含建房）
│           ├── pull.js            GET  /api/couple/pull
│           ├── room.js            DELETE /api/couple/room （删云端）
│           ├── health.js          GET  /api/couple/health
│           └── _lib.js            ← 共享：JSON 响应、参数校验、auth 校验
├── schema.sql                     ← D1 建表
├── wrangler.toml                  ← Pages 项目名 + D1 绑定
└── dist/                          ← 静态站点（build-dist.js 产物）
```

> v2 把「建房」并进了 `push`（`create:true`），省掉一个接口和一次往返，也省掉「忘了先建房」这类顺序 bug。`room.js` 只剩 DELETE。

### 5.2 D1 表结构（`schema.sql`）

```sql
-- 房间：一条记录一个情侣空间
CREATE TABLE IF NOT EXISTS rooms (
  room        TEXT PRIMARY KEY,        -- 32 位小写 hex
  created_at  INTEGER NOT NULL,
  last_at     INTEGER NOT NULL,        -- 最近一次写入，用于清僵尸房间
  auth_hash   TEXT NOT NULL            -- SHA-256(authKey) 的 base64url，用来验写权限
);

-- 变更日志：只追加，不改不删（删除也是一条 op）
CREATE TABLE IF NOT EXISTS ops (
  room    TEXT    NOT NULL,
  op_id   TEXT    NOT NULL,            -- 客户端 UUID，明文，幂等键
  seq     INTEGER NOT NULL,            -- 房间内自增
  cipher  TEXT    NOT NULL,            -- base64(iv ‖ AES-GCM 密文)
  ts      INTEGER NOT NULL,            -- 客户端写入时间（排序用 seq，不用它）
  PRIMARY KEY (room, op_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_room_seq ON ops (room, seq);
```

- **没有 `verifier` 列，也没有 `seqs` 表**（v1 有）。配对校验就是「`auth_hash` 对不上 → 401」，而 seq 用 `MAX(seq)+1` 在同一句 SQL 里算，不需要额外计数器。
- 唯一索引 `(room, seq)` 兜底：万一并发算出同一个 seq，第二次写入会报错，接口返回 503 让客户端重试，绝不静默覆盖。
- **不存明文**：`cipher` 是唯一的数据列。`op_id` 只用于去重，客户端用 `crypto.randomUUID()`，不含金额/日期信息。
- 清理：M3 再做（惰性清理 90 天前的 op，或加一个独立 Worker 的 Cron Trigger —— Pages Functions 本身不支持定时任务）。

### 5.3 接口契约

统一响应头：`content-type: application/json; charset=utf-8`，`cache-control: no-store`。
统一鉴权头：`x-couple-auth: <43 字符 base64url authKey>`。**三个写/读接口全部要**（v1 只凭 room，等于「有房间号就能灌数据」）。

#### `POST /api/couple/push`（含建房）

```jsonc
// 请求头
x-couple-auth: AbCd...43字符
// 请求体
{
  "room": "a1b2…32位hex",
  "create": true,            // 仅发起方首次推送时带；已存在的房间不会覆盖 auth_hash
  "ops": [
    { "opId": "uuid", "ts": 1730000000000, "cipher": "base64…" }
  ]
}
// 响应 200
{ "ok": true, "accepted": 1, "created": false, "seqs": [{ "opId": "uuid", "seq": 42 }] }
// 业务错误
{ "ok": false, "code": "BAD_AUTH" | "ROOM_NOT_FOUND" | "ROOM_TAKEN" | "TOO_MANY_OPS" | "ROOM_FULL" | "BAD_REQUEST" }
```

- 单次最多 50 条 op（首次 bootstrap 分批推）。
- 幂等：已经存在的 `op_id` 直接回它原来的 seq，不重复写。
- 建房：`create:true` 且房间不存在 → 写入 `rooms(room, created_at, last_at, auth_hash)`；房间已存在但 `auth_hash` 不同 → `ROOM_TAKEN` 409（不覆盖，防止有人抢注别人的房间号）。
- **401 和 409 要分清**：不带 `create` 的错 auth = `BAD_AUTH` 401（「配对串不对」）；带 `create` 撞上别人的房间 = `ROOM_TAKEN` 409（「这串配对串对应的房间已被占用」）。两者给用户的提示完全不同，别合成一个。
- seq 分配（一条 SQL 搞定，不存在就不插、已存在返回空）：

```sql
INSERT INTO ops (room, op_id, seq, cipher, ts)
SELECT ?1, ?2, COALESCE((SELECT MAX(seq) FROM ops WHERE room = ?1), 0) + 1, ?3, ?4
WHERE NOT EXISTS (SELECT 1 FROM ops WHERE room = ?1 AND op_id = ?2)
RETURNING seq;
```

  返回空行 = 这条 op 之前已经存过 → 再 `SELECT seq` 取原值。D1 对单条语句是串行的，`MAX(seq)+1` 在语句内部原子完成。

#### `GET /api/couple/pull?room=…&since=…&limit=200`

```jsonc
// 响应 200
{
  "ok": true,
  "room": "a1b2…",
  "ops": [{ "seq": 43, "opId": "uuid", "ts": 1730000000000, "cipher": "base64…" }],
  "next": 43,
  "hasMore": false
}
```

- `since` 默认 0；`limit` 上限 200；`hasMore=true` 时客户端立刻再拉一次。
- 401 `BAD_AUTH` 就是配对失败的唯一判据（v1 靠「拉到的密文解不开」，那是事后判断，不如这个早）。
- 不返回总数、不返回房间创建时间以外的任何元信息。

#### `DELETE /api/couple/room`

```jsonc
// 请求头 x-couple-auth
{ "room": "a1b2…", "confirm": "DELETE" }
// 200 { "ok": true, "deleted": 137 }
```

- **持有配对串 = 有权删除**（`authKey` 由 `secret` 派生，所以等于持有配对串）。
- 客户端要二次确认（输入「删除」两个字），并在成功后清掉本地 `room/secret/lastSeq/outbox/tombstones`，提示「另一台设备下次同步会提示云端已删除」。

#### `GET /api/couple/health`

`{ "ok": true, "v": 2, "time": 1730000000 }` —— 只用来判断服务是否可达，不暴露任何房间信息，也不要 auth。

### 5.4 限流与防滥用

| 层 | 做法 |
|---|---|
| Cloudflare 自带 | DDoS 防护 + Pages 免费额度（10 万请求/天） |
| 应用层 | 同 IP 每分钟 ≤ 60 次（用 `cf-connecting-ip` + D1 计数器表，或直接用 Cloudflare WAF Rate Limiting 规则，免费版 1 条规则够用） |
| 房间层 | 单房间单次 push ≤ 50 条；单房间 op 总量上限 20 万条（约等于每天 30 笔记 18 年），超了返回 `ROOM_FULL` 并提示导出 |
| 请求体 | `content-length` ≤ 256KB；`cipher` 单条 ≤ 4KB |
| 建房 | `create:true` 只允许写一次 `auth_hash`；空房间（0 op）7 天后可被清理任务回收，防刷房间占额度（M3） |

### 5.5 必须加 `_routes.json`（否则静态资源也要过 Functions）

Pages 的一个坑：**项目里一旦有 `functions/` 目录，默认所有请求都会先进 Function**。这样一来：

- 所有静态资源请求都计入 Functions 的 10 万次/天免费额度（不再享受「静态请求无限」）；
- 每多一个请求就多一次冷启动机会，首屏反而更慢。

所以要在**发布目录**（`dist/`）里放一个 `_routes.json`，只让 `/api/*` 进 Function：

```json
{
  "version": 1,
  "include": ["/api/*"],
  "exclude": []
}
```

`build-dist.js` 的 `FILES` 数组要加上 `'_routes.json'`，否则打包后它不在 `dist/` 里，规则不生效。验收方法：部署后 `curl -I https://<域名>/assets/js/app.js`，看响应头里的 `cf-*` 与 Functions 调用量（Dashboard → Pages → Functions → 调用次数）是否不再增长。

## 6. 客户端改造

### 6.1 `couple-sync.js`（把骨架填满）

骨架里的函数签名保持不变，避免动 `store.js` 和视图层：

| 函数 | 现在 | 要改成 |
|---|---|---|
| `ready()` | `false` | `!!room && !!secret && !!encKey && !!authKey` |
| `deriveKey(code, salt)` | `null` | 解码配对串 → `HKDF` 派生 `encKey` + `authKey`，缓存内存 |
| `encrypt(json, opId)` | `null` | `AES-GCM` + 随机 12B IV + AAD(`room\|opId\|proto`) → base64 |
| `decrypt(b64, opId)` | `null` | 解不开返回 `null`（**不要抛**），AAD 不符也算解不开 |
| `outboxPush(op)` | `false` | 写 `settings.couple.syncOutbox`（最多 500 条，同 `id` 合并成最后一条） |
| `outboxFlush()` | `false` | 批量 `POST /push`（带 `x-couple-auth`），成功后按 `opId` 出队 |
| `pullSince(seq)` | `null` | `GET /pull`，解密后交给 `store.applyRemoteOps` |
| `status()` | 固定「只在本机」 | 返回真实状态：`{state:'off'|'idle'|'syncing'|'error', lastSyncAt, pending, dropped}` |

> `dropped` = 「因对方已删除而放弃的本地改动条数」，见 §6.4。UI 上要能说出来，不能静默。

### 6.2 `store.js` 新增：应用远端变更（v2 重写）

**唯一排序判据是 `seq`**。v1 那段在 seq 之外又比 `updatedAt`，是两套判据打架：`cpAddTx` 根本不写 `updatedAt`（只有 `cpUpdateTx` 写，`store.js:702`），add 出来的实体在比较里恒为 0；而「seq 大者胜」与「updatedAt 大者胜」在时钟偏差时结论相反 —— 结果是时钟偏慢的那台设备，冲突里永远输，改动静默消失。

```js
/**
 * 应用一批远端 op。ops 必须按 seq 升序。
 * 返回 { changed, dropped }：实际变更条数 / 因墓碑而丢弃的条数。
 * 幂等：同一批 op 应用两次结果相同。
 */
function applyRemoteOps(ops) {
  let changed = 0, dropped = 0;
  const S = state.settings.couple || (state.settings.couple = {});
  const tomb = S.tombstones || (S.tombstones = {});        // { [entityId]: seq }

  for (const { seq, data } of ops) {
    const kind = data.kind;
    const d = data.data || {};
    const id = d.id || data.id;
    if (!id) continue;
    if (!ALLOW_APPLY(kind)) continue;                        // 白名单兜底，见 §3.1

    // 1) 删除：记墓碑，再摘实体
    if (kind.endsWith('.remove') || kind === 'book.wipe') {
      if (!(tomb[id] >= seq)) tomb[id] = seq;
      changed += removeEntity(kind, id);       // 真删，不是标 isVoid
      continue;
    }

    // 2) 墓碑优先：seq 不大于墓碑的一律丢（挡乱序到达的旧 update）
    if (tomb[id] != null && seq <= tomb[id]) { dropped++; continue; }

    // 3) 只按 seq 比较，实体自己记 _seq
    const cur = findEntity(kind, id);
    if (!cur) { insertEntity(kind, d, seq); changed++; }
    else if (seq > (cur._seq || 0)) { replaceEntity(kind, d, seq); changed++; }
  }

  if (changed) { save(); emit({ type: 'cptx', action: 'remote' }); }
  return { changed, dropped };
}
```

要点：

- **不要**在 `applyRemoteOps` 里调 `syncHook`，也不要逐条 `save()`（一次落盘）。
- 远端删除必须真的删，而不是标 `isVoid`（现有 `isVoid` 是「已作废」语义，和同步删除不是一回事）。
- 每条实体落盘时带 `_seq`；导出备份 / 渲染前**剔掉** `_seq`（`store.js` 的 `blankState` / 导出函数里加一行过滤）。
- `ts` 用远端 op 里的 `payload.ts`，不要覆盖成 `Date.now()`，否则排序和日历都会错。

### 6.3 outbox 与重试

```
记账 → hook(event) → outboxPush
                     ├ 已有同 id 的未发送项：替换（add→update→remove 只发最终态，remove 直接顶掉 add）
                     └ 落 localStorage（settings.couple.syncOutbox）

触发发送：
  1. 本地改动后 800ms 防抖
  2. 进入情侣页 / App 回到前台
  3. online 事件
  4. 每 20s 轮询（仅前台可见，页面隐藏时停）
失败退避：2s → 5s → 15s → 60s（带上限，不弹错，只在状态灯上变黄）
```

v2 加了两个动作，都在 `applyRemoteOps` 之后立刻做：

- **收到 `*.remove` / `book.wipe` 后，清掉 outbox 里对应 id（或对应 `cpBookId`）的待发项**。否则那些还没发出去的 update 会在下一轮把对方刚删的账推回来 —— 这是 v1 最典型的「删不掉」。
- **被清掉的条数累加进 `status().dropped`**，UI 用一句「TA 删掉了 2 笔，你本地对这些账的改动已放弃」交代清楚，不静默吞。

### 6.4 冲突规则（v2 重写）

| 场景 | 规则 |
|---|---|
| 同一 `tx.id` 两边都改 | **只看服务端 `seq`**，大的胜。`updatedAt` 不参与任何判断 |
| 一边删、一边改（改动**已**发出） | seq 大的生效。改动晚于删除 → 这笔会回来，双方看到一致的结果 |
| 一边删、一边改（改动**还没**发出） | **删除优先**：本地未发的改动被丢弃并计入 `dropped`。宁可少一笔改动，也不复活一笔对方明确删掉的账 |
| 乱序到达的旧 update | 墓碑挡掉：`seq <= tombstones[id]` 一律不应用 |
| 重复 push | `op_id` 幂等，服务端不重复存 |
| 时钟不准 | 排序一律用服务端 `seq`；客户端 `ts` 只用于显示/统计。**时钟差不影响合并结果**（v1 会） |
| 墓碑体积 | 墓碑只留 90 天（和 op 清理同期），过期后清掉；被删的 id 是 UUID，不会复用，清掉不影响正确性 |

### 6.5 UI 要补的东西

| 位置 | 现状 | 要改成 |
|---|---|---|
| 情侣主页右上角 | `cp-sync--off` 灰灯 + 「同步还没接」 | 三态灯 + 点击进「同步」面板 |
| 设置 → 情侣 | 无 | 「发起配对 / 加入配对 / 查看配对串 / 解绑 / 删除云端数据」 |
| 加入配对页 | 无 | 粘贴框（43 字符，自动去掉空格和连字符）+「在微信里请用已安装的 App 打开」提示 |
| 协议 | `CONSENT_VERSION = 2`，5 条写「开发中」 | 上线前改 `3`：配对码、端到端加密、一键删除、状态灯、更新提醒，全部从「开发中」移到「现在就是这样」 |
| 关于 | — | 「上次同步：3 分钟前 · 云端 128 条 · 待发 0 条」 |

> 协议版本必须 +1，否则老用户不会看到新协议 —— 这是任务书 §9.4 的硬要求。

### 6.6 Service Worker

`sw.js` 现在按扩展名缓存资源。同步接口必须**绕开缓存**：

```js
// fetch 事件最前面
if (url.pathname.startsWith('/api/')) return; // 交给网络，不碰缓存
```

否则 `pull` 会被 `cache-first` 拦住，表现为「对方记了账，我这边一直不更新」。

## 7. 部署步骤（照抄可跑）

### 前置

- Cloudflare 账号（免费版即可）
- Node 18+（本机已有 22）
- 在项目根执行：`npm i -D wrangler`（会生成 `package.json` / `node_modules`，`.gitignore` 已忽略）

### Step 1 · 建 D1

```bash
cd C:\Code\Jizhang
npx wrangler login
npx wrangler d1 create jizhang-couple
# 输出里会有 database_id，抄到 wrangler.toml
npx wrangler d1 execute jizhang-couple --remote --file=./schema.sql
```

### Step 2 · `wrangler.toml`（项目根）

```toml
name = "jizhang"
compatibility_date = "2026-10-19"      # 必须 ≤ 本机 wrangler 自带的 workerd 支持范围
pages_build_output_dir = "dist"

[[d1_databases]]
binding = "DB"
database_name = "jizhang-couple"
database_id = "<Step 1 的 id>"
```

> `compatibility_date` 写太新的日期会被 wrangler 拒绝执行（它只认自己内置的 workerd 版本）。装完 wrangler 后先跑 `npx wrangler --version`，报错就把这个日期改早。

### Step 3 · 确认 `functions/` 位置

官方要求：`functions/` 在 **Pages 项目根**，不能在 `dist/` 里。所以打包脚本不用改，`dist/` 只放静态文件。

### Step 4 · 本地联调

```bash
# 同时跑静态站 + Functions + 本地 D1
npx wrangler pages dev dist --d1 DB=<database_id> --port 8788
# 打开 http://localhost:8788 （不是 4173；4173 仍然是你原来的纯静态服务器）
```

本地库要先建表：

```bash
npx wrangler d1 execute jizhang-couple --local --file=./schema.sql
```

### Step 5 · 自测

```bash
# 健康检查（不要 auth）
curl -s http://localhost:8788/api/couple/health

# 用脚本生成一对 room/secret，并算出 authKey（_test/sync-pairgen.js 提供）
node _test/sync-pairgen.js --json
# → {"room":"<32hex>","secret":"<b64url>","auth":"<43字符>","pair":"<43字符>"}

# 建房 + 推一条
curl -s -X POST http://localhost:8788/api/couple/push \
  -H 'content-type: application/json' \
  -H 'x-couple-auth: <auth>' \
  -d '{"room":"<32hex>","create":true,"ops":[{"opId":"t1","ts":1730000000000,"cipher":"AAAA"}]}'

# 拉取
curl -s 'http://localhost:8788/api/couple/pull?room=<32hex>&since=0' \
  -H 'x-couple-auth: <auth>'

# 反例：错 auth 必须是 401
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://localhost:8788/api/couple/pull?room=<32hex>&since=0' \
  -H 'x-couple-auth: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
```

### Step 6 · 发布

```bash
node build-dist.js                 # 生成 dist/，顺带校验 ?v= 与 sw.js CACHE
npx wrangler pages deploy dist --project-name jizhang
```

- 首次会问 project name / production branch，直接回车用配置里的。
- 部署后打开 `https://jizhang.pages.dev`，**先测同步再发给人**。
- 绑定如果是在 Dashboard 加的，改完必须 **Redeploy** 才生效。

### Step 7 · 自定义域名（建议）

`pages.dev` 在国内时通时不通。有自己的域名就绑上去，走 Cloudflare CDN；国内访问会好一些，但**域名解析在 Cloudflare 就可能被干扰**，这点要有预期。没有域名也能用，代价是配对和同步偶尔要多试一次。

### Step 8 · 发布前检查

- [ ] `node _test/run-all.js` 全绿
- [ ] `node _test/bump.js --check` 通过（改代码必须升版本，否则手机吃旧缓存）
- [ ] `sw.js` 已排除 `/api/`
- [ ] `dist/_routes.json` 存在且 `include` 只有 `/api/*`
- [ ] `build-dist.js` 的 FILES 里加了 `_routes.json`
- [ ] `CONSENT_VERSION` 已 +1，协议正文与实际一致
- [ ] `.gitignore` 里没有把 `functions/`、`schema.sql`、`wrangler.toml` 排除掉
- [ ] 用真手机（不是无痕桌面）跑一遍：配对 → 记账 → 对方看到 → 断网记 → 恢复
- [ ] 用微信把配对串发给另一台，确认**复制粘贴**这条路通（不是点链接）

## 8. 测试计划

### 8.1 新增套件（建议命名）

| 套件 | 覆盖 |
|---|---|
| `_test/verify-sync-crypto.js` | HKDF 两把子键派生一致、`encKey ≠ authKey`、AES-GCM 往返、IV 不重复、AAD 不符解不开、错误 key 返回 null |
| `_test/verify-sync-queue.js` | outbox 合并（add→update→remove 只留 remove）、上限 500、离线积压、恢复后一次发完、收到 remove 后清掉同 id 待发项 |
| `_test/verify-sync-merge.js` | `applyRemoteOps` 幂等、只按 seq 判胜、墓碑挡乱序旧 update、`dropped` 计数、不触发再次入队 |
| `_test/verify-sync-converge.js` | **收敛性 fuzz**：两台虚拟设备随机 add/update/remove/断网/乱序投递 200 轮，最后断言两边的 `cpTxs` 逐字段相同。这是 v1 那套 `updatedAt` 判据过不了的测试 |
| `_test/verify-sync-ui.js` | 配对面板、粘贴 43 字符（含空格/连字符）、状态灯三态、解绑、删除云端二次确认、webview 里不给「加入」按钮 |
| `_test/verify-sync-e2e.js` | 两个 Edge profile + 本地 `wrangler pages dev`：A 记一笔 → B 拉到 → B 删 → A 消失 → A 离线改同一笔 → 不复活 |

> 前四个可以纯 Node 跑（不启浏览器），进 `run-all` 的 fast 集；后两个进全套，跑一次 ~20s（e2e 依赖 `wrangler pages dev`，跑不起来就 skip 并打印原因，不要假装通过）。

### 8.2 手工验收清单

- [ ] A 配对后，B 粘贴配对串，3 秒内看到 A 的历史账（首次 bootstrap）
- [ ] 飞行模式下记 3 笔，恢复网络后 10 秒内两台一致，且没有重复
- [ ] A 改一笔金额、B 同时改同一笔 → 最终一致，不出现两条（两台设备看到的**金额相同**）
- [ ] A 删一笔 → B 那边消失；B 那边离线时改过这笔、改动还没发出 → 不复活，且提示「已放弃 1 条改动」
- [ ] 删除云端 → 两台都只剩本机，B 下次同步提示「云端已删除」
- [ ] 配对串输错一位 → 明确提示「配对串不对」，不静默失败
- [ ] 服务器不通（开飞行模式）→ 提示「连不上服务器」，**不能**说成「配对串不对」
- [ ] 清浏览器数据 → 用配对串恢复（云端还有数据）
- [ ] 在微信里点开配对链接 → 不给「加入」按钮，提示去已安装的 App 粘贴
- [ ] 弱网（DevTools Slow 3G）→ 不卡界面，状态灯变黄，最后补上
- [ ] 两台设备各「换一本新的」→ 云端出现两本**不同的**账，不混在一起

## 9. 安全与隐私

| 项 | 结论 |
|---|---|
| 服务端能看到 | 房间号、op 数量、每条 op 的时间戳、IP（Cloudflare 日志）、`auth_hash` |
| 服务端看不到 | 金额、分类、备注、昵称、生日、在一起的日子、账本名 |
| 服务端能做的破坏 | 删库、拒服务（可用性）；**不能**读内容，**不能**伪造写（除非拿到配对串） |
| 读 vs 写 | 读内容要 `encKey`（= 要配对串）；写/删要 `authKey`（= 也要配对串）。v1 的说法「能读能删同一把钥匙」是错的 —— 那时只凭 `room` 就能写能删 |
| 传输 | HTTPS（Pages 强制）；`authKey` 明文走 HTTPS，被截获等于配对串泄露 |
| 存储 | D1 只有密文 + `auth_hash`；配对串只存在两台手机的 `localStorage`（`secret` 单独存，不写进导出备份） |
| 配对串泄露 | = 数据泄露 + 可被删除。UI 必须写明「配对串就是钥匙，别发群里」 |
| 服务端被拖库 | 攻击者拿到密文、房间号、`auth_hash`，解不开；`auth_hash` 反向推 `authKey` 要 2^256，推 `encKey` 更不可能（HKDF 分离） |
| 重放 / 搬运 | AAD 绑定 `room\|opId\|proto`，换 room 或换 opId 都解不开 |
| 删除权 | 「删除云端数据」真删 `ops/rooms`，不只是标记 |
| 日志 | Functions 里禁止 `console.log(body)`；出错只打 `code` 和耗时 |
| SQL 注入 | 全部用 `prepare(...).bind(...)`，不拼字符串 |
| 用户丢钥匙 | 主恢复路径是「让对方再发一次配对串」；两台都丢 + 备份里也没有 = 云端数据永久作废，文案必须直说，不许含糊 |
| 滥用 | `cipher` ≤ 4KB、单次 50 条、房间 op ≤ 20 万，超限报错不静默截断 |

> **对外口径要改**：`README.md` §二·五 现在写「纯网页 + 不收集任何用户信息」。上了同步之后这句不成立 —— 有 IP 日志、房间元数据、时间戳。改成「情侣账本端到端加密，服务端只存密文、房间号与时间戳，读不到金额和备注」。这不只是文案准确性问题，它是「无需备案」这套说法的一部分，不能含糊。

## 10. 风险与对策

| 风险 | 可能性 | 对策 |
|---|---|---|
| `pages.dev` 国内被干扰 | 中 | 绑自定义域名；`couple-sync.js` 的 base URL 做成可切换（以后换 Vercel/Netlify 只改一个常量）；错误提示先报网络再报密钥 |
| **微信内置浏览器配对失败** | **高** | 主路径改「复制粘贴」；webview 里禁用「加入」按钮（§4.3） |
| 用户丢配对串 | 中 | 配对成功页强制「我已保存」勾选；设置里可再看一次；先让 TA 再发一次。**最坏情况**：两台都丢 + 备份无配对串 → 云端数据永久作废，文案直说 |
| 两台手机同时改同一笔 | 低 | 只按 seq 的 LWW + 墓碑；`dropped` 会把「被放弃的改动」说出来 |
| 离线久了回来「抢赢」 | 低 | 后到者胜是既定语义：离线那台一联网，它的改动拿到最大 seq。对两人场景可接受，不做向量时钟 |
| `book.wipe` 后被对方推回 | 中 | 墓碑 + 清 outbox 同 `cpBookId` 的待发项（§3.2） |
| 换本后两台资料不一致 | 中 | 已知限制：换本的本地重置不推送，`profile.set` 只在 `bookId === activeId` 时应用（§3.3） |
| 协议文案又领先实现 | 中 | 同步没全绿之前，协议保持 v2 的「开发中」；M3 验收通过后再 +1 并改正文 |
| 首次 bootstrap 把本地数据推重复 | 中 | `op_id = "boot_"+tx.id` + 服务端幂等，重推不重复 |
| SW 缓存住 `/api/` | 中 | §6.6 的排除必须做，且要有 e2e 断言 |
| op 越积越多 | 低 | 3 年约 2 千条、`pull(0)` 约 10 次请求，撑得住；到 5 千条以上再做 snapshot op（M3+） |
| D1 免费额度（10 万行写/天） | 低 | 一对情侣一天几十条 op，远够；超出时提示「今天同步次数用完了，明天继续」 |
| 房间被刷 | 低 | `create` 只写一次 `auth_hash`；M3 加空房间 7 天清理 |

## 11. 里程碑（3 段，别一次做完）

### M1 · 打通链路（3–4 天）

- D1 + schema + `push`（含建房）/ `pull` / `health`
- 本地 `wrangler pages dev` 跑通 curl，含 401 反例
- `couple-sync.js` 的 HKDF + AES-GCM(+AAD) + outbox + flush/pull（先不做 UI）
- 单元测试：crypto / queue / merge / converge

**验收**：命令行里 A 推一条、B 拉一条，解密后是同一笔账；断网 10 秒再恢复能补上；错 authKey 返回 401；`verify-sync-converge.js` 200 轮全绿。

### M2 · 能给人用（3–4 天）

- 配对面板（复制配对串 + 二维码 + 粘贴框 + webview 拦截）
- 状态灯三态 + 设置里的「上次同步」
- 首次 bootstrap、解绑、错误提示（先网络后密钥）
- `book.close` / `book.wipe` / `profile.set(bookId)` / 随机账本 id
- e2e 双 profile 测试

**验收**：两台真手机用**粘贴**配对后，记账 3 秒内互相可见；飞行模式不报错；微信里点链接不会假装配对成功。

### M3 · 加固与收尾（2–3 天）

- 「删除云端数据」+ 二次确认
- 限流、体积上限、房间 op 上限、墓碑 90 天清理
- `CONSENT_VERSION + 1`，协议正文改写（把「开发中」全部落实）
- SW 排除 `/api/`、README / 使用说明 / 施工方案同步，**README 的「不收集任何用户信息」改口径**
- 全量回归 + 真机弱网验收

**验收**：`run-all` 全绿，两台手机完成 §8.2 全部清单。

## 12. 要新建 / 修改的文件

| 文件 | 动作 | 说明 |
|---|---|---|
| `functions/api/couple/push.js` | 新建 | 收 op、建房、验 auth、分配 seq、幂等 |
| `functions/api/couple/pull.js` | 新建 | 验 auth、按 since 增量拉取 |
| `functions/api/couple/room.js` | 新建 | 删云端房间（DELETE） |
| `functions/api/couple/health.js` | 新建 | 健康检查（不验 auth） |
| `functions/api/couple/_lib.js` | 新建 | 响应封装、参数校验、`auth_hash` 比对、sha256 |
| `schema.sql` | 新建 | §5.2（无 `verifier`、无 `seqs`） |
| `dist/_routes.json` | 新建 | §5.5：只让 `/api/*` 进 Function（`build-dist.js` 的 FILES 要加它） |
| `wrangler.toml` | 新建 | §7 Step 2 |
| `assets/js/couple-sync.js` | 重写 | 骨架填满（保持导出名不变） |
| `assets/js/store.js` | 中改 | 新增 `applyRemoteOps` / `removeEntity` / `findEntity`；`startNewCpBook` 随机 id；`closeCouple` / `wipeCpBook` 发 op；导出时剔 `_seq` |
| `assets/js/view-couple.js` | 中改 | 同步灯三态、配对面板（粘贴优先）、协议 v3 |
| `assets/js/view-settings.js` | 小改 | 「删除云端数据」「解绑」入口 |
| `sw.js` | 小改 | `/api/` 不缓存 + CACHE 版本 |
| `index.html` | 小改 | `?v=` 升版本 |
| `README.md` / `使用说明.md` | 中改 | 去掉「不收集任何用户信息」的绝对说法，写清同步后的边界 |
| `_test/verify-sync-*.js` | 新建 | §8.1（6 个套件） |
| `_test/sync-pairgen.js` | 新建 | 生成 room/secret/auth/pair，给 curl 自测用 |

## 13. 附：最小接口原型（可直接改）

### 13.1 `_lib.js`

```js
export const json = (o, status = 200) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const bad = (code, status) => json({ ok: false, code }, status);

export async function sha256b64url(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 长度固定、内容等长，逐字符比较即可（authKey 是 128 位随机值的派生，不存在字典攻击面） */
export function safeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export const ROOM_RE = /^[0-9a-f]{32}$/;
export const AUTH_RE = /^[A-Za-z0-9_-]{43}$/;
```

### 13.2 `push.js`

```js
import { json, bad, sha256b64url, safeEq, ROOM_RE, AUTH_RE } from './_lib.js';

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body || !ROOM_RE.test(body.room || '')) return bad('BAD_REQUEST', 400);

  const room = body.room;
  const auth = request.headers.get('x-couple-auth') || '';
  if (!AUTH_RE.test(auth)) return bad('BAD_AUTH', 401);

  const ops = Array.isArray(body.ops) ? body.ops.slice(0, 50) : [];
  if (!ops.length) return bad('BAD_REQUEST', 400);
  for (const op of ops) {
    if (!op || typeof op.opId !== 'string' || !op.opId || op.opId.length > 64) return bad('BAD_REQUEST', 400);
    if (typeof op.cipher !== 'string' || !op.cipher || op.cipher.length > 4096) return bad('BAD_REQUEST', 400);
  }

  const authHash = await sha256b64url(auth);          // 先算，后面两种分支都要
  let created = false;
  let row = await env.DB.prepare('SELECT auth_hash FROM rooms WHERE room = ?1').bind(room).first();

  if (!row) {
    if (!body.create) return bad('ROOM_NOT_FOUND', 404);
    await env.DB.prepare(
      'INSERT OR IGNORE INTO rooms (room, created_at, last_at, auth_hash) VALUES (?1, ?2, ?2, ?3)'
    ).bind(room, Date.now(), authHash).run();
    row = await env.DB.prepare('SELECT auth_hash FROM rooms WHERE room = ?1').bind(room).first();
    if (!row) return bad('SERVER_ERROR', 500);
    if (!safeEq(row.auth_hash, authHash)) return bad('ROOM_TAKEN', 409);   // 别人先占了
    created = true;
  } else if (!safeEq(row.auth_hash, authHash)) {
    return bad('BAD_AUTH', 401);
  }

  const out = [];
  for (const op of ops) {
    const ts = Number(op.ts) || Date.now();
    // 一条 SQL：已存在就不插（返回空），不存在就分配 MAX(seq)+1
    const ins = await env.DB.prepare(
      `INSERT INTO ops (room, op_id, seq, cipher, ts)
       SELECT ?1, ?2, COALESCE((SELECT MAX(seq) FROM ops WHERE room = ?1), 0) + 1, ?3, ?4
       WHERE NOT EXISTS (SELECT 1 FROM ops WHERE room = ?1 AND op_id = ?2)
       RETURNING seq`
    ).bind(room, op.opId, op.cipher, ts).first();

    let seq = ins && ins.seq;
    if (seq == null) {   // 幂等命中：回原来的 seq
      const old = await env.DB.prepare('SELECT seq FROM ops WHERE room = ?1 AND op_id = ?2')
        .bind(room, op.opId).first();
      seq = old ? old.seq : null;
    }
    if (seq != null) out.push({ opId: op.opId, seq });
  }

  await env.DB.prepare('UPDATE rooms SET last_at = ?2 WHERE room = ?1').bind(room, Date.now()).run();
  return json({ ok: true, accepted: out.length, created, seqs: out });
}
```

> 这个版本没有用 `env.DB.batch()`：每条 op 1–2 条语句，50 条也就 50 次往返（D1 同机房，毫秒级）。**正确、好读、好排查优先**，等真有性能压力再合并。

### 13.3 `pull.js`

```js
import { json, bad, sha256b64url, safeEq, ROOM_RE, AUTH_RE } from './_lib.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const room = url.searchParams.get('room') || '';
  if (!ROOM_RE.test(room)) return bad('BAD_REQUEST', 400);

  const auth = request.headers.get('x-couple-auth') || '';
  if (!AUTH_RE.test(auth)) return bad('BAD_AUTH', 401);

  const row = await env.DB.prepare('SELECT auth_hash FROM rooms WHERE room = ?1').bind(room).first();
  if (!row) return bad('ROOM_NOT_FOUND', 404);
  if (!safeEq(row.auth_hash, await sha256b64url(auth))) return bad('BAD_AUTH', 401);

  const since = Math.max(0, Number(url.searchParams.get('since') || 0) || 0);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 200)));

  const { results } = await env.DB.prepare(
    `SELECT seq, op_id, ts, cipher FROM ops WHERE room = ?1 AND seq > ?2 ORDER BY seq ASC LIMIT ?3`
  ).bind(room, since, limit + 1).all();

  const hasMore = results.length > limit;
  const ops = hasMore ? results.slice(0, limit) : results;
  return json({
    ok: true,
    room,
    ops: ops.map((r) => ({ seq: r.seq, opId: r.op_id, ts: r.ts, cipher: r.cipher })),
    next: ops.length ? ops[ops.length - 1].seq : since,
    hasMore,
  });
}
```

### 13.4 `couple-sync.js` 的关键片段

```js
const PROTO = 2;
const INFO_ENC = new TextEncoder().encode('jz1/enc/v1');
const INFO_AUTH = new TextEncoder().encode('jz1/auth/v1');

/** 配对串 → { room, roomHex, secret, encKey, authKey } */
async function deriveFromPair(pair) {
  const all = b64urlToBytes(pair.replace(/[^A-Za-z0-9_-]/g, ''));
  if (all.length !== 32) throw new Error('BAD_PAIR');
  const room16 = all.slice(0, 16);
  const secret = all.slice(16);
  const roomHex = [...room16].map((b) => b.toString(16).padStart(2, '0')).join('');

  const ikm = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const encKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: room16, info: INFO_ENC },
    ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const authBits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: room16, info: INFO_AUTH }, ikm, 256));

  return { room: roomHex, secret, encKey, authKey: bytesToB64url(authBits) };
}

async function encryptOp(encKey, room, opId, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`${room}|${opId}|${PROTO}`);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad }, encKey,
    new TextEncoder().encode(JSON.stringify({ proto: PROTO, ...obj }))));
  const all = new Uint8Array(iv.length + ct.length);
  all.set(iv); all.set(ct, iv.length);
  return bytesToB64(all);
}

async function decryptOp(encKey, room, opId, b64) {
  try {
    const all = b64ToBytes(b64);
    const aad = new TextEncoder().encode(`${room}|${opId}|${PROTO}`);
    const buf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: all.slice(0, 12), additionalData: aad }, encKey, all.slice(12));
    return JSON.parse(new TextDecoder().decode(buf));
  } catch (e) { return null; }   // 解不开/被搬运 → null，绝不抛
}
```

## 14. 一句话排期

> 先按 M1 把「push/pull + crypto + outbox + 合并」在本地跑通（3–4 天，不碰界面），再花 3–4 天做配对（**粘贴为主**）、状态灯、账本生命周期，最后 2–3 天收尾（删云端、协议 v3、README 改口径、全量回归）。合计 10–14 天含真机返工。**M2 之前不要公开说「已支持同步」**，协议也不要提前改。

---

## 15. M1 实施记录（2026-10-19）

M1 的「打通链路」已完成并进了回归：**5 个新套件、148 条断言、纯 Node（不启浏览器）**，全量 25 套件 / 1012 条断言全绿。

### 15.1 实际落地的东西

| 文件 | 说明 |
|---|---|
| `functions/package.json` | `{"type":"module"}`，只影响 Functions 目录，仓库根的 CommonJS 脚本不受影响 |
| `functions/api/couple/_lib.js` | JSON 响应、`bytesToB64url`、`sha256b64url`、`safeEq`、`readAuth`、`checkRoom` |
| `functions/api/couple/push.js` | 建房（`create:true`）、验 auth、`INSERT…SELECT MAX(seq)+1…WHERE NOT EXISTS…RETURNING` 一条语句搞定幂等 + 分配 |
| `functions/api/couple/pull.js` | 增量拉取，`limit+1` 判 `hasMore` |
| `functions/api/couple/room.js` | DELETE 真删 ops + rooms |
| `functions/api/couple/health.js` | 不验 auth，只报可达（用来区分「网络不通」和「配对串不对」） |
| `schema.sql` | `rooms(room, created_at, last_at, auth_hash)` / `ops(room, op_id, seq, cipher, ts)` + `UNIQUE(room, seq)` |
| `wrangler.toml` | 放 **项目根**（Pages 要求），`database_id` 待填 |
| `assets/js/couple-sync.js` | 全量重写：HKDF 双子键、AES-GCM+AAD、配对串、outbox、pull/push、`mergeList`、`status` |
| `assets/js/store.js` | 新增 `applyRemoteOps` / `syncAccepted` / `cpTomb` / `syncPurgeOutbox` / `purgeBookLocal`；`exportJSON` 剔 `_seq` |
| `_test/_d1.js` | D1 适配器（`node:sqlite`，跑真 SQL） |
| `_test/_syncenv.js` | 把「真 Functions + 真 SQLite」接成 fetch，把 couple-sync 装进 vm 沙箱，一台设备=一个沙箱 |
| `_test/sync-pairgen.js` | 生成 room/secret/auth/pair，给 curl 自测 |
| `_test/verify-sync-{crypto,queue,merge,server,converge}.js` | 23 / 42 / 20 / 41 / 22 条断言 |

### 15.2 实施中发现的五个真问题（方案原文没写）

1. **配对串不能用 `-` 分组**（已回改 §4.1）。`-` 是 base64url 合法字符，当分隔符会直接破解码。改用空格。
2. **本地删除必须落墓碑**。同步是「先拉后推」，下一次 `syncOnce` 会把自己推上去的旧 `add` 拉回来——如果本地删除不记墓碑，那笔刚删掉的账会被自己的历史 op **复活**。`cpRemoveTx` 里补了 `tomb[id] = t._seq`。
3. **推成功之后必须在本地应用自己推的那个版本**。只回填 `_seq` 不够：并发修改时本地会停在旧值、对方拿到新值，两台永久不一致。`outboxFlush` 现在把 `data` 一起回传给 `onAccepted`，由 `store.syncAccepted` 落到实体上。
4. **`join()` 必须把 `created` 置为 true**。房间是对方建的，加入方再发 `create:true` 会被判成抢注。
5. **首次同步的 `pull` 必然 404，不能算失败**。房间还没建时 `/pull` 返回 `ROOM_NOT_FOUND`，紧接着的 `push`（`create:true`）才会把房间建出来。最初的 `syncOnce` 把它当成失败（`ok:false`）并把 `lastError` 写进状态，状态灯一上来就变黄。现在的规则是：`ROOM_NOT_FOUND` 不记错误、不判失败，其余错误才算。这条只有打到真 workerd 上才暴露——Node 夹具里第一笔正好是先 push 后断言，绕过去了。

### 15.3 部署链路（已打通，2026-10-19 实测）

| 项 | 值 |
|---|---|
| 账号 | `<你的 Cloudflare 登录邮箱>`（Account ID 见 Cloudflare 后台概览页） |
| D1 | `jizhang-couple` · `e5644e25-ac90-4263-95e9-1cbddaa34e24` |
| 区域 | **APAC / HKG（香港）** —— 国内访问延迟天然较低 |
| 表 | 远端与本地都已建：`rooms` / `ops` |
| 冒烟 | `_test/verify-sync-live.js` **15 / 15** |

`_test/verify-sync-live.js` 是「真运行时」测试：客户端引擎原封不动，只把网络层换成真 HTTP，打到 `wrangler pages dev` 起的 workerd + D1 binding 上。它覆盖了 Node 夹具测不到的一段（`Request`/`Response` 实现、D1 binding 行为）：

- A 建房并推第一笔 → B 用配对串加入 → 拉到同一笔，金额与备注一致
- B 改一笔 → A 收到（按 seq 后到者胜）
- 错 auth 的 pull → 401 `BAD_AUTH`；带 create 抢注 → 409 `ROOM_TAKEN`；不带 auth 的 push → 401
- 删云端 → 真删；删完再拉 → 404
- 跑完自动清理，本地库 `rooms = 0 / ops = 0`

```bash
npx wrangler pages dev dist --d1 DB=e5644e25-ac90-4263-95e9-1cbddaa34e24 --port 8788
node _test/verify-sync-live.js
```

> **还没部署。** Pages 项目（`jizhang`）尚未创建、尚未上传；`wrangler.toml` 已填好 `database_id`，M2 的界面做完再发。

### 15.4 还没做的（属于 M2 / M3）

- 界面：配对面板（粘贴为主 + 二维码辅助）、三态状态灯、上次同步时间
- `book.close` / `book.wipe` / `profile.set(bookId)` 的入队与视图联动（合并内核与 `applyRemoteOps` 已就位，缺的是触发点和 UI）
- 首次 bootstrap 分批推（目前靠 outbox 500 上限 + 单批 50 自动分页）
- 限流、`ROOM_FULL`、墓碑 90 天清理、`CONSENT_VERSION + 1`
- 真机部署验证：`npx wrangler login` → `d1 create` → `pages dev` → 两台手机配对

### 15.5 怎么自己验一遍

```bash
# 纯 Node，不需要浏览器、不需要 Cloudflare 账号
node _test/run-all.js --fast          # 含三个同步套件，约 25 秒
node _test/verify-sync-converge.js    # 只跑收敛性（200 轮随机交错）

# 生成一组配对串，手工 curl
node _test/sync-pairgen.js
```

---

## 16. M2 实施记录（2026-10-19，v1.18.1）

M2 的第一批：**配对面板 + 状态灯 + 启动同步**。界面已经能真的配出房间（对着本地 `pages dev` 就能用）。

### 16.1 落地的东西

| 文件 | 改动 |
|---|---|
| `assets/js/view-sync.js` | **新建**。`ViewSync.open()` 配对面板（未配对 / 展示配对码 / 粘贴加入 / 已配对四种视图）、`lamp()` / `refreshLamp()` 状态灯 |
| `assets/js/view-couple.js` | 右上角那颗灯改成三态（`syncLampCls()` / `syncLampTitle()`）；`data-cp="sync-soon"` → `"sync"`，点击打开面板；删掉「同步还没做」的告知弹窗 |
| `assets/js/store.js` | 新增 `syncBootstrap()`：首次配对把本机已有的情侣账 / 基金 / 账本排队推上去，`op_id = boot_ + id`，重推幂等 |
| `assets/js/app.js` | `boot()` 里：已配对就 `startPolling()`、1.5s 后首拉、`online` 与 `visibilitychange` 补同步；全程 try/catch |
| `index.html` / `sw.js` | 登记 `view-sync.js`（脚本标签在 view-couple 之前，SW 预缓存列表同步加） |
| `assets/css/couple.css` | 灯的三态配色 + 面板样式（配对码等宽分组、错误条、状态行） |
| `_test/verify-sync-ui.js` | **新建**，25 条断言（Edge headless） |

### 16.2 几个界面上的取舍

- **复制粘贴是主路径，二维码没做**。43 字符用空格分 4 组显示（`-` 不能当分隔符，见 §15.2 第 1 条），配「复制配对码」按钮。二维码留到以后——它需要自己实现编码器，收益不如把粘贴这条路走顺。
- **配对码永远能「再看一次」**。发起后又回到已配对视图，想再拿一次点「查看配对码」，不需要重新配对。
- **错误分三种说法**：连不上服务器（`NETWORK`）/ 这串不对（`BAD_AUTH`）/ 对方还没发起（`ROOM_NOT_FOUND`）。不再出现「配对失败了」这种什么都说的提示。
- **解绑只清本机**，云端不动；文案里写明「TA 那边照常同步，想一起清掉用『删除云端数据』」。

### 16.3 测试

`_test/verify-sync-ui.js` 覆盖：灯的三态与旧入口消失、面板两个入口、粘贴位数校验、配对码 43 位与 4 个一组、`ready()` 变真、`parsePair` 出 32 hex、已配对视图、关面板后灯变色、再看一次拿到同一串、二次确认后解绑、全程无未捕获异常。

全量基线 1012 → **1037**（26 个套件）。

### 16.4 还没做

- ~~**删除云端数据**~~（v1.18.3 已做：配对面板 → 两次确认 → `DELETE /api/couple/room`，成功后本机自动解绑）
- **二维码**（可选；配对串仍靠复制粘贴）
- `book.close` / `book.wipe` / `profile.set(bookId)` 的**触发点**（合并层已支持，缺 UI 调用）
- 首次 bootstrap 超过 500 条时的分批（现在靠 outbox 上限截断）
- 真机验收：两台手机在**关掉梯子的 4G** 下配对 —— 这条只能人来做
- 实时提醒：**决定不做**（浏览器关掉就收不到，ntfy 的 Web Push 只服务它自己的 Web App）。
  替代方案是 v1.18.4 的本地提示「TA 刚记了 N 笔」：拉到对方的账就抛 `couple:peer-tx`，
  主页显示一条可点的提示。

### 16.5 已上线（v1.18.4）

| 项 | 值 |
|---|---|
| 线上地址 | **https://where-i-paid.pages.dev**（官网在根，App 在 `/app/`） |
| Pages 项目 | `where-i-paid`（production branch = `main`），**官网与 App 同一个项目** |
| D1 | `jizhang-couple` · APAC / HKG |
| 构建 | `node build-site.js`（打 dist → 拷进 `site/app/` → 打 zip → 注入版本与体积） |
| 部署 | `npx wrangler pages deploy site --project-name where-i-paid --branch main` |
| 线上冒烟 | `SYNC_BASE=https://where-i-paid.pages.dev node _test/verify-sync-live.js` → **15 / 15** |
| 静态资源 | `/` 200（20KB 官网）、`/app/` 200（5.4KB）、`/app/sw.js` 200、`/api/couple/health` 200 |

> **域名最终定成 `where-i-paid`**：`jizhang.pages.dev` 被占，Cloudflare 给旧项目加了 `-3j9` 后缀，很难看。现在改成「官网与 App 同一个项目」：根路径是官网，`/app/` 是应用。原官网任务书 D3 里把这条列为「方案 B，以后再合并」，现在提前合了，因为再分两个域名会变成两个 origin —— **用户在两个域名下装出来的 App 是两份数据**。
>
> 旧的 `jizhang` 项目已删除（只有十几分钟、没有真实用户）。D1 不受影响，仍然共用 `jizhang-couple`。

**一个反直觉的运维结论**：这台机器上**开着代理反而访问 `pages.dev` 会 522**，绕过代理直连 0.3s 就通。`wrangler` 的 API 请求（部署、D1）走代理没问题，但**验证线上地址一定要 `--noproxy '*'`**，否则会误判成「部署失败」。

### 16.6 真机验收清单（只能人做）

两台手机、都装 v1.18.2，**关掉梯子、用 4G**：

- [ ] Android：Chrome 打开 <https://where-i-paid.pages.dev/app/> → 底部「安装应用」→ 桌面出现图标
- [ ] iPhone：Safari 打开同一个 `/app/` 地址 → 分享 → 添加到主屏幕（微信里点链接装不了）
- [ ] A 点情侣页右上角灰灯 → 发起配对 → 复制 43 位配对码 → 用微信发给自己或对方
- [ ] B 点灯 → 我收到了一串 → 粘贴 → 加入成功，能看到 A 的历史账
- [ ] A 记一笔 → B 几秒内看到；B 改一笔 → A 看到
- [ ] 两台都开飞行模式各记一笔 → 关飞行模式 → 10 秒内两台一致且不重复
- [ ] 断网时灯变黄；恢复后变绿
- [ ] 解除连接 → 灯变灰；重新配对能拿回同一串配对码
- [ ] 清掉 B 的浏览器数据 → 用配对码恢复（云端还有数据）

> 验收时如果卡在某一步，先看**灯的颜色**和面板里的「待发 N 条」—— 这两个信息能直接区分「网络不通」「配对码不对」「服务器出错」。
