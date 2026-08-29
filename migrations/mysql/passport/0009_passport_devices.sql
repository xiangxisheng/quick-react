CREATE TABLE IF NOT EXISTS passport_devices (
	id VARCHAR(128) NOT NULL PRIMARY KEY,
	user_id BIGINT NOT NULL,
	fingerprint VARCHAR(128) NOT NULL,
	user_agent TEXT NOT NULL,
	platform VARCHAR(255) NOT NULL,
	ip_address VARCHAR(128) NOT NULL,
	status VARCHAR(16) NOT NULL DEFAULT 'active',
	created_at BIGINT NOT NULL,
	last_seen_at BIGINT NOT NULL,
	revoked_at BIGINT NULL,
	UNIQUE KEY passport_devices_fingerprint (fingerprint),
	KEY passport_devices_user_id (user_id),
	KEY passport_devices_status (status),
	CONSTRAINT passport_devices_user_fk FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);
ALTER TABLE passport_sessions ADD COLUMN device_id VARCHAR(128) NULL;
ALTER TABLE passport_sessions ADD KEY passport_sessions_device_id (device_id);
