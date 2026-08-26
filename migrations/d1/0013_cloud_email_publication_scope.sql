ALTER TABLE global_cloud_email_template_publications RENAME TO global_cloud_email_template_publications_by_channel;

CREATE TABLE global_cloud_email_template_publications (
	template_id INTEGER NOT NULL,
	cloud_credential_id INTEGER NOT NULL,
	region TEXT NOT NULL CHECK (length(trim(region)) > 0),
	provider_template_id TEXT NOT NULL CHECK (length(trim(provider_template_id)) > 0),
	content_hash TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL CHECK (status IN ('reviewing', 'ready', 'rejected', 'disabled')),
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	PRIMARY KEY (template_id, cloud_credential_id, region),
	FOREIGN KEY (template_id) REFERENCES global_cloud_email_templates(id) ON DELETE RESTRICT,
	FOREIGN KEY (cloud_credential_id) REFERENCES global_cloud_credentials(id) ON DELETE RESTRICT
);

INSERT INTO global_cloud_email_template_publications
	(template_id, cloud_credential_id, region, provider_template_id, content_hash, status, created_at, updated_at)
SELECT p.template_id, ch.cloud_credential_id, ch.region, p.provider_template_id, p.content_hash, p.status, p.created_at, p.updated_at
FROM global_cloud_email_template_publications_by_channel p
JOIN global_cloud_email_channels ch ON ch.id = p.channel_id
WHERE p.channel_id = (
	SELECT MIN(p2.channel_id)
	FROM global_cloud_email_template_publications_by_channel p2
	JOIN global_cloud_email_channels ch2 ON ch2.id = p2.channel_id
	WHERE p2.template_id = p.template_id
		AND ch2.cloud_credential_id = ch.cloud_credential_id
		AND ch2.region = ch.region
);

DROP TABLE global_cloud_email_template_publications_by_channel;
