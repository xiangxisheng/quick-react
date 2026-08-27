import type { MenuNode } from '@server/sites/base/navigation.mjs';

/** 账户中心只对持有 Accounts 会话的访问者可见，权限由 accounts 角色控制。 */
const navigation: MenuNode[] = [{
	label: '账户中心', key: 'accounts/center', icon: 'appstore', navigationGroup: 'accounts', dropdown: false,
	component: 'panel', title: '账户中心', description: '管理 Accounts 账号的资料、邮箱和密码', roles: ['accounts'],
	children: [
		{ label: '概览', key: 'overview', icon: 'mail', component: 'dashboard', title: '账户概览', description: '查看 Accounts 账号的基本信息' },
		{ label: '个人资料', key: 'profile', icon: 'appstore', component: 'form', title: '个人资料', description: '修改 Accounts 昵称' },
		{ label: '邮箱管理', key: 'emails', icon: 'appstore', component: 'table', title: '邮箱管理', description: '查看邮箱、切换主邮箱和解绑邮箱' },
		{ label: '绑定邮箱', key: 'bind-email', icon: 'appstore', component: 'form', title: '绑定邮箱', description: '完成第三方认证后添加并验证新邮箱' },
		{ label: '安全设置', key: 'security', icon: 'appstore', component: 'form', title: '安全设置', description: '设置或修改 Accounts 密码' },
	],
}];

export default navigation;
