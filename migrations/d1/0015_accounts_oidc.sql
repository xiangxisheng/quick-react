CREATE TABLE IF NOT EXISTS passport_external_identities (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	user_id INTEGER NOT NULL,
	provider TEXT NOT NULL CHECK (length(trim(provider)) > 0),
	subject TEXT NOT NULL CHECK (length(trim(subject)) > 0),
	profile TEXT NOT NULL DEFAULT '{}',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	UNIQUE(provider, subject),
	FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS passport_external_identities_user ON passport_external_identities(user_id);

CREATE TABLE IF NOT EXISTS passport_oidc_clients (
	id TEXT PRIMARY KEY NOT NULL,
	name TEXT NOT NULL CHECK (length(trim(name)) > 0),
	secret_hash TEXT NOT NULL CHECK (length(secret_hash) = 64),
	redirect_uris TEXT NOT NULL DEFAULT '[]',
	allowed_scopes TEXT NOT NULL DEFAULT 'openid profile email',
	require_pkce INTEGER NOT NULL DEFAULT 1 CHECK (require_pkce IN (0, 1)),
	status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS passport_oidc_authorization_requests (
	id TEXT PRIMARY KEY NOT NULL,
	client_id TEXT NOT NULL,
	redirect_uri TEXT NOT NULL,
	scope TEXT NOT NULL,
	state TEXT NOT NULL DEFAULT '',
	nonce TEXT NOT NULL DEFAULT '',
	code_challenge TEXT NOT NULL DEFAULT '',
	code_challenge_method TEXT NOT NULL DEFAULT '',
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (client_id) REFERENCES passport_oidc_clients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS passport_oidc_authorization_codes (
	code_hash TEXT PRIMARY KEY NOT NULL CHECK (length(code_hash) = 64),
	client_id TEXT NOT NULL,
	user_id INTEGER NOT NULL,
	redirect_uri TEXT NOT NULL,
	scope TEXT NOT NULL,
	nonce TEXT NOT NULL DEFAULT '',
	code_challenge TEXT NOT NULL DEFAULT '',
	code_challenge_method TEXT NOT NULL DEFAULT '',
	expires_at INTEGER NOT NULL,
	consumed_at INTEGER,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (client_id) REFERENCES passport_oidc_clients(id) ON DELETE CASCADE,
	FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS passport_oidc_access_tokens (
	token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64),
	client_id TEXT NOT NULL,
	user_id INTEGER NOT NULL,
	scope TEXT NOT NULL,
	expires_at INTEGER NOT NULL,
	revoked_at INTEGER,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (client_id) REFERENCES passport_oidc_clients(id) ON DELETE CASCADE,
	FOREIGN KEY (user_id) REFERENCES passport_users(user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS passport_oidc_signing_keys (
	kid TEXT PRIMARY KEY NOT NULL,
	private_jwk TEXT NOT NULL,
	public_jwk TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
	created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS passport_oidc_codes_expiry ON passport_oidc_authorization_codes(expires_at, consumed_at);
CREATE INDEX IF NOT EXISTS passport_oidc_tokens_expiry ON passport_oidc_access_tokens(expires_at, revoked_at);
