-- Free and Pro plans. Pro keeps edit history (old versions and forgotten memories); free
-- accounts overwrite and delete in place. Billing runs through Stripe, which tells us about
-- subscription changes by webhook.
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro'));
ALTER TABLE users ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;
-- A free account's leftover history (from before plans, or from a lapsed Pro subscription)
-- is deleted by the daily cron after this time. Null means nothing to keep.
ALTER TABLE users ADD COLUMN history_until TEXT;

CREATE INDEX users_stripe_customer ON users (stripe_customer_id);

-- Everyone predates plans and is now on free: give them 30 days before their history goes.
UPDATE users SET history_until = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days');
