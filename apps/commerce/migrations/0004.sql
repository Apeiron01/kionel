-- Bind delivery to a checkout identifier, never to a customer-supplied name.
ALTER TABLE checkouts ADD COLUMN plan TEXT NOT NULL DEFAULT 'pilot';
ALTER TABLE subscriptions ADD COLUMN checkout_id TEXT;
ALTER TABLE subscriptions ADD COLUMN last_order_id TEXT;
ALTER TABLE subscriptions ADD COLUMN last_order_created_at TEXT;
CREATE UNIQUE INDEX subscriptions_checkout ON subscriptions(checkout_id);
-- Existing subscriptions intentionally remain unbound: names cannot establish ownership.
