-- Orders: clientOrderId yra PK → idempotency užtikrinama DB lygiu (INSERT OR IGNORE).
CREATE TABLE IF NOT EXISTS orders (
  client_order_id   TEXT PRIMARY KEY,
  symbol            TEXT NOT NULL,
  side              TEXT NOT NULL CHECK (side IN ('buy','sell')),
  qty               REAL NOT NULL,
  price             REAL NOT NULL,
  mode              TEXT NOT NULL CHECK (mode IN ('paper','testnet','mainnet')),
  status            TEXT NOT NULL,
  exchange_order_id TEXT,
  intent_json       TEXT NOT NULL,
  risk_decision_json TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- Audit: append-only. Niekada UPDATE/DELETE.
CREATE TABLE IF NOT EXISTS audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              INTEGER NOT NULL,
  event           TEXT NOT NULL,
  actor           TEXT NOT NULL,
  ip              TEXT NOT NULL,
  client_order_id TEXT,
  detail_json     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_order ON audit_log(client_order_id);

-- Risk state: single-user → viena eilutė (id = 1). JSON blob, nes struktūra evoliucionuoja.
CREATE TABLE IF NOT EXISTS risk_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  state_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Risk limits: taip pat viena eilutė; keičiama tik per API su audit įrašu.
CREATE TABLE IF NOT EXISTS risk_limits (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  limits_json TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);
