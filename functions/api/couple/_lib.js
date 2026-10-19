/**
 * 情侣同步 · Functions 共享工具
 *
 * 只做四件事：JSON 响应、参数格式校验、auth_hash 计算与比对、错误码。
 * 数据一律走密文，这里不碰业务语义。
 */

export const ROOM_RE = /^[0-9a-f]{32}$/;
/** base64url(32 字节) = 43 字符，无填充 */
export const AUTH_RE = /^[A-Za-z0-9_-]{43}$/;
/** cipher 单条上限，和 §5.4 的 4KB 对齐 */
export const MAX_CIPHER = 4096;
/** 单次 push 最多多少条 op */
export const MAX_OPS = 50;

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function bad(code, status) {
  return json({ ok: false, code }, status);
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** 字节 → base64url（无填充）。Workers 里没有 Buffer，自己转，别依赖 btoa 的字符集差异。 */
export function bytesToB64url(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63];
  }
  if (i < bytes.length) {
    const rest = bytes.length - i;
    const n = (bytes[i] << 16) | (rest > 1 ? bytes[i + 1] << 8 : 0);
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
    if (rest > 1) out += B64URL[(n >> 6) & 63];
  }
  return out;
}

/** 服务端只存 SHA-256(authKey)，永远不存 authKey 本身 */
export async function sha256b64url(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return bytesToB64url(new Uint8Array(buf));
}

/**
 * 定长字符串比较。
 * 两串都是 base64url(32 字节) 的派生值，长度固定，逐字符比即可；
 * 不用 === 是为了不因为提前 return 泄露前缀（虽然这里攻击面极小，顺手做对）。
 */
export function safeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** 读出并校验请求头里的 authKey；不合法返回空串 */
export function readAuth(request) {
  const v = request.headers.get('x-couple-auth') || '';
  return AUTH_RE.test(v) ? v : '';
}

/**
 * 校验「请求头 authKey 的哈希」与房间上存的是否一致。
 * @returns {Promise<'ok'|'notfound'|'bad'|'taken'>}
 */
export async function checkRoom(env, room, authKey) {
  const row = await env.DB.prepare('SELECT auth_hash FROM rooms WHERE room = ?1').bind(room).first();
  if (!row) return 'notfound';
  return safeEq(row.auth_hash, await sha256b64url(authKey)) ? 'ok' : 'bad';
}

/** 环境变量兜底：这是 Pages 上的 D1 绑定，缺了就是配置错，不是用户错 */
export function needDB(env) {
  return env && env.DB ? null : bad('SERVER_ERROR', 500);
}
