import type { TableSelectOption } from './table.mjs';

/**
 * 角色与代码里的导航、接口守卫强绑定，属于不会随数据变化的常量，集中定义在这里，不进数据库。
 * assignable 为 false 的角色由运行时隐式授予，不允许在用户管理里分配。
 */
export type SystemRoleDefinition = {
	value: string;
	label: string;
	assignable: boolean;
	description: string;
};

export const systemRoles: SystemRoleDefinition[] = [
	{ value: 'public', label: '访客', assignable: false, description: '任何请求都隐式拥有的角色' },
	{ value: 'user', label: '登录用户', assignable: false, description: '任何已登录用户隐式拥有的角色' },
	{ value: 'accounts', label: 'Accounts 用户', assignable: false, description: '存在 Accounts 会话时隐式拥有的角色' },
	{ value: 'admin', label: '管理员', assignable: true, description: '管理后台的准入角色' },
];

const roleMap = new Map(systemRoles.map((role) => [role.value, role]));

/** 统一的角色展示格式：中文名(英文键)；未登记的历史角色原样展示并标注。 */
export const roleLabel = (value: string) => {
	const role = roleMap.get(value);
	return role ? `${role.label}(${role.value})` : `${value}（未知角色）`;
};

export const assignableRoles = systemRoles.filter((role) => role.assignable);

export const assignableRoleOptions = assignableRoles.map((role) => ({
	value: role.value,
	text: roleLabel(role.value),
})) satisfies TableSelectOption[];

const assignableRoleValues = new Set(assignableRoles.map((role) => role.value));

/** 兼容数组和历史 JSON 文本两种输入，非法内容按空角色处理。 */
export const parseRoles = (value: unknown): string[] => {
	const source = typeof value === 'string' && value.trim().startsWith('[')
		? (() => { try { return JSON.parse(value) as unknown; } catch { return []; } })()
		: value;
	if (typeof source === 'string') return source.trim() ? [source.trim()] : [];
	if (!Array.isArray(source)) return [];
	return [...new Set(source.filter((role): role is string => typeof role === 'string' && role.trim() !== '').map((role) => role.trim()))];
};

export const serializeRoles = (roles: string[]) => JSON.stringify(roles);

/** 返回白名单之外的角色，用于接口层拒绝非法输入。 */
export const unknownAssignableRoles = (roles: string[]) => roles.filter((role) => !assignableRoleValues.has(role));
