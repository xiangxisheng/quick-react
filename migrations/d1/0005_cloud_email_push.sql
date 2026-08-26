CREATE TABLE IF NOT EXISTS global_cloud_email_channels (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	cloud_credential_id INTEGER NOT NULL,
	region TEXT NOT NULL CHECK (length(trim(region)) > 0),
	account_name TEXT NOT NULL CHECK (length(trim(account_name)) > 0),
	from_alias TEXT NOT NULL CHECK (length(trim(from_alias)) > 0),
	reply_to_address INTEGER NOT NULL DEFAULT 0 CHECK (reply_to_address IN (0, 1)),
	status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	UNIQUE (cloud_credential_id, region, account_name),
	FOREIGN KEY (cloud_credential_id) REFERENCES global_cloud_credentials(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS global_cloud_email_templates (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	template_key TEXT NOT NULL UNIQUE CHECK (template_key GLOB '[a-z]*' AND template_key NOT GLOB '*[^a-z0-9_]*'),
	name TEXT NOT NULL CHECK (length(trim(name)) > 0),
	subject TEXT NOT NULL CHECK (length(trim(subject)) > 0),
	body_text TEXT NOT NULL CHECK (length(trim(body_text)) > 0),
	body_html TEXT NOT NULL CHECK (length(trim(body_html)) > 0),
	status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS global_cloud_email_bindings (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	site_key TEXT NOT NULL,
	channel_id INTEGER NOT NULL,
	template_id INTEGER NOT NULL,
	purpose TEXT NOT NULL CHECK (length(trim(purpose)) > 0),
	is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
	status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled')),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	UNIQUE (site_key, channel_id, template_id, purpose),
	FOREIGN KEY (site_key) REFERENCES global_sites(site_key) ON DELETE RESTRICT,
	FOREIGN KEY (channel_id) REFERENCES global_cloud_email_channels(id) ON DELETE RESTRICT,
	FOREIGN KEY (template_id) REFERENCES global_cloud_email_templates(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS global_cloud_email_bindings_one_default
	ON global_cloud_email_bindings(site_key, purpose)
	WHERE is_default = 1 AND status = 'enabled';

CREATE TABLE IF NOT EXISTS global_cloud_email_template_publications (
	template_id INTEGER NOT NULL,
	channel_id INTEGER NOT NULL,
	provider_template_id TEXT NOT NULL CHECK (length(trim(provider_template_id)) > 0),
	status TEXT NOT NULL CHECK (status IN ('reviewing', 'ready', 'rejected', 'disabled')),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (template_id, channel_id),
	FOREIGN KEY (template_id) REFERENCES global_cloud_email_templates(id) ON DELETE RESTRICT,
	FOREIGN KEY (channel_id) REFERENCES global_cloud_email_channels(id) ON DELETE RESTRICT
);
