ALTER TABLE passport_devices
	ADD UNIQUE KEY passport_devices_fingerprint_unique (fingerprint);
