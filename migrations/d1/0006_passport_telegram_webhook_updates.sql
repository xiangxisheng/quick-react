CREATE TABLE IF NOT EXISTS passport_telegram_updates (
	bot_id INTEGER NOT NULL,
	update_id INTEGER NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (bot_id, update_id)
);

CREATE INDEX IF NOT EXISTS passport_telegram_updates_status
	ON passport_telegram_updates(status, updated_at);
