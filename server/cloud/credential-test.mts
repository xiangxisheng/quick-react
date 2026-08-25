import type { CloudCredential } from './index.mjs';
import { getCloudDiscoveryDefaults, getCredentialTest } from './catalog.mjs';
import { createCloudStorageAdapter } from './resolve.mjs';
import { testAwsCredential } from './providers/aws-sts.mjs';
import { testAliyunCredential } from './providers/aliyun-sts.mjs';
import { testTencentCredential } from './providers/tencent-cam.mjs';

export type CloudCredentialTestResult = {
	bucketCount?: number;
	details?: { uin: string; ownerUin: string; appId: number };
};

export const testCloudCredential = async (credential: CloudCredential): Promise<CloudCredentialTestResult | null> => {
	const test = getCredentialTest(credential.provider);
	if (!test) return null;
	if (test === 'aws') { await testAwsCredential(credential); return {}; }
	if (test === 'aliyun') { await testAliyunCredential(credential); return {}; }
	if (test === 'tencent') {
		const identity = await testTencentCredential(credential);
		return { details: { uin: identity.uin, ownerUin: identity.ownerUin, appId: identity.appId } };
	}
	const defaults = getCloudDiscoveryDefaults(credential.provider, credential.account_id);
	const endpoint = defaults.endpoints[0];
	if (!endpoint) throw new Error('凭据缺少执行测试所需的账号信息');
	const buckets = await createCloudStorageAdapter({
		id: 0,
		provider: credential.provider,
		cloud_credential_id: credential.id,
		endpoint,
		region: defaults.regions[0] ?? '',
		bucket: '',
		path_style: 1,
		public_base_url: '',
		extra_config: '{}',
		access_key_id: credential.access_key_id,
		access_key_secret: credential.access_key_secret,
	}).listBuckets();
	return { bucketCount: buckets.length };
};
