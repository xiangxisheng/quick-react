CREATE TABLE IF NOT EXISTS passport_external_providers (
	id TEXT PRIMARY KEY NOT NULL CHECK (id IN ('google', 'wechat')),
	display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
	client_id TEXT NOT NULL CHECK (length(trim(client_id)) > 0),
	client_secret TEXT NOT NULL CHECK (length(trim(client_secret)) > 0),
	status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS passport_external_login_states (
	id_hash TEXT PRIMARY KEY NOT NULL CHECK (length(id_hash) = 64),
	provider TEXT NOT NULL,
	code_verifier TEXT NOT NULL,
	nonce TEXT NOT NULL,
	redirect_uri TEXT NOT NULL,
	expires_at INTEGER NOT NULL,
	consumed_at INTEGER,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (provider) REFERENCES passport_external_providers(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS passport_external_login_states_expiry
	ON passport_external_login_states(expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS passport_external_pending_identities (
	id_hash TEXT PRIMARY KEY NOT NULL CHECK (length(id_hash) = 64),
	provider TEXT NOT NULL,
	subject TEXT NOT NULL CHECK (length(trim(subject)) > 0),
	nickname TEXT NOT NULL CHECK (length(trim(nickname)) > 0),
	profile TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired')),
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (provider) REFERENCES passport_external_providers(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS passport_external_email_otps (
	id TEXT PRIMARY KEY NOT NULL,
	pending_identity_hash TEXT NOT NULL,
	email TEXT NOT NULL CHECK (length(trim(email)) > 0),
	code_hash TEXT NOT NULL CHECK (length(trim(code_hash)) > 0),
	attempt_count INTEGER NOT NULL DEFAULT 0,
	status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired')),
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	FOREIGN KEY (pending_identity_hash) REFERENCES passport_external_pending_identities(id_hash) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS passport_external_email_otps_lookup
	ON passport_external_email_otps(pending_identity_hash, status, created_at);
