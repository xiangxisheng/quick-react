DELETE s FROM passport_sessions s
LEFT JOIN passport_devices d ON d.id = s.device_id AND d.id = d.fingerprint
WHERE s.device_id IS NOT NULL AND d.id IS NULL;
DELETE FROM passport_devices WHERE id <> fingerprint;
