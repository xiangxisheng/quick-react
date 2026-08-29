CREATE TABLE IF NOT EXISTS passport_devices (
	id VARCHAR(128) PRIMARY KEY,
	user_id BIGINT NOT NULL REFERENCES passport_users(user_id) ON DELETE RESTRICT,
	fingerprint VARCHAR(128) NOT NULL,
	user_agent TEXT NOT NULL DEFAULT '',
	platform VARCHAR(255) NOT NULL DEFAULT '',
	ip_address VARCHAR(128) NOT NULL DEFAULT '',
	status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
	created_at BIGINT NOT NULL,
	last_seen_at BIGINT NOT NULL,
	revoked_at BIGINT,
	UNIQUE (fingerprint)
);
CREATE INDEX IF NOT EXISTS passport_devices_user_id ON passport_devices(user_id);
CREATE INDEX IF NOT EXISTS passport_devices_status ON passport_devices(status);
ALTER TABLE passport_sessions ADD COLUMN device_id VARCHAR(128);
CREATE INDEX IF NOT EXISTS passport_sessions_device_id ON passport_sessions(device_id);
