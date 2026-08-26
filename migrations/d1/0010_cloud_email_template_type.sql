ALTER TABLE global_cloud_email_templates
	ADD COLUMN template_type TEXT NOT NULL DEFAULT 'email_verification'
	CHECK (template_type IN ('email_verification'));
