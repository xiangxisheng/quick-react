ALTER TABLE passport_external_providers ADD COLUMN IF NOT EXISTS wechat_redirect_domain VARCHAR(255) NOT NULL DEFAULT '';
