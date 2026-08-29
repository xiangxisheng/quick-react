ALTER TABLE passport_oidc_clients ADD COLUMN strict_redirect_uri INTEGER NOT NULL DEFAULT 0 CHECK (strict_redirect_uri IN (0, 1));
