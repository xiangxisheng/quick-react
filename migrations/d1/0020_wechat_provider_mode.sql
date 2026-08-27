ALTER TABLE passport_external_providers ADD COLUMN wechat_mode TEXT NOT NULL DEFAULT 'open_platform' CHECK (wechat_mode IN ('open_platform', 'official_account'));
