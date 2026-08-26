CREATE TABLE IF NOT EXISTS global_sites (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	site_key VARCHAR(64) NOT NULL UNIQUE,
	name VARCHAR(255) NOT NULL,
	base_site_key VARCHAR(64),
	dsn TEXT NOT NULL,
	dsn_password TEXT,
	database_binding VARCHAR(64) NOT NULL DEFAULT '',
	status VARCHAR(32) NOT NULL DEFAULT 'enabled',
	migration_status VARCHAR(32) NOT NULL DEFAULT 'ready',
	is_default TINYINT NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
	is_system TINYINT NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
	passport_sso_enabled TINYINT NOT NULL DEFAULT 0 CHECK (passport_sso_enabled IN (0, 1)),
	active_default TINYINT GENERATED ALWAYS AS (CASE WHEN is_default = 1 AND status = 'enabled' THEN 1 ELSE NULL END) STORED,
	CONSTRAINT global_sites_key_check CHECK (site_key REGEXP '^[a-z][a-z0-9_]*$'),
	UNIQUE KEY global_sites_one_default (active_default)
);

CREATE TABLE IF NOT EXISTS global_site_hosts (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	hostname VARCHAR(255) NOT NULL UNIQUE,
	site_key VARCHAR(64) NOT NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'enabled',
	created_at BIGINT NOT NULL,
	CONSTRAINT global_site_hosts_site_fk FOREIGN KEY (site_key) REFERENCES global_sites(site_key)
);

INSERT IGNORE INTO global_sites (site_key, name, base_site_key, dsn, status, migration_status, is_default, is_system)
	VALUES ('global', '全局控制面', 'base', '', 'enabled', 'ready', 1, 1);

CREATE TABLE IF NOT EXISTS global_cloud_credentials (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	name VARCHAR(255) NOT NULL UNIQUE,
	provider VARCHAR(64) NOT NULL,
	account_id VARCHAR(255) NOT NULL DEFAULT '',
	access_key_id VARCHAR(512) NOT NULL DEFAULT '',
	access_key_secret TEXT NOT NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'enabled',
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS global_cloud_object_storage_buckets (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	cloud_credential_id BIGINT NOT NULL,
	endpoint VARCHAR(384) NOT NULL,
	region VARCHAR(255) NOT NULL DEFAULT '',
	bucket VARCHAR(255) NOT NULL,
	path_style TINYINT NOT NULL DEFAULT 0 CHECK (path_style IN (0, 1)),
	public_base_url VARCHAR(2048) NOT NULL DEFAULT '',
	extra_config LONGTEXT NOT NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'enabled',
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	UNIQUE KEY global_cloud_storage_bucket_unique (cloud_credential_id, endpoint, bucket),
	CONSTRAINT global_cloud_storage_bucket_credential_fk FOREIGN KEY (cloud_credential_id) REFERENCES global_cloud_credentials(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS global_cloud_object_storage_bindings (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	site_key VARCHAR(64) NOT NULL,
	bucket_id BIGINT NOT NULL,
	key_prefix VARCHAR(512) NOT NULL DEFAULT '',
	status VARCHAR(32) NOT NULL DEFAULT 'enabled',
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	UNIQUE KEY global_cloud_storage_binding_site (id, site_key),
	UNIQUE KEY global_cloud_storage_binding_unique (site_key, bucket_id, key_prefix),
	CONSTRAINT global_cloud_storage_binding_site_fk FOREIGN KEY (site_key) REFERENCES global_sites(site_key) ON DELETE CASCADE,
	CONSTRAINT global_cloud_storage_binding_bucket_fk FOREIGN KEY (bucket_id) REFERENCES global_cloud_object_storage_buckets(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS global_cloud_object_storage_binding_purposes (
	binding_id BIGINT NOT NULL,
	site_key VARCHAR(64) NOT NULL,
	purpose VARCHAR(64) NOT NULL,
	is_default TINYINT NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
	default_site_key VARCHAR(64) GENERATED ALWAYS AS (CASE WHEN is_default = 1 THEN site_key ELSE NULL END) STORED,
	default_purpose VARCHAR(64) GENERATED ALWAYS AS (CASE WHEN is_default = 1 THEN purpose ELSE NULL END) STORED,
	PRIMARY KEY (binding_id, purpose),
	UNIQUE KEY global_cloud_storage_purpose_one_default (default_site_key, default_purpose),
	CONSTRAINT global_cloud_storage_purpose_binding_fk FOREIGN KEY (binding_id, site_key) REFERENCES global_cloud_object_storage_bindings(id, site_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS global_telegram_bots (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	name VARCHAR(255) NOT NULL UNIQUE,
	bot_token VARCHAR(255) NOT NULL UNIQUE,
	bot_username VARCHAR(255) NOT NULL UNIQUE,
	secret_token VARCHAR(256) NOT NULL,
	webhook_hostname VARCHAR(255) NOT NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	CONSTRAINT global_telegram_bot_name_check CHECK (CHAR_LENGTH(TRIM(name)) > 0),
	CONSTRAINT global_telegram_bot_token_check CHECK (CHAR_LENGTH(TRIM(bot_token)) > 0),
	CONSTRAINT global_telegram_bot_username_check CHECK (CHAR_LENGTH(TRIM(bot_username)) > 0),
	CONSTRAINT global_telegram_bot_secret_check CHECK (CHAR_LENGTH(TRIM(secret_token)) BETWEEN 1 AND 256),
	CONSTRAINT global_telegram_bot_host_fk FOREIGN KEY (webhook_hostname) REFERENCES global_site_hosts(hostname) ON DELETE RESTRICT ON UPDATE RESTRICT,
	KEY global_telegram_bots_webhook_hostname (webhook_hostname)
);

CREATE TABLE IF NOT EXISTS global_cloud_email_channels (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	cloud_credential_id BIGINT NOT NULL,
	region VARCHAR(255) NOT NULL,
	account_name VARCHAR(320) NOT NULL,
	from_alias VARCHAR(255) NOT NULL,
	reply_to_address TINYINT NOT NULL DEFAULT 0 CHECK (reply_to_address IN (0, 1)),
	status VARCHAR(32) NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	UNIQUE KEY global_cloud_email_channel_unique (cloud_credential_id, region, account_name),
	CONSTRAINT global_cloud_email_channel_credential_fk FOREIGN KEY (cloud_credential_id) REFERENCES global_cloud_credentials(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS global_cloud_email_templates (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	template_key VARCHAR(128) NOT NULL UNIQUE,
	template_type VARCHAR(64) NOT NULL DEFAULT 'email_verification',
	name VARCHAR(255) NOT NULL,
	subject TEXT NOT NULL,
	body_text LONGTEXT NOT NULL,
	body_html LONGTEXT NOT NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	CONSTRAINT global_cloud_email_template_key_check CHECK (template_key REGEXP '^[a-z][a-z0-9_]*$'),
	CONSTRAINT global_cloud_email_template_type_check CHECK (template_type IN ('email_verification'))
);

CREATE TABLE IF NOT EXISTS global_cloud_email_bindings (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	site_key VARCHAR(64) NOT NULL,
	channel_id BIGINT NOT NULL,
	template_id BIGINT NOT NULL,
	purpose VARCHAR(64) NOT NULL,
	is_default TINYINT NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
	status VARCHAR(32) NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	default_site_key VARCHAR(64) GENERATED ALWAYS AS (CASE WHEN is_default = 1 AND status = 'enabled' THEN site_key ELSE NULL END) STORED,
	default_purpose VARCHAR(64) GENERATED ALWAYS AS (CASE WHEN is_default = 1 AND status = 'enabled' THEN purpose ELSE NULL END) STORED,
	UNIQUE KEY global_cloud_email_binding_unique (site_key, channel_id, template_id, purpose),
	UNIQUE KEY global_cloud_email_binding_one_default (default_site_key, default_purpose),
	CONSTRAINT global_cloud_email_binding_site_fk FOREIGN KEY (site_key) REFERENCES global_sites(site_key) ON DELETE RESTRICT,
	CONSTRAINT global_cloud_email_binding_channel_fk FOREIGN KEY (channel_id) REFERENCES global_cloud_email_channels(id) ON DELETE RESTRICT,
	CONSTRAINT global_cloud_email_binding_template_fk FOREIGN KEY (template_id) REFERENCES global_cloud_email_templates(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS global_cloud_email_template_publications (
	template_id BIGINT NOT NULL,
	cloud_credential_id BIGINT NOT NULL,
	region VARCHAR(255) NOT NULL,
	provider_template_id VARCHAR(255) NOT NULL,
	content_hash TEXT NOT NULL,
	status VARCHAR(32) NOT NULL CHECK (status IN ('reviewing', 'ready', 'rejected', 'disabled')),
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	PRIMARY KEY (template_id, cloud_credential_id, region),
	CONSTRAINT global_cloud_email_publication_template_fk FOREIGN KEY (template_id) REFERENCES global_cloud_email_templates(id) ON DELETE RESTRICT,
	CONSTRAINT global_cloud_email_publication_credential_fk FOREIGN KEY (cloud_credential_id) REFERENCES global_cloud_credentials(id) ON DELETE RESTRICT
);
