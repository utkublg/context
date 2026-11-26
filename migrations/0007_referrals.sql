-- Referrals: "invite a friend, you both get a month of Pro". A reward is given once the friend
-- connects their first AI app, which takes more effort to fake than a bare sign-up.
ALTER TABLE users ADD COLUMN referral_code TEXT;
-- Who invited this user. Deliberately not a foreign key, so deleting the inviter isn't blocked.
ALTER TABLE users ADD COLUMN referred_by TEXT;
ALTER TABLE users ADD COLUMN referral_rewarded_at TEXT;
-- Free Pro from referrals runs until this time, on top of (or instead of) a paid plan.
ALTER TABLE users ADD COLUMN pro_until TEXT;
-- Free Pro days earned while paying for Pro. They start when the paid subscription ends.
ALTER TABLE users ADD COLUMN bonus_days INTEGER NOT NULL DEFAULT 0;

UPDATE users SET referral_code = lower(hex(randomblob(5)));

CREATE UNIQUE INDEX users_referral_code ON users (referral_code);
CREATE INDEX users_referred_by ON users (referred_by);
