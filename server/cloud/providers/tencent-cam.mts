import type { CloudCredential } from '../index.mjs';
import { callTencentCloudApi } from './tencent-api.mjs';

export type TencentCredentialIdentity = {
	uin: string;
	ownerUin: string;
	appId: number;
};

export const testTencentCredential = async (credential: CloudCredential): Promise<TencentCredentialIdentity> => {
	const result = await callTencentCloudApi<{ Uin?: string; OwnerUin?: string; AppId?: number; RequestId?: string }>(credential, {
		service: 'cam', host: 'cam.tencentcloudapi.com', version: '2019-01-16', action: 'GetUserAppId', errorLabel: '腾讯云凭据测试',
	});
	if (!result.Uin || !result.OwnerUin || !Number.isInteger(result.AppId)) throw new Error('腾讯云凭据测试失败：响应缺少账号标识');
	return { uin: result.Uin, ownerUin: result.OwnerUin, appId: result.AppId! };
};
