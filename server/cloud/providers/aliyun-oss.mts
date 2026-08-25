import type { CloudBucket, CloudCredential } from '../index.mjs';

const encoder = new TextEncoder();
const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
const sha256 = async (value: string) => toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const hmac = async (key: ArrayBuffer, value: string) => crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), encoder.encode(value));
const xmlDecode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'");

export const listAliyunOssBuckets = async (credential: CloudCredential): Promise<CloudBucket[]> => {
	if (!credential.access_key_id || !credential.access_key_secret) throw new Error('阿里云凭据缺少 Access Key ID 或 Access Key Secret');
	const host = 'oss-cn-hangzhou.aliyuncs.com';
	const region = 'cn-hangzhou';
	const now = new Date();
	const ossDate = now.toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
	const shortDate = ossDate.slice(0, 8);
	const payloadHash = 'UNSIGNED-PAYLOAD';
	const canonicalHeaders = `x-oss-content-sha256:${payloadHash}\nx-oss-date:${ossDate}\n`;
	const canonicalRequest = `GET\n/\n\n${canonicalHeaders}\n\n${payloadHash}`;
	const scope = `${shortDate}/${region}/oss/aliyun_v4_request`;
	const stringToSign = `OSS4-HMAC-SHA256\n${ossDate}\n${scope}\n${await sha256(canonicalRequest)}`;
	const dateKey = await hmac(encoder.encode(`aliyun_v4${credential.access_key_secret}`).buffer as ArrayBuffer, shortDate);
	const regionKey = await hmac(dateKey, region);
	const serviceKey = await hmac(regionKey, 'oss');
	const signingKey = await hmac(serviceKey, 'aliyun_v4_request');
	const signature = toHex(await hmac(signingKey, stringToSign));
	const response = await fetch(`https://${host}/`, {
		headers: {
			'x-oss-content-sha256': payloadHash,
			'x-oss-date': ossDate,
			Authorization: `OSS4-HMAC-SHA256 Credential=${credential.access_key_id}/${scope}, Signature=${signature}`,
		},
	});
	if (!response.ok) throw new Error(`阿里云 OSS Bucket 读取失败：HTTP ${response.status}，请检查密钥及 oss:ListBuckets 权限`);
	const xml = await response.text();
	return [...xml.matchAll(/<Bucket>([\s\S]*?)<\/Bucket>/g)].map((match) => ({
		name: xmlDecode(match[1].match(/<Name>([\s\S]*?)<\/Name>/)?.[1] ?? ''),
		region: xmlDecode(match[1].match(/<Location>([\s\S]*?)<\/Location>/)?.[1] ?? '') || undefined,
	})).filter((item) => Boolean(item.name));
};
