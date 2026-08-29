DELETE FROM passport_sessions
WHERE device_id IS NOT NULL
	AND device_id NOT IN (SELECT id FROM passport_devices WHERE id = fingerprint);
DELETE FROM passport_devices
WHERE id <> fingerprint;
