import type { ApiHandler } from '@server/api-router.mjs';
import { apiMessage, apiMessageData, apiResponse } from '@server/api-response.mjs';
import { AccountEmailRateLimitError, discardAccountEmailOtp, issueAccountEmailOtp, listAccountEmails, pendingAccountEmailOtp, setPrimaryAccountEmail, unbindAccountEmail, verifyAccountEmailOtp } from '@server/passport/account.mjs';
import { sendDefaultCloudEmail } from '@server/cloud/email.mjs';

const primaryOptions = [
	{ value: '1', text: '主邮箱', color: 'green' },
	{ value: '0', text: '普通邮箱', color: 'default' },
];
const verifiedOptions = [
	{ value: '1', text: '已验证', color: 'green' },
	{ value: '0', text: '待验证', color: 'orange' },
];

const columns = [
	{ dataIndex: 'email', title: '邮箱', component: 'textbox' as const, form: { create: { title: '邮箱', placeholder: '验证码会发送到该邮箱', rules: [{ required: true, message: '请输入邮箱' }] }, edit: false as const } },
	{ dataIndex: 'is_primary', title: '主邮箱', component: 'select' as const, options: primaryOptions, form: { create: false as const, edit: false as const } },
	{ dataIndex: 'verified', title: '状态', component: 'select' as const, options: verifiedOptions, form: { create: false as const, edit: false as const } },
	{ dataIndex: 'created_at', title: '绑定时间', dataType: 'js_timestamp' as const, dayjsFormat: 'YYYY-MM-DD HH:mm:ss' },
];

const codeColumns = [
	{ dataIndex: 'code', title: '6 位验证码', component: 'textbox' as const, placeholder: '请输入邮件里的验证码', rules: [{ required: true, message: '请输入验证码' }] },
];

const handler: ApiHandler = async (c, next, params) => {
	const database = c.get('passportDatabase')!, globalDatabase = c.get('globalDatabase');
	const userId = String(c.get('passportUser')!.id);
	const action = c.req.query('action')?.trim();
	const body = async () => c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));

	if (c.req.method === 'GET' && !params.id) {
		const [emails, pending] = await Promise.all([listAccountEmails(database, userId), pendingAccountEmailOtp(database, userId)]);
		const dataSource = [
			...emails.map((item) => ({ email_id: item.email_id, email: item.email, is_primary: String(item.is_primary), verified: String(item.verified), created_at: item.created_at })),
			...(pending ? [{ email_id: 'pending', email: pending.email, is_primary: '0', verified: '0', created_at: pending.created_at }] : []),
		];
		return apiResponse(c, 200, {
			table: {
				option: {
					rowKey: 'email_id',
					actions: {
						toolbar: [
							{ key: 'create', label: '添加邮箱' },
							{ key: 'verify', label: '输入验证码', form: { columns: codeColumns } },
						],
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

	if (c.req.method === 'POST' && !params.id && action === 'verify') {
		const verified = await verifyAccountEmailOtp(database, c.env.SNOWFLAKE_WORKER_ID, userId, String((await body()).code ?? ''));
		if (verified.status === 'bound') return apiMessage(c, 200, `${verified.email} 已绑定`);
		if (verified.status === 'conflict') return apiMessage(c, 409, verified.message);
		if (verified.status === 'none') return apiMessage(c, 409, '没有待验证的邮箱，请先添加邮箱');
		if (verified.status === 'expired') return apiMessage(c, 409, '验证码已过期，请重新添加邮箱');
		if (verified.status === 'locked') return apiMessage(c, 409, '验证码错误次数过多，请重新添加邮箱');
		return apiMessage(c, 409, '验证码不正确');
	}

	if (c.req.method === 'POST' && !params.id && !action) {
		let issued: Awaited<ReturnType<typeof issueAccountEmailOtp>>;
		try { issued = await issueAccountEmailOtp(database, userId, String((await body()).email ?? '')); }
		catch (error) {
			const status = error instanceof AccountEmailRateLimitError ? 429 : 400;
			return apiMessage(c, status, error instanceof Error ? error.message : '邮箱不合法');
		}
		try {
			await sendDefaultCloudEmail(globalDatabase, 'passport', 'email_verification', issued.email, { code: issued.code, email: issued.email, expires_minutes: '10' });
		} catch (error) {
			await discardAccountEmailOtp(database, userId);
			return apiMessage(c, 502, error instanceof Error ? error.message : '邮箱验证码发送失败');
		}
		return apiMessageData(c, 201, `验证码已发送到 ${issued.email}，请用工具栏的“输入验证码”完成绑定`, {}, { component: 'modal' });
	}

	if (c.req.method === 'POST' && params.id && action === 'primary') {
		try { return apiMessage(c, 200, `${await setPrimaryAccountEmail(database, userId, params.id)} 已设为主邮箱`); }
		catch (error) { return apiMessage(c, 409, error instanceof Error ? error.message : '设置主邮箱失败'); }
	}

	if (c.req.method === 'DELETE' && !params.id) {
		const ids = await c.req.json<unknown>().catch(() => []);
		const targets = Array.isArray(ids) ? ids.map((value) => String(value)) : [];
		if (!targets.length) return apiMessage(c, 400, '请选择要解绑的邮箱');
		const removed: string[] = [];
		for (const target of targets) {
			try { removed.push(await unbindAccountEmail(database, userId, target)); }
			catch (error) { return apiMessage(c, 409, error instanceof Error ? error.message : '解绑失败'); }
		}
		return apiMessage(c, 200, `${removed.join('、')} 已解绑`);
	}

	return next();
};

export const acceptsTrailingParams = true;
export default handler;
