ALTER TABLE passport_oidc_clients ADD COLUMN backchannel_logout_uri TEXT NOT NULL DEFAULT '';
ALTER TABLE passport_oidc_authorization_codes ADD COLUMN session_id TEXT NOT NULL DEFAULT '';
ALTER TABLE passport_oidc_access_tokens ADD COLUMN session_id TEXT NOT NULL DEFAULT '';
