CREATE TABLE IF NOT EXISTS global_sites (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	site_key TEXT NOT NULL UNIQUE,
	name TEXT NOT NULL,
	base_site_key TEXT,
	dsn TEXT NOT NULL DEFAULT '',
	dsn_password TEXT,
	database_binding TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT 'enabled',
	migration_status TEXT NOT NULL DEFAULT 'ready',
	is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
	is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
	CHECK (site_key GLOB '[a-z]*' AND site_key NOT GLOB '*[^a-z0-9_]*')
);

CREATE UNIQUE INDEX IF NOT EXISTS global_sites_one_default
	ON global_sites(is_default) WHERE is_default = 1 AND status = 'enabled';

CREATE TABLE IF NOT EXISTS global_hosts (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	hostname TEXT NOT NULL UNIQUE,
	site_key TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'enabled',
	created_at INTEGER NOT NULL,
	FOREIGN KEY (site_key) REFERENCES global_sites(site_key)
);

INSERT INTO global_sites (
	site_key, name, base_site_key, dsn, status, migration_status, is_default, is_system
) VALUES ('global', '全局控制面', 'base', '', 'enabled', 'ready', 1, 1)
ON CONFLICT(site_key) DO NOTHING;
