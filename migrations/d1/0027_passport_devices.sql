CREATE TABLE IF NOT EXISTS passport_devices (
	id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
	user_id INTEGER NOT NULL,
	fingerprint TEXT NOT NULL CHECK (length(trim(fingerprint)) > 0),
	user_agent TEXT NOT NULL DEFAULT '',
	platform TEXT NOT NULL DEFAULT '',
	ip_address TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
	created_at INTEGER NOT NULL,
	last_seen_at INTEGER NOT NULL,
	revoked_at INTEGER,
	UNIQUE (fingerprint)
);
CREATE INDEX IF NOT EXISTS passport_devices_user_id ON passport_devices(user_id);
CREATE INDEX IF NOT EXISTS passport_devices_status ON passport_devices(status);
ALTER TABLE passport_sessions ADD COLUMN device_id TEXT;
CREATE INDEX IF NOT EXISTS passport_sessions_device_id ON passport_sessions(device_id);
