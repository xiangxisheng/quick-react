import type { CloudCredential } from '../index.mjs';

const encoder = new TextEncoder();
const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
const sha256 = async (value: string) => toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const hmac = async (key: ArrayBuffer, value: string) => crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), encoder.encode(value));

export type TencentCredentialIdentity = {
	uin: string;
	ownerUin: string;
	appId: number;
};

export const testTencentCredential = async (credential: CloudCredential): Promise<TencentCredentialIdentity> => {
	if (!credential.access_key_id || !credential.access_key_secret) throw new Error('腾讯云凭据缺少 SecretId 或 SecretKey');
	const host = 'cam.tencentcloudapi.com';
	const service = 'cam';
	const payload = '{}';
	const contentType = 'application/json; charset=utf-8';
	const canonicalHeaders = `content-type:${contentType}\nhost:${host}\n`;
	const signedHeaders = 'content-type;host';
	const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${await sha256(payload)}`;
	const timestamp = Math.floor(Date.now() / 1000);
	const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
	const scope = `${date}/${service}/tc3_request`;
	const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${await sha256(canonicalRequest)}`;
	const secretDate = await hmac(encoder.encode(`TC3${credential.access_key_secret}`).buffer as ArrayBuffer, date);
	const secretService = await hmac(secretDate, service);
	const secretSigning = await hmac(secretService, 'tc3_request');
	const signature = toHex(await hmac(secretSigning, stringToSign));
	const response = await fetch(`https://${host}/`, {
		method: 'POST',
		headers: {
			'Content-Type': contentType,
			'X-TC-Action': 'GetUserAppId',
			'X-TC-Version': '2019-01-16',
			'X-TC-Timestamp': String(timestamp),
			Authorization: `TC3-HMAC-SHA256 Credential=${credential.access_key_id}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
		},
		body: payload,
	});
	const result = await response.json().catch(() => ({})) as {
		Response?: {
			Uin?: string;
			OwnerUin?: string;
			AppId?: number;
			Error?: { Code?: string; Message?: string };
		};
	};
	if (!response.ok || result.Response?.Error) {
		const error = result.Response?.Error;
		throw new Error(`腾讯云凭据测试失败：${error?.Message ?? `HTTP ${response.status}`}${error?.Code ? `（${error.Code}）` : ''}`);
	}
	if (!result.Response?.Uin || !result.Response.OwnerUin || !Number.isInteger(result.Response.AppId)) throw new Error('腾讯云凭据测试失败：响应缺少账号标识');
	return { uin: result.Response.Uin, ownerUin: result.Response.OwnerUin, appId: result.Response.AppId! };
};
