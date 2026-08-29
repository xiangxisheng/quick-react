DELETE FROM passport_sessions s
WHERE s.device_id IS NOT NULL
	AND NOT EXISTS (SELECT 1 FROM passport_devices d WHERE d.id = s.device_id AND d.id = d.fingerprint);
DELETE FROM passport_devices WHERE id <> fingerprint;
