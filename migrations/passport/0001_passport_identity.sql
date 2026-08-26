CREATE TABLE IF NOT EXISTS passport_users (
	user_id INTEGER PRIMARY KEY NOT NULL CHECK (user_id >= 4194304),
	nickname TEXT NOT NULL CHECK (length(trim(nickname)) BETWEEN 1 AND 12),
	status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS passport_user_credentials (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	password TEXT NOT NULL CHECK (length(trim(password)) > 0),
	created_at INTEGER NOT NULL,
	FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS passport_user_credentials_user_created
	ON passport_user_credentials(user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS passport_sessions (
	id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
	user_id INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS passport_sessions_user_id
	ON passport_sessions(user_id);
CREATE INDEX IF NOT EXISTS passport_sessions_expires_at
	ON passport_sessions(expires_at);

CREATE TABLE IF NOT EXISTS passport_telegram_accounts (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	bot_id INTEGER NOT NULL,
	telegram_user_id INTEGER NOT NULL,
	chat_id INTEGER NOT NULL,
	nickname TEXT NOT NULL CHECK (length(trim(nickname)) BETWEEN 1 AND 12),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	UNIQUE (user_id, bot_id, telegram_user_id),
	FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS passport_telegram_accounts_lookup
	ON passport_telegram_accounts(bot_id, telegram_user_id);

CREATE TABLE IF NOT EXISTS passport_oauth_accounts (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	provider TEXT NOT NULL CHECK (length(trim(provider)) > 0),
	provider_user_id TEXT NOT NULL CHECK (length(trim(provider_user_id)) > 0),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	UNIQUE (user_id, provider, provider_user_id),
	FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS passport_oauth_accounts_lookup
	ON passport_oauth_accounts(provider, provider_user_id);

CREATE TABLE IF NOT EXISTS passport_emails (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	email TEXT NOT NULL CHECK (length(trim(email)) > 0),
	verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS passport_emails_lookup
	ON passport_emails(email);

CREATE TABLE IF NOT EXISTS passport_user_emails (
	user_id INTEGER NOT NULL,
	email_id INTEGER NOT NULL,
	is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
	created_at INTEGER NOT NULL,
	PRIMARY KEY (user_id, email_id),
	FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT,
	FOREIGN KEY (email_id) REFERENCES passport_emails(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS passport_user_emails_email_id
	ON passport_user_emails(email_id);

CREATE TABLE IF NOT EXISTS passport_email_otp (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	email_id INTEGER NOT NULL,
	code_hash TEXT NOT NULL CHECK (length(trim(code_hash)) > 0),
	attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
	status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired')),
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT,
	FOREIGN KEY (email_id) REFERENCES passport_emails(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS passport_email_otp_lookup
	ON passport_email_otp(user_id, email_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS passport_user_roles (
	user_id INTEGER NOT NULL,
	role TEXT NOT NULL CHECK (length(trim(role)) > 0),
	created_at INTEGER NOT NULL,
	PRIMARY KEY (user_id, role),
	FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS passport_group_prompts (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	chat_id INTEGER NOT NULL,
	actor_id INTEGER NOT NULL,
	state_json TEXT NOT NULL DEFAULT '{}',
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS passport_group_prompts_lookup
	ON passport_group_prompts(chat_id, actor_id, updated_at DESC);
