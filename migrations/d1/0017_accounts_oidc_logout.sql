ALTER TABLE passport_oidc_clients ADD COLUMN backchannel_logout_uri TEXT NOT NULL DEFAULT '';
ALTER TABLE passport_oidc_authorization_codes ADD COLUMN session_id TEXT NOT NULL DEFAULT '';
ALTER TABLE passport_oidc_access_tokens ADD COLUMN session_id TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS base_oidc_sessions (
	issuer TEXT NOT NULL,
	sid TEXT NOT NULL,
	session_id TEXT NOT NULL UNIQUE,
	created_at INTEGER NOT NULL,
	PRIMARY KEY (issuer, sid),
	FOREIGN KEY (session_id) REFERENCES base_system_sessions(id) ON DELETE CASCADE
);
