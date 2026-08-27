export type UserIdentity = {
	id: number | string;
	username: string;
	roles: string[];
};

/** 业务站点启用 Accounts 登录时，个人中心提供的账号中心入口（始终在新页面打开）。 */
export type AccountCenterLink = { label: string; url: string };
