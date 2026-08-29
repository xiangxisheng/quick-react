import type { Context } from 'hono';
import type { AppEnv } from './types.mjs';
import type { AuthPage, AuthState, HeaderAction, PageStatus } from '@shared/types/initial-data.mjs';
import { findNavigationItem, stripPageSuffix } from '@shared/navigation-tree.mjs';
import { getFullSiteNavigation, getPageDefinitions, getSiteNavigation } from './navigation.mjs';
import { firstSql, sql } from './database/sql.mjs';

// 前端固定注册的第三方登录回调页面，不属于导航树。
const callbackPagePaths = ['/accounts/external/callback', '/accounts/external/wechat'];

/** 本站是否还能创建初始管理员：由本站数据库里的引导状态决定，和站点是哪个无关。 */
const registrationAvailable = async (c: Context<AppEnv>) => {
	const database = c.get('database');
	const row = await firstSql<{ value: string }>(database, sql(database).select({ table: 'base_system_bootstrap', columns: { value: 'value' }, where: [{ column: 'key', value: 'initial_admin' }] }));
	return row?.value === 'open';
};

/** 未登录时的认证入口；退出接口复用这份后端配置，前端无需刷新页面或自行推断登录方式。 */
export const buildAnonymousAuthState = async (c: Context<AppEnv>): Promise<AuthState> => {
	const siteConfig = c.get('techStackConfig');
	// 启用 Accounts 登录的站点不跳转登录页，直接在当前页弹出登录窗口。
	const accountsLoginMode = c.get('accountsLoginMode');
	const accountsLogin = accountsLoginMode !== 'local';
	// 启用 Accounts 登录后不能再创建本地账号，注册入口一并隐藏。
	const signUp = !accountsLogin && await registrationAvailable(c);
	// 公共 /sign 页面已取消；只保留初始管理员注册页和身份提供方内部认证页。
	const signPages: AuthPage[] = [
		...(c.get('accountsIdentity') ? [{ path: `/accounts/sign${siteConfig.pageSuffix}`, title: 'Accounts 身份认证', description: '验证 Accounts 身份并继续 OIDC 授权', mode: 'sign' as const, apiPath: `/api/accounts/sign${siteConfig.apiSuffix}`, submitMethod: 'POST' as const, redirectPath: `/panel/accounts${siteConfig.pageSuffix}` }] : []),
		...(signUp ? [{ path: `/sign-up${siteConfig.pageSuffix}`, title: '注册', description: '创建初始管理员', mode: 'sign-up' as const, apiPath: `/api/sign${siteConfig.apiSuffix}`, submitMethod: 'PUT' as const, redirectPath: `/` }] : []),
	];
	return {
		component: 'buttons',
		actions: [
			{ key: '/sign', label: '登录', action: accountsLoginMode === 'oidc' ? 'accounts-login' : 'local-login', icon: 'login' },
			...(signUp ? [{ key: '/sign-up', label: '注册', action: 'navigate' as const, icon: 'register' as const }] : []),
		],
		pages: signPages,
	};
};

export const buildAuthState = async (c: Context<AppEnv>): Promise<AuthState> => {
	const anonymous = await buildAnonymousAuthState(c);
	const currentUser = c.get('currentUser'), passportUser = c.get('passportUser');
	// 登录后的入口只看当前持有哪些会话，退出统一走本站的 /sign。
	const actions: HeaderAction[] = [
		...(currentUser ? [{ key: '/panel/me', label: '个人中心', action: 'navigate' as const, icon: 'user' as const }] : []),
		...(passportUser ? [{ key: '/panel/accounts', label: '账户中心', action: 'navigate' as const, icon: 'user' as const }] : []),
		{ key: passportUser ? '/accounts/sign' : '/sign', label: passportUser ? '退出 Accounts' : '退出登录', action: 'logout', icon: 'logout' },
	];
	// 同时存在两套会话时以 Accounts 身份（昵称）为准。
	const user = passportUser ?? currentUser;
	if (user) return { component: 'dropdown', currentUser: user, actions, pages: anonymous.pages };
	return anonymous;
};

const authPagePaths = (auth: AuthState, pageSuffix: string) => auth.pages.map((page) => stripPageSuffix(page.path, pageSuffix));

export const resolvePagePaths = (c: Context<AppEnv>, auth: AuthState) => {
	const site = c.get('site');
	const pageSuffix = c.get('techStackConfig').pageSuffix;
	const shared = [...authPagePaths(auth, pageSuffix), ...callbackPagePaths];
	return {
		// 当前角色可以打开的页面。
		allowed: new Set([...getPageDefinitions(getSiteNavigation(site.codeSiteChain, c.get('effectiveRoles'))).map((page) => page.path), ...shared]),
		// 站点存在的全部页面，用于区分“路径不存在”和“无权访问”。
		known: new Set([...getPageDefinitions(getFullSiteNavigation(site.codeSiteChain)).map((page) => page.path), ...shared]),
	};
};

/**
 * 判断请求的页面路径能否渲染，不能渲染时返回需要展示给用户的提示。
 * 返回 undefined 表示当前角色可以正常打开该页面。
 */
export const resolvePageStatus = async (
	c: Context<AppEnv>,
	requestPath: string,
	auth: AuthState,
	paths: ReturnType<typeof resolvePagePaths> = resolvePagePaths(c, auth),
): Promise<PageStatus | undefined> => {
	const pageSuffix = c.get('techStackConfig').pageSuffix;
	const logicalPath = stripPageSuffix(requestPath, pageSuffix);
	const { allowed, known } = paths;
	if (allowed.has(logicalPath)) return undefined;
	const home = { key: '/', label: '返回首页', action: 'navigate' as const };
	if (!known.has(logicalPath)) {
		return {
			path: requestPath,
			status: 404,
			title: '页面不存在',
			description: `没有找到路径 ${requestPath}，请检查地址是否输入正确，或从导航菜单重新进入。`,
			actions: [home],
		};
	}
	// 页面要求 Accounts 角色时，指向 Accounts 登录页，而不是站点本地登录页。
	const item = findNavigationItem(getFullSiteNavigation(c.get('site').codeSiteChain), logicalPath);
	const requiredRoles = Array.isArray(item?.roles) ? item.roles : [];
	const needsAccounts = requiredRoles.includes('accounts') && !c.get('passportUser');
	const signIn = auth.pages.filter((page) => page.mode === 'sign');
	const signPath = signIn.find((page) => page.apiPath.startsWith('/api/accounts/'))?.path ?? `/accounts/sign${pageSuffix}`;
	if (!c.get('currentUser') || needsAccounts) {
		// 业务站点用弹窗登录，不再把用户送到登录页。
		const loginAction = needsAccounts ? 'navigate' as const : c.get('accountsLoginMode') === 'oidc' ? 'accounts-login' as const : 'local-login' as const;
		return {
			path: requestPath,
			status: 401,
			title: '请先登录',
			description: needsAccounts
				? `访问 ${requestPath} 需要先登录 Accounts 账号。`
				: `访问 ${requestPath} 需要先登录，登录后才能查看该页面。`,
			actions: [
				{ key: needsAccounts ? stripPageSuffix(signPath, pageSuffix) : '/sign', label: '登录', action: loginAction, icon: 'login' },
				home,
			],
		};
	}
	return {
		path: requestPath,
		status: 403,
		title: '无权访问',
		description: `当前账号 ${c.get('currentUser')?.username ?? c.get('passportUser')?.username ?? ''} 没有访问 ${requestPath} 的权限，请联系管理员分配对应角色。`,
		actions: [{ key: '/panel/me', label: '个人中心', action: 'navigate', icon: 'user' }, home],
	};
};

/** 页面可以访问但前端没有对应渲染组件时的兜底提示。 */
export const unavailablePageStatus = (requestPath: string): PageStatus => ({
	path: requestPath,
	status: 500,
	title: '页面暂不可用',
	description: `当前版本无法渲染 ${requestPath}，请刷新页面重试，若仍然无法打开请联系管理员。`,
	actions: [{ key: '/', label: '返回首页', action: 'navigate' }],
});
