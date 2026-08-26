import type { DatabaseAdapter } from '@server/database/index.mjs';

const encoder = new TextEncoder();
export const passportSsoRequestCookieName = 'passport_sso_request';

const bytesToBase64Url = (bytes: Uint8Array) => {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
};
const hashToken = async (token: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)))]
	.map((value) => value.toString(16).padStart(2, '0')).join('');
export const readNamedCookie = (request: Request, name: string) => {
	for (const part of (request.headers.get('cookie') ?? '').split(';')) {
		const [candidate, ...value] = part.trim().split('=');
		if (candidate === name) return decodeURIComponent(value.join('='));
	}
};
export const createSsoRequestCookie = (id: string, secure: boolean) =>
	`${passportSsoRequestCookieName}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}`;
export const clearSsoRequestCookie = (secure: boolean) =>
	`${passportSsoRequestCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

export const createPassportSsoRequest = async (database: DatabaseAdapter, siteKey: string, hostname: string) => {
	const id = crypto.randomUUID(), now = Date.now();
	await database.prepare(`INSERT INTO passport_sso_requests
		(id, target_site_key, target_hostname, status, expires_at, created_at, updated_at)
		VALUES (?1, ?2, ?3, 'pending', ?4, ?5, ?5)`).bind(id, siteKey, hostname, now + 10 * 60_000, now).run();
	return id;
};

export const issuePassportLoginTicket = async (database: DatabaseAdapter, requestId: string, userId: string) => {
	const request = await database.prepare(`SELECT target_site_key, target_hostname, status, expires_at FROM passport_sso_requests WHERE id = ?1`)
		.bind(requestId).first<{ target_site_key: string; target_hostname: string; status: string; expires_at: number }>();
	if (!request || request.status !== 'pending' || request.expires_at <= Date.now()) return undefined;
	const token = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32))), tokenHash = await hashToken(token), now = Date.now();
	if (!database.batch) throw new Error('Passport database does not support atomic SSO tickets');
	await database.batch([
		{ query: `INSERT INTO passport_login_tickets
			(token_hash, user_id, target_site_key, target_hostname, status, expires_at, created_at, updated_at)
			SELECT ?1, ?2, target_site_key, target_hostname, 'pending', ?4, ?5, ?5 FROM passport_sso_requests WHERE id = ?3 AND status = 'pending'`,
		values: [tokenHash, userId, requestId, now + 60_000, now] },
		{ query: `UPDATE passport_sso_requests SET status = 'consumed', updated_at = ?2 WHERE id = ?1 AND status = 'pending'`, values: [requestId, now] },
	]);
	const created = await database.prepare(`SELECT token_hash FROM passport_login_tickets WHERE token_hash = ?1`).bind(tokenHash).first();
	if (!created) return undefined;
	return { token, targetSiteKey: request.target_site_key, targetHostname: request.target_hostname,
		redirectUrl: `https://${request.target_hostname}/api/passport/sso/callback?ticket=${encodeURIComponent(token)}` };
};

export const passportTicketHash = hashToken;
