ALTER TABLE passport_external_login_states ADD COLUMN qr_status TEXT NOT NULL DEFAULT 'pending' CHECK (qr_status IN ('pending', 'authorized', 'consumed', 'expired'));
ALTER TABLE passport_external_login_states ADD COLUMN qr_user_id TEXT;
