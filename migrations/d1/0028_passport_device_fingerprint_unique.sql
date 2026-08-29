CREATE UNIQUE INDEX IF NOT EXISTS passport_devices_fingerprint_unique
	ON passport_devices(fingerprint);
