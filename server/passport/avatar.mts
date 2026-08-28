import type { DatabaseAdapter } from '@server/database/index.mjs';
import { createCloudStorageAdapter, loadDefaultCloudStorageTarget } from '@server/cloud/resolve.mjs';

/** 头像对象路径完全由 user_id 推导，不在数据库里保存路径；内容类型由对象存储保存。 */
export const avatarObjectKey = (userId: string) => `avatars/${userId}`;

const maxAvatarBytes = 2 * 1024 * 1024;
/** 只从身份源自己的图片域名拉取，避免把任意 URL 变成服务端请求。 */
const allowedAvatarHosts: Record<string, RegExp> = {
	google: /(^|\.)googleusercontent\.com$/,
};

export const externalAvatarUrl = (provider: string, profile: unknown) => {
	const raw = profile && typeof profile === 'object' ? (profile as Record<string, unknown>) : {};
	const picture = typeof raw.picture === 'string' ? raw.picture.trim() : '';
	if (!picture) return '';
	const allowed = allowedAvatarHosts[provider];
	if (!allowed) return '';
	try {
		const url = new URL(picture);
		return url.protocol === 'https:' && allowed.test(url.hostname) ? url.toString() : '';
	} catch { return ''; }
};

const storageAdapter = async (globalDatabase: DatabaseAdapter, siteKey: string) => {
	const target = await loadDefaultCloudStorageTarget(globalDatabase, siteKey, 'avatars');
	return target ? createCloudStorageAdapter(target) : undefined;
};

/**
 * 把身份源提供的头像同步到对象存储；已经存在的头像不重复下载。
 * 登录路径上以后台任务方式执行，失败只记录日志，不影响登录。
 */
export const syncExternalAvatar = async (
	globalDatabase: DatabaseAdapter,
	siteKey: string,
	userId: string,
	pictureUrl: string,
	requestFetch: typeof fetch = fetch,
) => {
	if (!pictureUrl) return false;
	const storage = await storageAdapter(globalDatabase, siteKey);
	if (!storage) return false;
	const key = avatarObjectKey(userId);
	const existing = await storage.list(key, undefined, 1);
	if (existing.objects.some((object) => object.key === key)) return false;
	const response = await requestFetch(pictureUrl);
	if (!response.ok) throw new Error(`头像下载失败（HTTP ${response.status}）`);
	const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
	if (!contentType.startsWith('image/')) throw new Error(`头像内容类型不是图片：${contentType || '未知'}`);
	const body = new Uint8Array(await response.arrayBuffer());
	if (!body.byteLength || body.byteLength > maxAvatarBytes) throw new Error(`头像大小不合法：${body.byteLength} 字节`);
	const uploadUrl = await storage.createUploadUrl(key, contentType);
	const uploaded = await requestFetch(uploadUrl, { method: 'PUT', headers: { 'content-type': contentType }, body });
	if (!uploaded.ok) throw new Error(`头像上传失败（HTTP ${uploaded.status}）`);
	return true;
};

/** 读取头像的临时访问地址；没有配置对象存储或还没有头像时返回空。 */
export const loadAvatarUrl = async (globalDatabase: DatabaseAdapter, siteKey: string, userId: string) => {
	const storage = await storageAdapter(globalDatabase, siteKey);
	if (!storage) return '';
	const key = avatarObjectKey(userId);
	const existing = await storage.list(key, undefined, 1);
	if (!existing.objects.some((object) => object.key === key)) return '';
	return storage.createDownloadUrl(key);
};
