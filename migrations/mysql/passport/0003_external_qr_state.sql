ALTER TABLE passport_external_login_states ADD COLUMN qr_status VARCHAR(32) NOT NULL DEFAULT 'pending';
ALTER TABLE passport_external_login_states ADD COLUMN qr_user_id VARCHAR(128) NULL;
