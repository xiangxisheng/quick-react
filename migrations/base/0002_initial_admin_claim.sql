CREATE TABLE IF NOT EXISTS base_system_bootstrap (
	key TEXT PRIMARY KEY NOT NULL,
	value TEXT NOT NULL
);

INSERT INTO base_system_bootstrap (key, value) VALUES ('initial_admin', 'open')
ON CONFLICT(key) DO NOTHING;
