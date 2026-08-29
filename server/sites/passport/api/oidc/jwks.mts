import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiMessage, apiResponse } from '@server/modules/base/api-response.mjs';
import { ensureSigningKey } from '@server/accounts/oidc.mjs';
import { signingPublicKeys } from '@server/accounts/repository.mjs';

const handler: ApiHandler = async (c) => {
	if (c.req.method !== 'GET') return apiMessage(c, 404);
	const database = c.get('passportDatabase'); if (!database) return apiMessage(c, 503);
	await ensureSigningKey(database);
	const rows = await signingPublicKeys(database);
	return apiResponse(c, 200, { keys: rows.map((row) => JSON.parse(row.public_jwk)) });
};
export default handler;
