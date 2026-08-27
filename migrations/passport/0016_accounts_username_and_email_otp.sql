CREATE TABLE IF NOT EXISTS passport_usernames (
	user_id INTEGER PRIMARY KEY NOT NULL,
	username TEXT NOT NULL UNIQUE CHECK (length(username) BETWEEN 6 AND 12),
	created_at INTEGER NOT NULL,
	FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS passport_user_email_otps (
	id TEXT PRIMARY KEY NOT NULL,
	user_id INTEGER NOT NULL,
	email TEXT NOT NULL CHECK (length(trim(email)) > 0),
	code_hash TEXT NOT NULL CHECK (length(trim(code_hash)) > 0),
	attempt_count INTEGER NOT NULL DEFAULT 0,
	status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired')),
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS passport_user_email_otps_lookup ON passport_user_email_otps(user_id, status, created_at);
