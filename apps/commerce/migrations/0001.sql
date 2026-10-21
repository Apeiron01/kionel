CREATE TABLE checkouts (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  polar_checkout_id TEXT UNIQUE,
  licensee TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  checkout_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('paid','refunded')),
  license_json TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX orders_checkout ON orders(checkout_id);
