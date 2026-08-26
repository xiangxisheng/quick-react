CREATE TABLE IF NOT EXISTS passport_sso_requests (
	id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
	target_site_key TEXT NOT NULL CHECK (length(trim(target_site_key)) > 0),
	target_hostname TEXT NOT NULL CHECK (length(trim(target_hostname)) > 0),
	status TEXT NOT NULL CHECK (status IN ('pending', 'consumed', 'expired')),
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS passport_sso_requests_expires ON passport_sso_requests(status, expires_at);

CREATE TABLE IF NOT EXISTS passport_login_tickets (
	token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64),
	user_id INTEGER NOT NULL,
	target_site_key TEXT NOT NULL CHECK (length(trim(target_site_key)) > 0),
	target_hostname TEXT NOT NULL CHECK (length(trim(target_hostname)) > 0),
	status TEXT NOT NULL CHECK (status IN ('pending', 'consumed', 'expired')),
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS passport_login_tickets_expires ON passport_login_tickets(status, expires_at);

CREATE TABLE IF NOT EXISTS passport_site_sessions (
	id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
	user_id INTEGER NOT NULL,
	site_key TEXT NOT NULL CHECK (length(trim(site_key)) > 0),
	hostname TEXT NOT NULL CHECK (length(trim(hostname)) > 0),
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS passport_site_sessions_user ON passport_site_sessions(user_id);
CREATE INDEX IF NOT EXISTS passport_site_sessions_target ON passport_site_sessions(site_key, hostname, expires_at);
