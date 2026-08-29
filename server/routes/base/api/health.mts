import type { ApiHandler } from '@server/modules/base/api-router.mjs';

const handler: ApiHandler = (c) => c.json({ ok: true });

export default handler;
