-- Keep the new automation subscription separate from the existing Lab subscription.
ALTER TABLE subscriptions ADD COLUMN plan TEXT NOT NULL DEFAULT 'subscription';
