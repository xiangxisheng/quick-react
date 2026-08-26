ALTER TABLE global_sites ADD COLUMN passport_sso_enabled INTEGER NOT NULL DEFAULT 0 CHECK (passport_sso_enabled IN (0, 1));
