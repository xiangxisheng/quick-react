import type { DatabaseAdapter, DatabaseBatchStatement } from '@server/database/index.mjs';
import { allSql, firstSql, runSql, sql } from '@server/database/sql.mjs';
import { randomToken, sha256, sha256Base64Url } from '@server/accounts/oidc.mjs';
import { getPassportSnowflakeGenerator } from '@server/passport/snowflake.mjs';
import { hashPassword, verifyPassword } from '@server/auth.mjs';
import { normalizePassportEmail } from '@server/passport/identity.mjs';

export type ExternalProviderId = 'google' | 'wechat';
export type WechatMode = 'open_platform' | 'official_account';
export type ExternalProvider = { id: ExternalProviderId; display_name: string; client_id: string; client_secret: string; wechat_mode: WechatMode; wechat_redirect_domain: string; status: string };
export type ExternalProfile = { subject: string; nickname: string; email?: string; raw: Record<string, unknown> };
export type ExternalLoginState = { provider: ExternalProviderId; code_verifier: string; nonce: string; redirect_uri: string; expires_at: number; consumed_at: number | null };
export type PendingExternalIdentity = { id_hash: string; provider: ExternalProviderId; subject: string; nickname: string; profile: string; status: string; expires_at: number };

const providerColumns = { id: 'id', display_name: 'display_name', client_id: 'client_id', client_secret: 'client_secret', wechat_mode: 'wechat_mode', wechat_redirect_domain: 'wechat_redirect_domain', status: 'status' } as const;
export const externalProviders = (database: DatabaseAdapter, enabledOnly = false) => allSql<ExternalProvider>(database, sql(database).select({
	table: 'passport_external_providers', columns: providerColumns,
	where: enabledOnly ? [{ column: 'status', value: 'enabled' }] : [], orderBy: [{ column: 'created_at' }],
}));
export const externalProvider = (database: DatabaseAdapter, id: string) => firstSql<ExternalProvider>(database, sql(database).select({ table: 'passport_external_providers', columns: providerColumns, where: [{ column: 'id', value: id }, { column: 'status', value: 'enabled' }] }));

export const externalStateCookieName = 'accounts_external_state';
export const externalStateCookie = (value: string, secure: boolean) => `${externalStateCookieName}=${encodeURIComponent(value)}; Path=/api/accounts/external/; HttpOnly; SameSite=Lax; Max-Age=1800${secure ? '; Secure' : ''}`;
export const clearExternalStateCookie = (secure: boolean) => `${externalStateCookieName}=; Path=/api/accounts/external/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
/** 未注册邮箱确认后暂存 30 分钟，供第三方认证回来后预填邮箱验证步骤。 */
export const signupEmailCookieName = 'accounts_signup_email';
export const signupEmailCookie = (email: string, secure: boolean) => `${signupEmailCookieName}=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1800${secure ? '; Secure' : ''}`;
export const clearSignupEmailCookie = (secure: boolean) => `${signupEmailCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

/** 第三方认证通过的短期凭证：发送任何邮箱验证码之前都必须持有它。 */
export const externalVerifiedCookieName = 'accounts_external_verified';
export const externalVerifiedCookie = (secure: boolean) => `${externalVerifiedCookieName}=1; Path=/; HttpOnly; SameSite=Lax; Max-Age=1800${secure ? '; Secure' : ''}`;
export const clearExternalVerifiedCookie = (secure: boolean) => `${externalVerifiedCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

/** 忘记密码时先记下重设意图，第三方认证通过后才允许直接设置新密码。 */
export const passwordResetCookieName = 'accounts_password_reset';
export const passwordResetCookie = (email: string, secure: boolean) => `${passwordResetCookieName}=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1800${secure ? '; Secure' : ''}`;
export const clearPasswordResetCookie = (secure: boolean) => `${passwordResetCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

export const externalPendingCookieName = 'accounts_external_pending';
export const externalPendingCookie = (value: string, secure: boolean) => `${externalPendingCookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}`;
export const clearExternalPendingCookie = (secure: boolean) => `${externalPendingCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

export const externalAuthorizationUrl = async (provider: ExternalProvider, redirectUri: string, state: string, nonce: string, codeVerifier: string) => {
	if (provider.id === 'google') {
		const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
		url.search = new URLSearchParams({ client_id: provider.client_id, redirect_uri: redirectUri, response_type: 'code', scope: 'openid profile email', state, nonce, code_challenge: await sha256Base64Url(codeVerifier), code_challenge_method: 'S256', prompt: 'select_account' }).toString();
		return url.toString();
	}
	const officialAccount = provider.wechat_mode === 'official_account';
	const url = new URL(officialAccount ? 'https://open.weixin.qq.com/connect/oauth2/authorize' : 'https://open.weixin.qq.com/connect/qrconnect');
	url.search = new URLSearchParams({ appid: provider.client_id, redirect_uri: redirectUri, response_type: 'code', scope: officialAccount ? 'snsapi_userinfo' : 'snsapi_login', state }).toString();
	return `${url.toString()}#wechat_redirect`;
};

const responseJson = async (response: Response, label: string) => {
	const body = await response.json().catch(() => null) as Record<string, unknown> | null;
	if (!response.ok || !body) throw new Error(`${label}失败（HTTP ${response.status}）`);
	if (body.error || body.errcode) throw new Error(`${label}失败：${String(body.error_description ?? body.errmsg ?? body.error ?? body.errcode)}`);
	return body;
};

export const fetchExternalProfile = async (provider: ExternalProvider, code: string, state: ExternalLoginState, requestFetch: typeof fetch): Promise<ExternalProfile> => {
	if (provider.id === 'google') {
		const tokenResponse = await requestFetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: provider.client_id, client_secret: provider.client_secret, redirect_uri: state.redirect_uri, code_verifier: state.code_verifier }).toString() });
		const token = await responseJson(tokenResponse, 'Google 授权码交换'), accessToken = String(token.access_token ?? '');
		if (!accessToken) throw new Error('Google 未返回访问令牌');
		const profile = await responseJson(await requestFetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' } }), 'Google 用户信息获取');
		const subject = String(profile.sub ?? '').trim(), email = String(profile.email ?? '').trim().toLowerCase();
		if (!subject) throw new Error('Google 用户信息缺少 sub');
		if (email && profile.email_verified !== true) throw new Error('Google 邮箱尚未验证');
		return { subject, nickname: String(profile.name ?? profile.given_name ?? email.split('@')[0] ?? '').trim(), ...(email ? { email } : {}), raw: profile };
	}
	const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
	tokenUrl.search = new URLSearchParams({ appid: provider.client_id, secret: provider.client_secret, code, grant_type: 'authorization_code' }).toString();
	const token = await responseJson(await requestFetch(tokenUrl.toString(), { headers: { accept: 'application/json' } }), '微信授权码交换');
	const accessToken = String(token.access_token ?? ''), openid = String(token.openid ?? '');
	if (!accessToken || !openid) throw new Error('微信未返回 access_token 或 openid');
	const profileUrl = new URL('https://api.weixin.qq.com/sns/userinfo');
	profileUrl.search = new URLSearchParams({ access_token: accessToken, openid, lang: 'zh_CN' }).toString();
	const profile = await responseJson(await requestFetch(profileUrl.toString(), { headers: { accept: 'application/json' } }), '微信用户信息获取');
	return { subject: `${provider.client_id}:${openid}`, nickname: String(profile.nickname ?? '微信用户').trim(), raw: profile };
};

const normalizedNickname = (value: string, provider: ExternalProviderId) => {
	const characters = Array.from(value.trim());
	return (characters.length ? characters : Array.from(provider === 'google' ? 'Google用户' : '微信用户')).slice(0, 12).join('');
};

export const resolveExternalUser = async (database: DatabaseAdapter, workerId: unknown, provider: ExternalProvider, profile: ExternalProfile, targetUserId?: string | null) => {
	const existing = await firstSql<{ user_id: string; status: string }>(database, sql(database).select({ table: 'passport_external_identities', alias: 'i', columns: { user_id: { column: 'i.user_id', cast: 'text' }, status: 'u.status' }, joins: [{ table: 'passport_users', alias: 'u', left: 'u.user_id', right: 'i.user_id' }], where: [{ column: 'i.provider', value: provider.id }, { column: 'i.subject', value: profile.subject }] }));
	if (existing?.status !== undefined && existing.status !== 'enabled') throw new Error('该外部身份对应的 Accounts 用户已停用');
	if (targetUserId && existing && existing.user_id !== targetUserId) throw new Error('该外部身份已经绑定到另一个 Accounts 用户');
	const now = Date.now(), serializedProfile = JSON.stringify(profile.raw);
	if (existing) {
		await runSql(database, sql(database).update('passport_external_identities', { profile: serializedProfile, updated_at: now }, [{ column: 'provider', value: provider.id }, { column: 'subject', value: profile.subject }]));
		return existing.user_id;
	}
	if (targetUserId) {
		const target = await firstSql(database, sql(database).select({ table: 'passport_users', columns: { user_id: 'user_id' }, where: [{ column: 'user_id', value: targetUserId }, { column: 'status', value: 'enabled' }] }));
		if (!target) throw new Error('准备绑定的 Accounts 用户不存在或已停用');
		await runSql(database, sql(database).insert('passport_external_identities', { user_id: targetUserId, provider: provider.id, subject: profile.subject, profile: serializedProfile, created_at: now, updated_at: now }));
		return targetUserId;
	}
	if (!profile.email) throw new Error('该外部身份没有已验证邮箱，不能创建 Accounts 用户');
	const normalizedEmail = normalizePassportEmail(profile.email);
	const ownedEmail = await firstSql<{ user_id: string; status: string }>(database, sql(database).select({ table: 'passport_emails', alias: 'e', columns: { user_id: { column: 'ue.user_id', cast: 'text' }, status: 'u.status' }, joins: [{ table: 'passport_user_emails', alias: 'ue', left: 'ue.email_id', right: 'e.id' }, { table: 'passport_users', alias: 'u', left: 'u.user_id', right: 'ue.user_id' }], where: [{ column: 'e.email', value: normalizedEmail }, { column: 'e.verified', value: 1 }], limit: 1 }));
	if (ownedEmail) throw new Error(ownedEmail.status === 'enabled' ? '该邮箱已属于现有 Accounts 用户，请先登录原账户，再绑定此外部身份' : '该邮箱所属的 Accounts 用户已停用');
	if (!database.batch) throw new Error('Accounts 数据库不支持原子创建外部身份');
	const generator = getPassportSnowflakeGenerator(database, workerId), userId = (await generator.next()).toString();
	const statements: DatabaseBatchStatement[] = [
		sql(database).insert('passport_users', { user_id: userId, nickname: normalizedNickname(profile.nickname, provider.id), status: 'enabled', created_at: now, updated_at: now }),
		sql(database).insert('passport_external_identities', { user_id: userId, provider: provider.id, subject: profile.subject, profile: serializedProfile, created_at: now, updated_at: now }),
	];
	const emailId = (await generator.next()).toString();
	statements.push(
		sql(database).insert('passport_emails', { id: emailId, email: normalizedEmail, verified: 1, created_at: now, updated_at: now }),
		sql(database).insert('passport_user_emails', { user_id: userId, email_id: emailId, is_primary: 1, created_at: now }),
	);
	await database.batch(statements);
	return userId;
};

export const createExternalState = async (database: DatabaseAdapter, provider: ExternalProviderId, redirectUri: string) => {
	const state = randomToken(32), codeVerifier = randomToken(48), nonce = randomToken(24), now = Date.now();
	await runSql(database, sql(database).insert('passport_external_login_states', { id_hash: await sha256(state), provider, code_verifier: codeVerifier, nonce, redirect_uri: redirectUri, expires_at: now + 1_800_000, created_at: now }));
	return { state, codeVerifier, nonce };
};

export const consumeExternalState = async (database: DatabaseAdapter, state: string) => {
	const hash = await sha256(state), now = Date.now();
	const updated = await runSql(database, sql(database).update('passport_external_login_states', { consumed_at: now }, [{ column: 'id_hash', value: hash }, { column: 'consumed_at', operator: 'IS NULL' }, { column: 'expires_at', operator: '>', value: now }]));
	if (!Number(updated.meta?.changes ?? 0)) return null;
	return firstSql<ExternalLoginState>(database, sql(database).select({ table: 'passport_external_login_states', columns: { provider: 'provider', code_verifier: 'code_verifier', nonce: 'nonce', redirect_uri: 'redirect_uri', expires_at: 'expires_at', consumed_at: 'consumed_at' }, where: [{ column: 'id_hash', value: hash }] }));
};

export const externalQrState = async (database: DatabaseAdapter, stateHash: string) => firstSql<{ provider: ExternalProviderId; qr_status: string; qr_user_id: string | null; expires_at: number }>(database, sql(database).select({ table: 'passport_external_login_states', columns: { provider: 'provider', qr_status: 'qr_status', qr_user_id: 'qr_user_id', expires_at: 'expires_at' }, where: [{ column: 'id_hash', value: stateHash }] }));

const generateEmailCode = () => {
	const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000, values = new Uint32Array(1);
	do crypto.getRandomValues(values); while (values[0] >= limit);
	return String(values[0] % 1_000_000).padStart(6, '0');
};

export const createPendingExternalIdentity = async (database: DatabaseAdapter, profile: ExternalProfile, provider: ExternalProviderId, qrStateHash?: string) => {
	const token = randomToken(32), now = Date.now();
	await runSql(database, sql(database).update('passport_external_pending_identities', { status: 'expired', updated_at: now }, [{ column: 'provider', value: provider }, { column: 'subject', value: profile.subject }, { column: 'status', value: 'pending' }]));
	const idHash = await sha256(token);
	await runSql(database, sql(database).insert('passport_external_pending_identities', { id_hash: idHash, provider, subject: profile.subject, nickname: normalizedNickname(profile.nickname, provider), profile: JSON.stringify(profile.raw), status: 'pending', expires_at: now + 1_800_000, created_at: now, updated_at: now }));
	if (qrStateHash) await runSql(database, sql(database).insert('passport_external_pending_qr_states', { pending_identity_hash: idHash, qr_state_hash: qrStateHash, created_at: now }));
	return token;
};

export const pendingExternalIdentity = async (database: DatabaseAdapter, token: string) => {
	if (!token) return null;
	const idHash = await sha256(token), now = Date.now();
	const pending = await firstSql<PendingExternalIdentity>(database, sql(database).select({ table: 'passport_external_pending_identities', columns: { id_hash: 'id_hash', provider: 'provider', subject: 'subject', nickname: 'nickname', profile: 'profile', status: 'status', expires_at: 'expires_at' }, where: [{ column: 'id_hash', value: idHash }] }));
	if (!pending || pending.status !== 'pending') return null;
	if (pending.expires_at > now) return pending;
	await runSql(database, sql(database).update('passport_external_pending_identities', { status: 'expired', updated_at: now }, { id_hash: idHash }));
	return null;
};

export const pendingExternalIdentityByQrState = async (database: DatabaseAdapter, state: string) => {
	if (!state) return null;
	const stateHash = await sha256(state), now = Date.now();
	return firstSql<PendingExternalIdentity>(database, sql(database).select({ table: 'passport_external_pending_identities', alias: 'p', columns: { id_hash: 'p.id_hash', provider: 'p.provider', subject: 'p.subject', nickname: 'p.nickname', profile: 'p.profile', status: 'p.status', expires_at: 'p.expires_at' }, joins: [{ table: 'passport_external_pending_qr_states', alias: 'q', left: 'q.pending_identity_hash', right: 'p.id_hash' }], where: [{ column: 'q.qr_state_hash', value: stateHash }, { column: 'p.status', value: 'pending' }, { column: 'p.expires_at', operator: '>', value: now }] }));
};

export class ExternalEmailRateLimitError extends Error {
	constructor(public readonly waitSeconds: number) { super(`邮件发送过于频繁，请 ${waitSeconds} 秒后重试`); }
}

export const issueExternalEmailOtp = async (database: DatabaseAdapter, pending: PendingExternalIdentity, rawEmail: string) => {
	const email = normalizePassportEmail(rawEmail), now = Date.now();
	const recent = await allSql<{ created_at: number }>(database, sql(database).select({ table: 'passport_external_email_otps', columns: { created_at: 'created_at' }, where: [{ column: 'pending_identity_hash', value: pending.id_hash }, { column: 'created_at', operator: '>', value: now - 60 * 60_000 }], orderBy: [{ column: 'created_at', direction: 'DESC' }] }));
	if (recent[0] && now - recent[0].created_at < 60_000) throw new ExternalEmailRateLimitError(Math.ceil((60_000 - (now - recent[0].created_at)) / 1000));
	if (recent.length >= 10) throw new ExternalEmailRateLimitError(Math.max(1, Math.ceil((recent.at(-1)!.created_at + 60 * 60_000 - now) / 1000)));
	await runSql(database, sql(database).update('passport_external_email_otps', { status: 'expired', updated_at: now }, [{ column: 'pending_identity_hash', value: pending.id_hash }, { column: 'status', value: 'pending' }]));
	const code = generateEmailCode(), id = crypto.randomUUID();
	await runSql(database, sql(database).insert('passport_external_email_otps', { id, pending_identity_hash: pending.id_hash, email, code_hash: await hashPassword(code), attempt_count: 0, status: 'pending', expires_at: now + 600_000, created_at: now, updated_at: now }));
	return { code, email, expiresAt: now + 600_000 };
};

export const discardExternalEmailOtp = (database: DatabaseAdapter, pendingIdentityHash: string) => runSql(database, sql(database).update('passport_external_email_otps', { status: 'expired', updated_at: Date.now() }, [{ column: 'pending_identity_hash', value: pendingIdentityHash }, { column: 'status', value: 'pending' }]));
export const pendingExternalEmailOtp = (database: DatabaseAdapter, pendingIdentityHash: string) => firstSql<{ email: string; expires_at: number }>(database, sql(database).select({ table: 'passport_external_email_otps', columns: { email: 'email', expires_at: 'expires_at' }, where: [{ column: 'pending_identity_hash', value: pendingIdentityHash }, { column: 'status', value: 'pending' }, { column: 'expires_at', operator: '>', value: Date.now() }], orderBy: [{ column: 'created_at', direction: 'DESC' }], limit: 1 }));

export type ExternalEmailVerification = { status: 'created'; userId: string } | { status: 'invalid' | 'expired' | 'locked' } | { status: 'conflict'; message: string };
export const verifyExternalEmailOtp = async (database: DatabaseAdapter, workerId: unknown, pending: PendingExternalIdentity, rawCode: string): Promise<ExternalEmailVerification> => {
	const code = rawCode.trim();
	if (!/^\d{6}$/.test(code)) return { status: 'invalid' };
	const otp = await firstSql<{ id: string; email: string; code_hash: string; attempt_count: number; expires_at: number }>(database, sql(database).select({ table: 'passport_external_email_otps', columns: { id: 'id', email: 'email', code_hash: 'code_hash', attempt_count: 'attempt_count', expires_at: 'expires_at' }, where: [{ column: 'pending_identity_hash', value: pending.id_hash }, { column: 'status', value: 'pending' }], orderBy: [{ column: 'created_at', direction: 'DESC' }], limit: 1 }));
	if (!otp) return { status: 'invalid' };
	const now = Date.now();
	if (otp.expires_at <= now) {
		await runSql(database, sql(database).update('passport_external_email_otps', { status: 'expired', updated_at: now }, { id: otp.id }));
		return { status: 'expired' };
	}
	if (otp.attempt_count >= 5) return { status: 'locked' };
	if (!await verifyPassword(code, otp.code_hash)) {
		const attempts = otp.attempt_count + 1;
		await runSql(database, sql(database).update('passport_external_email_otps', { attempt_count: attempts, status: attempts >= 5 ? 'expired' : 'pending', updated_at: now }, { id: otp.id }));
		return { status: attempts >= 5 ? 'locked' : 'invalid' };
	}
	const [identityOwner, emailOwner] = await Promise.all([
		firstSql<{ user_id: string; status: string }>(database, sql(database).select({ table: 'passport_external_identities', alias: 'i', columns: { user_id: { column: 'i.user_id', cast: 'text' }, status: 'u.status' }, joins: [{ table: 'passport_users', alias: 'u', left: 'u.user_id', right: 'i.user_id' }], where: [{ column: 'i.provider', value: pending.provider }, { column: 'i.subject', value: pending.subject }] })),
		firstSql<{ user_id: string; status: string }>(database, sql(database).select({ table: 'passport_emails', alias: 'e', columns: { user_id: { column: 'ue.user_id', cast: 'text' }, status: 'u.status' }, joins: [{ table: 'passport_user_emails', alias: 'ue', left: 'ue.email_id', right: 'e.id' }, { table: 'passport_users', alias: 'u', left: 'u.user_id', right: 'ue.user_id' }], where: [{ column: 'e.email', value: otp.email }, { column: 'e.verified', value: 1 }], limit: 1 })),
	]);
	if (identityOwner || emailOwner) {
		await runSql(database, sql(database).update('passport_external_email_otps', { status: 'used', updated_at: now }, { id: otp.id }));
		if (identityOwner) return { status: 'conflict', message: identityOwner.status === 'enabled' ? '此外部身份已经绑定 Accounts 用户，请重新登录' : '此外部身份对应的 Accounts 用户已停用' };
		return { status: 'conflict', message: emailOwner!.status === 'enabled' ? '该邮箱已属于现有 Accounts 用户，请先登录原账户，再绑定此外部身份' : '该邮箱所属的 Accounts 用户已停用' };
	}
	if (!database.batch) throw new Error('Accounts 数据库不支持原子创建外部身份');
	const generator = getPassportSnowflakeGenerator(database, workerId), userId = (await generator.next()).toString(), emailId = (await generator.next()).toString();
	await database.batch([
		sql(database).insert('passport_users', { user_id: userId, nickname: pending.nickname, status: 'enabled', created_at: now, updated_at: now }),
		sql(database).insert('passport_external_identities', { user_id: userId, provider: pending.provider, subject: pending.subject, profile: pending.profile, created_at: now, updated_at: now }),
		sql(database).insert('passport_emails', { id: emailId, email: otp.email, verified: 1, created_at: now, updated_at: now }),
		sql(database).insert('passport_user_emails', { user_id: userId, email_id: emailId, is_primary: 1, created_at: now }),
		sql(database).update('passport_external_email_otps', { status: 'used', updated_at: now }, { id: otp.id }),
		sql(database).update('passport_external_pending_identities', { status: 'completed', updated_at: now }, { id_hash: pending.id_hash }),
	]);
	return { status: 'created', userId };
};
