import type { CloudCredential } from '../index.mjs';

const encoder = new TextEncoder();
const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
const sha256 = async (value: string) => toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const hmac = async (key: ArrayBuffer, value: string) => crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), encoder.encode(value));

export const testAwsCredential = async (credential: CloudCredential) => {
	if (!credential.access_key_id || !credential.access_key_secret) throw new Error('AWS 凭据缺少 Access Key ID 或 Access Key Secret');
	const host = 'sts.amazonaws.com';
	const region = 'us-east-1';
	const service = 'sts';
	const payload = 'Action=GetCallerIdentity&Version=2011-06-15';
	const now = new Date();
	const amzDate = now.toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
	const shortDate = amzDate.slice(0, 8);
	const contentType = 'application/x-www-form-urlencoded; charset=utf-8';
	const signedHeaders = 'content-type;host;x-amz-date';
	const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-date:${amzDate}\n`;
	const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${await sha256(payload)}`;
	const scope = `${shortDate}/${region}/${service}/aws4_request`;
	const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256(canonicalRequest)}`;
	const kDate = await hmac(encoder.encode(`AWS4${credential.access_key_secret}`).buffer as ArrayBuffer, shortDate);
	const kRegion = await hmac(kDate, region);
	const kService = await hmac(kRegion, service);
	const signingKey = await hmac(kService, 'aws4_request');
	const signature = toHex(await hmac(signingKey, stringToSign));
	const response = await fetch(`https://${host}/`, {
		method: 'POST',
		headers: {
			'Content-Type': contentType,
			'X-Amz-Date': amzDate,
			Authorization: `AWS4-HMAC-SHA256 Credential=${credential.access_key_id}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
		},
		body: payload,
	});
	if (!response.ok) throw new Error(`AWS 凭据测试失败：HTTP ${response.status}`);
};
