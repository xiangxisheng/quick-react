CREATE TABLE IF NOT EXISTS passport_login_challenges (
	id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
	user_id INTEGER NOT NULL,
	bot_id INTEGER NOT NULL,
	telegram_user_id INTEGER NOT NULL,
	chat_id INTEGER NOT NULL,
	expected_number INTEGER NOT NULL CHECK (expected_number BETWEEN 1 AND 99),
	status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'consumed')),
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS passport_login_challenges_identity
	ON passport_login_challenges(bot_id, telegram_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS passport_login_challenges_expires
	ON passport_login_challenges(status, expires_at);
