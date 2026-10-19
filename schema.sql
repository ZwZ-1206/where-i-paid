-- ============================================================
-- 花哪儿了 · 情侣双人同步 · D1 建表
-- 2026-10-19 v2：删掉 verifier 列与 seqs 表；auth 改为 SHA-256(authKey)
-- 执行：
--   本地  npx wrangler d1 execute jizhang-couple --local  --file=./schema.sql
--   线上  npx wrangler d1 execute jizhang-couple --remote --file=./schema.sql
-- ============================================================

-- 房间：一条记录一个情侣空间。room 是 32 位小写 hex。
CREATE TABLE IF NOT EXISTS rooms (
  room        TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  last_at     INTEGER NOT NULL,
  auth_hash   TEXT NOT NULL          -- base64url(SHA-256(authKey))
);

-- 变更日志：只追加，不改不删（删除本身也是一条 op）
CREATE TABLE IF NOT EXISTS ops (
  room    TEXT    NOT NULL,
  op_id   TEXT    NOT NULL,          -- 客户端 UUID，明文，幂等键
  seq     INTEGER NOT NULL,          -- 房间内自增
  cipher  TEXT    NOT NULL,          -- base64(iv ‖ AES-GCM 密文)
  ts      INTEGER NOT NULL,          -- 客户端写入时间（排序用 seq，不用它）
  PRIMARY KEY (room, op_id)
);

-- 并发兜底 + 拉取主路径（唯一索引本身就能服务 where room and seq > ? order by seq）
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_room_seq ON ops (room, seq);
