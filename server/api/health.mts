import type { ApiHandler } from '@server/api-router.mjs';

const handler: ApiHandler = (c) => c.json({ ok: true });

export default handler;
