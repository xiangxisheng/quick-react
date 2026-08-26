CREATE TABLE IF NOT EXISTS global_telegram_bots (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
	bot_token TEXT NOT NULL UNIQUE CHECK (length(trim(bot_token)) > 0),
	bot_username TEXT NOT NULL UNIQUE CHECK (length(trim(bot_username)) > 0),
	secret_token TEXT NOT NULL CHECK (length(trim(secret_token)) BETWEEN 1 AND 256),
	webhook_hostname TEXT NOT NULL CHECK (length(trim(webhook_hostname)) > 0),
	status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (webhook_hostname) REFERENCES global_site_hosts(hostname) ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX IF NOT EXISTS global_telegram_bots_webhook_hostname
	ON global_telegram_bots(webhook_hostname);
