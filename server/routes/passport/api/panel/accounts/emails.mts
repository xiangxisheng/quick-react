import type { ApiHandler } from '@server/modules/base/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/modules/base/api-response.mjs';
import { listAccountEmails, pendingAccountEmailOtp, setPrimaryAccountEmail, unbindAccountEmail } from '@server/modules/passport/account.mjs';
import { bindReturnCookie } from '@server/modules/passport/accounts/external.mjs';
import { isSecureRequest } from '@server/modules/base/request-origin.mjs';

const primaryOptions = [
	{ value: '1', text: '主邮箱', color: 'green' },
	{ value: '0', text: '普通邮箱', color: 'default' },
];
const verifiedOptions = [
	{ value: '1', text: '已验证', color: 'green' },
	{ value: '0', text: '待验证', color: 'orange' },
];

/** 待验证邮箱在列表里只是提示行，用固定 key 区分。 */
const PENDING_ROW_KEY = 'pending';

const columns = [
	{ dataIndex: 'email', title: '邮箱' },
	{ dataIndex: 'is_primary', title: '主邮箱', component: 'select' as const, options: primaryOptions, form: { create: false as const, edit: false as const } },
	{ dataIndex: 'verified', title: '状态', component: 'select' as const, options: verifiedOptions, form: { create: false as const, edit: false as const } },
	{ dataIndex: 'created_at', title: '绑定时间', dataType: 'js_timestamp' as const, dayjsFormat: 'YYYY-MM-DD HH:mm:ss' },
];

const handler: ApiHandler = async (c, _next, params) => {
	const database = c.get('passportDatabase')!;
	const userId = String(c.get('passportUser')!.id);
	const action = c.req.query('action')?.trim();

	if (c.req.method === 'GET' && !params.id) {
		const [emails, pending] = await Promise.all([listAccountEmails(database, userId), pendingAccountEmailOtp(database, userId)]);
		const dataSource = [
			...emails.map((item) => ({ email_id: item.email_id, email: item.email, is_primary: String(item.is_primary), verified: String(item.verified), created_at: item.created_at })),
			...(pending ? [{ email_id: PENDING_ROW_KEY, email: pending.email, is_primary: '0', verified: '0', created_at: pending.created_at }] : []),
		];
		return apiResponse(c, 200, {
			table: {
				option: {
					rowKey: 'email_id',
					actions: { toolbar: [{ key: 'bind-email', label: '绑定邮箱', modalPath: '/panel/accounts/bind-email' }],
						row: [
							{ key: 'primary', label: '设为主邮箱' },
							{ key: 'delete', label: '解绑', confirm: '解绑后该邮箱将不能用于登录，确认解绑？' },
						],
					},
				},
				columns,
				dataSource,
				totalRecords: dataSource.length,
			},
		});
	}

	if ((c.req.method === 'POST' || c.req.method === 'PUT') && !params.id && action === 'bind-email') {
		c.header('Set-Cookie', bindReturnCookie(`/panel/accounts/emails${c.get('techStackConfig').pageSuffix}`, isSecureRequest(c)));
		return apiResponse(c, 200, { redirectTo: `/panel/accounts/bind-email${c.get('techStackConfig').pageSuffix}`, openWindow: true });
	}

	// 待验证邮箱只是列表里的提示行，不能设主邮箱也不能解绑。
	if (params.id === PENDING_ROW_KEY) return apiMessage(c, 409, '该邮箱正在验证中，请前往「绑定邮箱」页面输入验证码完成绑定');

	if (c.req.method === 'POST' && params.id && action === 'primary') {
		try { return apiMessage(c, 200, `${await setPrimaryAccountEmail(database, userId, params.id)} 已设为主邮箱`); }
		catch (error) { return apiMessage(c, 409, error instanceof Error ? error.message : '设置主邮箱失败'); }
	}

	if (c.req.method === 'DELETE' && !params.id) {
		const ids = await c.req.json<unknown>().catch(() => []);
		const targets = Array.isArray(ids) ? ids.map((value) => String(value)) : [];
		if (!targets.length) return apiMessage(c, 400, '请选择要解绑的邮箱');
		if (targets.includes(PENDING_ROW_KEY)) return apiMessage(c, 409, '该邮箱正在验证中，请前往「绑定邮箱」页面输入验证码完成绑定');
		const removed: string[] = [];
		for (const target of targets) {
			try { removed.push(await unbindAccountEmail(database, userId, target)); }
			catch (error) { return apiMessage(c, 409, error instanceof Error ? error.message : '解绑失败'); }
		}
		return apiMessage(c, 200, `${removed.join('、')} 已解绑`);
	}

	return apiMessage(c, 405, '不支持的请求方法');
};

export const acceptsTrailingParams = true;
export default handler;
