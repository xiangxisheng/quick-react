import type { CloudBucket, CloudCredential } from '../index.mjs';

const encoder = new TextEncoder();
const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
const sha1 = async (value: string) => toHex(await crypto.subtle.digest('SHA-1', encoder.encode(value)));
const hmacSha1 = async (key: string, value: string) => toHex(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']), encoder.encode(value)));
const xmlDecode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'");

const createAuthorization = async (credential: CloudCredential, host: string) => {
	const start = Math.floor(Date.now() / 1000) - 60;
	const keyTime = `${start};${start + 600}`;
	const httpString = `get\n/\n\nhost=${host}\n`;
	const stringToSign = `sha1\n${keyTime}\n${await sha1(httpString)}\n`;
	const signKey = await hmacSha1(credential.access_key_secret, keyTime);
	const signature = await hmacSha1(signKey, stringToSign);
	return `q-sign-algorithm=sha1&q-ak=${encodeURIComponent(credential.access_key_id)}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=host&q-url-param-list=&q-signature=${signature}`;
};

export const listTencentCosBuckets = async (credential: CloudCredential): Promise<CloudBucket[]> => {
	if (!credential.access_key_id || !credential.access_key_secret) throw new Error('腾讯云凭据缺少 SecretId 或 SecretKey');
	const host = 'service.cos.myqcloud.com';
	const response = await fetch(`https://${host}/`, { headers: { Authorization: await createAuthorization(credential, host) } });
	if (!response.ok) throw new Error(`腾讯云 COS 凭据测试失败：HTTP ${response.status}，请检查密钥及 cos:GetService 权限`);
	const xml = await response.text();
	const buckets = [...xml.matchAll(/<Bucket>([\s\S]*?)<\/Bucket>/g)].map((match) => {
		const name = match[1].match(/<Name>([\s\S]*?)<\/Name>/)?.[1] ?? '';
		const region = match[1].match(/<Location>([\s\S]*?)<\/Location>/)?.[1] ?? '';
		return { name: xmlDecode(name), region: xmlDecode(region) || undefined };
	}).filter((item) => Boolean(item.name));
	return buckets;
};

export const testTencentCosCredential = async (credential: CloudCredential) => listTencentCosBuckets(credential);
