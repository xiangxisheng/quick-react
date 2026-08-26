CREATE TABLE IF NOT EXISTS base_oidc_login_requests (
	id TEXT PRIMARY KEY NOT NULL,
	issuer TEXT NOT NULL,
	state TEXT NOT NULL UNIQUE,
	nonce TEXT NOT NULL,
	code_verifier TEXT NOT NULL,
	return_path TEXT NOT NULL DEFAULT '/',
	expires_at INTEGER NOT NULL,
	created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS base_oidc_accounts (
	issuer TEXT NOT NULL,
	subject TEXT NOT NULL,
	user_id INTEGER NOT NULL,
	profile TEXT NOT NULL DEFAULT '{}',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (issuer, subject),
	FOREIGN KEY (user_id) REFERENCES base_system_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS base_oidc_accounts_user ON base_oidc_accounts(user_id);
