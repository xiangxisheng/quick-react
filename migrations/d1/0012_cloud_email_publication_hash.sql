ALTER TABLE global_cloud_email_template_publications
	ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';

UPDATE global_cloud_email_template_publications
SET content_hash = 'legacy:' || (
	SELECT json_array(t.template_key, t.name, t.subject, t.body_html)
	FROM global_cloud_email_templates t
	WHERE t.id = global_cloud_email_template_publications.template_id
)
WHERE updated_at >= (
	SELECT t.updated_at
	FROM global_cloud_email_templates t
	WHERE t.id = global_cloud_email_template_publications.template_id
);
