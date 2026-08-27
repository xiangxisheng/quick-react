ALTER TABLE passport_external_providers ADD COLUMN IF NOT EXISTS wechat_mode VARCHAR(32) NOT NULL DEFAULT 'open_platform';
ALTER TABLE passport_external_providers ADD CONSTRAINT passport_external_providers_wechat_mode_check CHECK (wechat_mode IN ('open_platform', 'official_account'));
