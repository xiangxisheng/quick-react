CREATE TABLE IF NOT EXISTS base_system_users (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	username VARCHAR(255) NOT NULL UNIQUE,
	password TEXT NOT NULL,
	roles LONGTEXT NOT NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'enabled',
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS base_system_sessions (
	id VARCHAR(128) NOT NULL PRIMARY KEY,
	user_id BIGINT NOT NULL,
	expires_at BIGINT NOT NULL,
	created_at BIGINT NOT NULL,
	KEY base_system_sessions_user_id (user_id),
	CONSTRAINT base_system_sessions_user_fk FOREIGN KEY (user_id) REFERENCES base_system_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS base_system_configs (
	`key` VARCHAR(255) NOT NULL PRIMARY KEY,
	value LONGTEXT NOT NULL,
	updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS base_system_bootstrap (
	`key` VARCHAR(255) NOT NULL PRIMARY KEY,
	value TEXT NOT NULL
);

INSERT IGNORE INTO base_system_bootstrap (`key`, value) VALUES ('initial_admin', 'open');

CREATE TABLE IF NOT EXISTS base_oidc_login_requests (
	id VARCHAR(128) NOT NULL PRIMARY KEY,
	issuer VARCHAR(2048) NOT NULL,
	state VARCHAR(255) NOT NULL UNIQUE,
	nonce VARCHAR(255) NOT NULL,
	code_verifier VARCHAR(255) NOT NULL,
	return_path TEXT NOT NULL,
	expires_at BIGINT NOT NULL,
	created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS base_oidc_accounts (
	issuer VARCHAR(512) NOT NULL,
	subject VARCHAR(255) NOT NULL,
	user_id BIGINT NOT NULL,
	profile LONGTEXT NOT NULL,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	PRIMARY KEY (issuer, subject),
	KEY base_oidc_accounts_user (user_id),
	CONSTRAINT base_oidc_accounts_user_fk FOREIGN KEY (user_id) REFERENCES base_system_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS base_oidc_sessions (
	issuer VARCHAR(512) NOT NULL,
	sid VARCHAR(255) NOT NULL,
	session_id VARCHAR(128) NOT NULL UNIQUE,
	created_at BIGINT NOT NULL,
	PRIMARY KEY (issuer, sid),
	CONSTRAINT base_oidc_sessions_session_fk FOREIGN KEY (session_id) REFERENCES base_system_sessions(id) ON DELETE CASCADE
);
