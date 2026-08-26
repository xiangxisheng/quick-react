import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiResponse } from '@server/api-response.mjs';
import { ensureSigningKey } from '@server/accounts/oidc.mjs';

const handler: ApiHandler = async (c) => {
	if (c.get('site').siteKey !== 'passport' || c.req.method !== 'GET') return apiMessage(c, 404);
	const database = c.get('passportDatabase'); if (!database) return apiMessage(c, 503);
	await ensureSigningKey(database);
	const rows = await database.prepare(`SELECT public_jwk FROM passport_oidc_signing_keys WHERE status IN ('active', 'retired') ORDER BY created_at DESC`).all<{ public_jwk: string }>();
	return apiResponse(c, 200, { keys: rows.results.map((row) => JSON.parse(row.public_jwk)) });
};
export default handler;
