let fingerprintPromise: Promise<string> | undefined;

const computeFingerprint = async () => {
	const canvas = document.createElement('canvas');
	canvas.width = 220; canvas.height = 30;
	const context = canvas.getContext('2d');
	if (!context) return '';
	context.textBaseline = 'top';
	context.font = '14px Arial';
	context.fillStyle = '#f60';
	context.fillRect(0, 0, 220, 30);
	context.fillStyle = '#069';
	context.fillText('fingerprint-check', 2, 2);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canvas.toDataURL()));
	const fingerprint = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
	document.cookie = `passport_device_fingerprint=${fingerprint}; Path=/; SameSite=Lax`;
	return fingerprint;
};

export const getDeviceFingerprint = () => {
	if (!fingerprintPromise) fingerprintPromise = computeFingerprint().catch(() => '');
	return fingerprintPromise;
};
