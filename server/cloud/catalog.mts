export const cloudProviders = [
	{ key: 'aws', text: 'AWS', credentialTest: 'aws', objectStorage: { product: 'S3', adapter: 's3' } },
	{ key: 'cloudflare', text: 'Cloudflare', credentialTest: 'cloudflare', credentialFields: ['account_id'], objectStorage: { product: 'R2', adapter: 's3' } },
	{ key: 'aliyun', text: '阿里云', credentialTest: 'aliyun', objectStorage: { product: 'OSS', adapter: 's3' }, emailPush: { product: 'DirectMail', adapter: 'aliyun-direct-mail', regions: ['cn-hangzhou', 'ap-southeast-1'] } },
	{ key: 'tencent', text: '腾讯云', credentialTest: 'tencent', objectStorage: { product: 'COS', adapter: 's3' } },
	{ key: 'other', text: '其他（S3 兼容）', objectStorage: { product: 'S3 Compatible', adapter: 's3' } },
] as const;

export const cloudProviderOptions = cloudProviders.map((item) => ({ value: item.key, text: item.text }));
export const cloudProviderKeys = new Set<string>(cloudProviderOptions.map((item) => item.value));
export const accountIdProviderKeys: string[] = cloudProviders.filter((item) => 'credentialFields' in item && item.credentialFields.includes('account_id')).map((item) => item.key);

export const getCloudProvider = (provider: string) => cloudProviders.find((item) => item.key === provider);
export const providerSupportsObjectStorage = (provider: string) => Boolean(getCloudProvider(provider)?.objectStorage);
export const getCloudStorageAdapter = (provider: string) => getCloudProvider(provider)?.objectStorage.adapter;
export const getCloudStorageProduct = (provider: string) => getCloudProvider(provider)?.objectStorage.product ?? 'Object Storage';
const getEmailPush = (provider: string) => {
	const definition = getCloudProvider(provider);
	return definition && 'emailPush' in definition ? definition.emailPush : undefined;
};
export const providerSupportsEmailPush = (provider: string) => Boolean(getEmailPush(provider));
export const getCloudEmailAdapter = (provider: string) => getEmailPush(provider)?.adapter;
export const getCloudEmailProduct = (provider: string) => getEmailPush(provider)?.product ?? 'Email Push';
export const getCloudEmailRegions = (provider: string): readonly string[] => getEmailPush(provider)?.regions ?? [];
export const getCredentialTest = (provider: string) => {
	const definition = getCloudProvider(provider);
	return definition && 'credentialTest' in definition ? definition.credentialTest : undefined;
};
export const isCredentialContextValid = (provider: string, accountId: string) => provider !== 'cloudflare' || /^[a-f0-9]{32}$/i.test(accountId);

export const getCloudDiscoveryDefaults = (provider: string, accountId = '') => {
	if (provider === 'aws') return { endpoints: ['https://s3.amazonaws.com'], regions: ['us-east-1'], pathStyle: false };
	if (provider === 'cloudflare') return { endpoints: accountId ? [`https://${accountId}.r2.cloudflarestorage.com`] : [], regions: ['auto'], pathStyle: false };
	if (provider === 'aliyun') return { endpoints: ['https://oss-cn-hangzhou.aliyuncs.com'], regions: ['cn-hangzhou'], pathStyle: false };
	if (provider === 'other') return { endpoints: [], regions: ['us-east-1'], pathStyle: true };
	return { endpoints: [], regions: [], pathStyle: false };
};

export const getCloudBucketFieldValues = (provider: string, region = '', fallbackEndpoint = '') => {
	if (provider === 'tencent' && region) return { endpoint: `https://cos.${region}.myqcloud.com`, region, path_style: false };
	if (provider === 'aws') {
		const resolvedRegion = region || 'us-east-1';
		return { endpoint: `https://s3.${resolvedRegion}.amazonaws.com`, region: resolvedRegion, path_style: false };
	}
	if (provider === 'aliyun' && region) {
		const resolvedRegion = region.replace(/^oss-/, '');
		return { endpoint: `https://oss-${resolvedRegion}.aliyuncs.com`, region: resolvedRegion, path_style: false };
	}
	if (provider === 'cloudflare') return { endpoint: fallbackEndpoint, region: 'auto', path_style: false };
	if (provider === 'other') return { endpoint: fallbackEndpoint, region: region || 'us-east-1', path_style: true };
	return fallbackEndpoint ? { endpoint: fallbackEndpoint, region, path_style: false } : { region, path_style: false };
};
