CREATE TABLE IF NOT EXISTS passport_telegram_identity_choices (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	bot_id INTEGER NOT NULL,
	telegram_user_id INTEGER NOT NULL,
	chat_id INTEGER NOT NULL,
	target_user_id INTEGER NOT NULL,
	email TEXT NOT NULL CHECK (length(trim(email)) > 0),
	status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (target_user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS passport_telegram_identity_choices_lookup
	ON passport_telegram_identity_choices(bot_id, telegram_user_id, status, created_at DESC);
