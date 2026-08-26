import type { DatabaseAdapter } from '@server/database/index.mjs';

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

export const loadPassportSession = async (database: DatabaseAdapter, request: Request) => {
	const sessionId = readPassportSessionId(request);
	if (!sessionId) return undefined;
	const user = await database.prepare(`SELECT CAST(u.user_id AS TEXT) AS user_id, u.nickname FROM passport_sessions s
		JOIN passport_users u ON u.user_id = s.user_id WHERE s.id = ?1 AND s.expires_at > ?2 AND u.status = 'enabled'`)
		.bind(sessionId, Date.now()).first<{ user_id: string; nickname: string }>();
	if (!user) return undefined;
	const roles = await database.prepare(`SELECT role FROM passport_user_roles WHERE user_id = ?1 ORDER BY role`).bind(user.user_id).all<{ role: string }>();
	return { id: user.user_id, username: user.nickname, roles: roles.results.map((item) => item.role) };
};
