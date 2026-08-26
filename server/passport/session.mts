import type { DatabaseAdapter } from '@server/database/index.mjs';
import { allSql, firstSql, sql } from '@server/database/sql.mjs';

export const passportSessionCookieName = 'passport_session';

const readCookie = (request: Request, name: string) => {
	for (const part of (request.headers.get('cookie') ?? '').split(';')) {
		const [candidate, ...value] = part.trim().split('=');
		if (candidate === name) return decodeURIComponent(value.join('='));
	}
};

export const readPassportSessionId = (request: Request) => readCookie(request, passportSessionCookieName);
export const createPassportSessionCookie = (sessionId: string, secure: boolean, maxAge: number) =>
	`${passportSessionCookieName}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
export const clearPassportSessionCookie = (secure: boolean) =>
	`${passportSessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

export const loadPassportSession = async (database: DatabaseAdapter, request: Request, siteKey = 'passport', hostname = '') => {
	const sessionId = readPassportSessionId(request);
	if (!sessionId) return undefined;
	const user = siteKey === 'passport'
		? await firstSql<{ user_id: string; nickname: string }>(database, sql(database).select({ table: 'passport_sessions', alias: 's', columns: { user_id: { column: 'u.user_id', cast: 'text' }, nickname: 'u.nickname' }, joins: [{ table: 'passport_users', alias: 'u', left: 'u.user_id', right: 's.user_id' }], where: [{ column: 's.id', value: sessionId }, { column: 's.expires_at', operator: '>', value: Date.now() }, { column: 'u.status', value: 'enabled' }] }))
		: await firstSql<{ user_id: string; nickname: string }>(database, sql(database).select({ table: 'passport_site_sessions', alias: 's', columns: { user_id: { column: 'u.user_id', cast: 'text' }, nickname: 'u.nickname' }, joins: [{ table: 'passport_users', alias: 'u', left: 'u.user_id', right: 's.user_id' }], where: [{ column: 's.id', value: sessionId }, { column: 's.site_key', value: siteKey }, { column: 's.hostname', value: hostname }, { column: 's.expires_at', operator: '>', value: Date.now() }, { column: 'u.status', value: 'enabled' }] }));
	if (!user) return undefined;
	const roles = await allSql<{ role: string }>(database, sql(database).select({ table: 'passport_user_roles', columns: { role: 'role' }, where: [{ column: 'user_id', value: user.user_id }], orderBy: [{ column: 'role' }] }));
	return { id: user.user_id, username: user.nickname, roles: roles.map((item) => item.role) };
};
