CREATE TABLE IF NOT EXISTS passport_snowflake_state (
	worker_id INTEGER PRIMARY KEY NOT NULL CHECK (worker_id BETWEEN 0 AND 1023),
	last_timestamp INTEGER NOT NULL CHECK (last_timestamp >= 1288834974657),
	updated_at INTEGER NOT NULL
);

DROP INDEX IF EXISTS passport_telegram_accounts_lookup;
CREATE UNIQUE INDEX IF NOT EXISTS passport_telegram_accounts_identity
	ON passport_telegram_accounts(bot_id, telegram_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS passport_oauth_accounts_identity
	ON passport_oauth_accounts(provider, provider_user_id);

DROP INDEX IF EXISTS passport_emails_lookup;
CREATE UNIQUE INDEX IF NOT EXISTS passport_emails_email
	ON passport_emails(email);
CREATE UNIQUE INDEX IF NOT EXISTS passport_user_emails_email_owner
	ON passport_user_emails(email_id);

DROP TABLE IF EXISTS passport_email_otp;
CREATE TABLE passport_email_otp (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	bot_id INTEGER NOT NULL,
	telegram_user_id INTEGER NOT NULL,
	chat_id INTEGER NOT NULL,
	email TEXT NOT NULL CHECK (length(trim(email)) > 0),
	code_hash TEXT NOT NULL CHECK (length(trim(code_hash)) > 0),
	attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
	status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired')),
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE INDEX passport_email_otp_lookup
	ON passport_email_otp(bot_id, telegram_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS passport_telegram_menus (
	bot_id INTEGER NOT NULL,
	telegram_user_id INTEGER NOT NULL,
	chat_id INTEGER NOT NULL,
	message_id INTEGER NOT NULL,
	mode TEXT NOT NULL CHECK (mode IN ('menu', 'email', 'otp')),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (bot_id, telegram_user_id)
);
