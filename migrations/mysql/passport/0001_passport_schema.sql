CREATE TABLE IF NOT EXISTS passport_users (
	user_id BIGINT NOT NULL PRIMARY KEY CHECK (user_id >= 4194304),
	nickname VARCHAR(48) NOT NULL CHECK (CHAR_LENGTH(TRIM(nickname)) BETWEEN 1 AND 12),
	status VARCHAR(32) NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS passport_user_credentials (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	user_id BIGINT NOT NULL,
	password TEXT NOT NULL,
	created_at BIGINT NOT NULL,
	KEY passport_user_credentials_user_created (user_id, created_at DESC, id DESC),
	CONSTRAINT passport_user_credentials_user_fk FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS passport_sessions (
	id VARCHAR(128) NOT NULL PRIMARY KEY,
	user_id BIGINT NOT NULL,
	expires_at BIGINT NOT NULL,
	created_at BIGINT NOT NULL,
	KEY passport_sessions_user_id (user_id),
	KEY passport_sessions_expires_at (expires_at),
	CONSTRAINT passport_sessions_user_fk FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS passport_telegram_accounts (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	user_id BIGINT NOT NULL,
	bot_id BIGINT NOT NULL,
	telegram_user_id BIGINT NOT NULL,
	chat_id BIGINT NOT NULL,
	nickname VARCHAR(48) NOT NULL CHECK (CHAR_LENGTH(TRIM(nickname)) BETWEEN 1 AND 12),
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	UNIQUE KEY passport_telegram_accounts_identity (bot_id, telegram_user_id),
	UNIQUE KEY passport_telegram_accounts_owner_identity (user_id, bot_id, telegram_user_id),
	CONSTRAINT passport_telegram_accounts_user_fk FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS passport_oauth_accounts (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	user_id BIGINT NOT NULL,
	provider VARCHAR(64) NOT NULL,
	provider_user_id VARCHAR(512) NOT NULL,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	UNIQUE KEY passport_oauth_accounts_identity (provider, provider_user_id),
	UNIQUE KEY passport_oauth_accounts_owner_identity (user_id, provider, provider_user_id),
	CONSTRAINT passport_oauth_accounts_user_fk FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS passport_emails (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	email VARCHAR(320) NOT NULL UNIQUE,
	verified TINYINT NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS passport_user_emails (
	user_id BIGINT NOT NULL,
	email_id BIGINT NOT NULL,
	is_primary TINYINT NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
	created_at BIGINT NOT NULL,
	PRIMARY KEY (user_id, email_id),
	UNIQUE KEY passport_user_emails_email_owner (email_id),
	CONSTRAINT passport_user_emails_user_fk FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT,
	CONSTRAINT passport_user_emails_email_fk FOREIGN KEY (email_id) REFERENCES passport_emails(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS passport_email_otp (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	bot_id BIGINT NOT NULL,
	telegram_user_id BIGINT NOT NULL,
	chat_id BIGINT NOT NULL,
	email VARCHAR(320) NOT NULL,
	code_hash TEXT NOT NULL,
	attempt_count INT NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
	status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired')),
	expires_at BIGINT NOT NULL,
	created_at BIGINT NOT NULL,
	KEY passport_email_otp_lookup (bot_id, telegram_user_id, status, created_at DESC)
);

CREATE TABLE IF NOT EXISTS passport_user_roles (
	user_id BIGINT NOT NULL,
	role VARCHAR(128) NOT NULL,
	created_at BIGINT NOT NULL,
	PRIMARY KEY (user_id, role),
	CONSTRAINT passport_user_roles_user_fk FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS passport_group_prompts (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	chat_id BIGINT NOT NULL,
	actor_id BIGINT NOT NULL,
	state_json LONGTEXT NOT NULL,
	expires_at BIGINT NOT NULL,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	KEY passport_group_prompts_lookup (chat_id, actor_id, updated_at DESC)
);

CREATE TABLE IF NOT EXISTS passport_snowflake_state (
	worker_id INT NOT NULL PRIMARY KEY CHECK (worker_id BETWEEN 0 AND 1023),
	last_timestamp BIGINT NOT NULL CHECK (last_timestamp >= 1288834974657),
	updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS passport_telegram_menus (
	bot_id BIGINT NOT NULL,
	telegram_user_id BIGINT NOT NULL,
	chat_id BIGINT NOT NULL,
	message_id BIGINT NOT NULL,
	mode VARCHAR(16) NOT NULL CHECK (mode IN ('menu', 'email', 'otp')),
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	PRIMARY KEY (bot_id, telegram_user_id)
);

CREATE TABLE IF NOT EXISTS passport_telegram_updates (
	bot_id BIGINT NOT NULL,
	update_id BIGINT NOT NULL,
	status VARCHAR(32) NOT NULL CHECK (status IN ('processing', 'completed', 'failed')),
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	PRIMARY KEY (bot_id, update_id),
	KEY passport_telegram_updates_status (status, updated_at)
);

CREATE TABLE IF NOT EXISTS passport_telegram_identity_choices (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	bot_id BIGINT NOT NULL,
	telegram_user_id BIGINT NOT NULL,
	chat_id BIGINT NOT NULL,
	target_user_id BIGINT NOT NULL,
	email VARCHAR(320) NOT NULL,
	status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
	expires_at BIGINT NOT NULL,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	KEY passport_telegram_identity_choices_lookup (bot_id, telegram_user_id, status, created_at DESC),
	CONSTRAINT passport_identity_choices_user_fk FOREIGN KEY (target_user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS passport_login_challenges (
	id VARCHAR(128) NOT NULL PRIMARY KEY,
	user_id BIGINT NOT NULL,
	bot_id BIGINT NOT NULL,
	telegram_user_id BIGINT NOT NULL,
	chat_id BIGINT NOT NULL,
	expected_number INT NOT NULL CHECK (expected_number BETWEEN 1 AND 99),
	status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'consumed')),
	expires_at BIGINT NOT NULL,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	KEY passport_login_challenges_identity (bot_id, telegram_user_id, status, created_at DESC),
	KEY passport_login_challenges_expires (status, expires_at),
	CONSTRAINT passport_login_challenges_user_fk FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS passport_sso_requests (
	id VARCHAR(128) NOT NULL PRIMARY KEY,
	target_site_key VARCHAR(64) NOT NULL,
	target_hostname VARCHAR(255) NOT NULL,
	status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'consumed', 'expired')),
	expires_at BIGINT NOT NULL,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	KEY passport_sso_requests_expires (status, expires_at)
);

CREATE TABLE IF NOT EXISTS passport_login_tickets (
	token_hash CHAR(64) NOT NULL PRIMARY KEY,
	user_id BIGINT NOT NULL,
	target_site_key VARCHAR(64) NOT NULL,
	target_hostname VARCHAR(255) NOT NULL,
	status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'consumed', 'expired')),
	expires_at BIGINT NOT NULL,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	KEY passport_login_tickets_expires (status, expires_at),
	CONSTRAINT passport_login_tickets_user_fk FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS passport_site_sessions (
	id VARCHAR(128) NOT NULL PRIMARY KEY,
	user_id BIGINT NOT NULL,
	site_key VARCHAR(64) NOT NULL,
	hostname VARCHAR(255) NOT NULL,
	expires_at BIGINT NOT NULL,
	created_at BIGINT NOT NULL,
	KEY passport_site_sessions_user (user_id),
	KEY passport_site_sessions_target (site_key, hostname, expires_at),
	CONSTRAINT passport_site_sessions_user_fk FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS passport_external_identities (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	user_id BIGINT NOT NULL,
	provider VARCHAR(64) NOT NULL,
	subject VARCHAR(512) NOT NULL,
	profile LONGTEXT NOT NULL,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	UNIQUE KEY passport_external_identities_subject (provider, subject),
	KEY passport_external_identities_user (user_id),
	CONSTRAINT passport_external_identities_user_fk FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS passport_oidc_clients (
	id VARCHAR(128) NOT NULL PRIMARY KEY,
	name VARCHAR(255) NOT NULL,
	secret_hash CHAR(64) NOT NULL,
	redirect_uris LONGTEXT NOT NULL,
	backchannel_logout_uri TEXT NOT NULL,
	allowed_scopes TEXT NOT NULL,
	require_pkce TINYINT NOT NULL DEFAULT 1 CHECK (require_pkce IN (0, 1)),
	status VARCHAR(32) NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS passport_oidc_authorization_requests (
	id VARCHAR(128) NOT NULL PRIMARY KEY,
	client_id VARCHAR(128) NOT NULL,
	redirect_uri TEXT NOT NULL,
	scope TEXT NOT NULL,
	state TEXT NOT NULL,
	nonce TEXT NOT NULL,
	code_challenge TEXT NOT NULL,
	code_challenge_method VARCHAR(32) NOT NULL,
	expires_at BIGINT NOT NULL,
	created_at BIGINT NOT NULL,
	CONSTRAINT passport_oidc_requests_client_fk FOREIGN KEY (client_id) REFERENCES passport_oidc_clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS passport_oidc_authorization_codes (
	code_hash CHAR(64) NOT NULL PRIMARY KEY,
	client_id VARCHAR(128) NOT NULL,
	user_id BIGINT NOT NULL,
	redirect_uri TEXT NOT NULL,
	scope TEXT NOT NULL,
	nonce TEXT NOT NULL,
	code_challenge TEXT NOT NULL,
	code_challenge_method VARCHAR(32) NOT NULL,
	expires_at BIGINT NOT NULL,
	consumed_at BIGINT,
	created_at BIGINT NOT NULL,
	session_id VARCHAR(128) NOT NULL DEFAULT '',
	KEY passport_oidc_codes_expiry (expires_at, consumed_at),
	CONSTRAINT passport_oidc_codes_client_fk FOREIGN KEY (client_id) REFERENCES passport_oidc_clients(id) ON DELETE CASCADE,
	CONSTRAINT passport_oidc_codes_user_fk FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS passport_oidc_access_tokens (
	token_hash CHAR(64) NOT NULL PRIMARY KEY,
	client_id VARCHAR(128) NOT NULL,
	user_id BIGINT NOT NULL,
	scope TEXT NOT NULL,
	expires_at BIGINT NOT NULL,
	revoked_at BIGINT,
	created_at BIGINT NOT NULL,
	session_id VARCHAR(128) NOT NULL DEFAULT '',
	authorization_code_hash CHAR(64),
	UNIQUE KEY passport_oidc_access_tokens_code (authorization_code_hash),
	KEY passport_oidc_tokens_expiry (expires_at, revoked_at),
	CONSTRAINT passport_oidc_tokens_client_fk FOREIGN KEY (client_id) REFERENCES passport_oidc_clients(id) ON DELETE CASCADE,
	CONSTRAINT passport_oidc_tokens_user_fk FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS passport_oidc_signing_keys (
	kid VARCHAR(255) NOT NULL PRIMARY KEY,
	private_jwk LONGTEXT NOT NULL,
	public_jwk LONGTEXT NOT NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
	created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS passport_external_providers (
	id VARCHAR(32) NOT NULL PRIMARY KEY CHECK (id IN ('google', 'wechat')),
	display_name VARCHAR(255) NOT NULL,
	client_id VARCHAR(512) NOT NULL,
	client_secret TEXT NOT NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS passport_external_login_states (
	id_hash CHAR(64) NOT NULL PRIMARY KEY,
	provider VARCHAR(32) NOT NULL,
	code_verifier TEXT NOT NULL,
	nonce TEXT NOT NULL,
	redirect_uri TEXT NOT NULL,
	expires_at BIGINT NOT NULL,
	consumed_at BIGINT,
	created_at BIGINT NOT NULL,
	KEY passport_external_login_states_expiry (expires_at, consumed_at),
	CONSTRAINT passport_external_login_states_provider_fk FOREIGN KEY (provider) REFERENCES passport_external_providers(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS passport_external_pending_identities (
	id_hash CHAR(64) NOT NULL PRIMARY KEY,
	provider VARCHAR(32) NOT NULL,
	subject VARCHAR(512) NOT NULL,
	nickname VARCHAR(255) NOT NULL,
	profile LONGTEXT NOT NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired')),
	expires_at BIGINT NOT NULL,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	CONSTRAINT passport_external_pending_provider_fk FOREIGN KEY (provider) REFERENCES passport_external_providers(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS passport_external_email_otps (
	id VARCHAR(128) NOT NULL PRIMARY KEY,
	pending_identity_hash CHAR(64) NOT NULL,
	email VARCHAR(320) NOT NULL,
	code_hash TEXT NOT NULL,
	attempt_count INT NOT NULL DEFAULT 0,
	status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired')),
	expires_at BIGINT NOT NULL,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	KEY passport_external_email_otps_lookup (pending_identity_hash, status, created_at),
	CONSTRAINT passport_external_email_otps_pending_fk FOREIGN KEY (pending_identity_hash) REFERENCES passport_external_pending_identities(id_hash) ON DELETE CASCADE
);
