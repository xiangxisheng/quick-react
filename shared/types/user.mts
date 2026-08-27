export type UserIdentity = {
	id: number | string;
	username: string;
	roles: string[];
};

/** 业务站点启用 Accounts 登录时，个人中心指向 Accounts 账户中心的入口。 */
export type AccountCenterLink = { label: string; url: string };
