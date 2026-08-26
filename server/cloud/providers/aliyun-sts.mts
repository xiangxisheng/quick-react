import type { CloudCredential } from '../index.mjs';

export type AliyunCredentialIdentity = {
	accountId: string;
	identityType: string;
	principalId: string;
	arn: string;
	userId?: string;
	roleId?: string;
};

const encoder = new TextEncoder();
const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
const sha256 = async (value: string) => toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const hmacHex = async (key: string, value: string) => toHex(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), encoder.encode(value)));

export const testAliyunCredential = async (credential: CloudCredential): Promise<AliyunCredentialIdentity> => {
	if (!credential.access_key_id || !credential.access_key_secret) throw new Error('阿里云凭据缺少 Access Key ID 或 Access Key Secret');
	const host = 'sts.aliyuncs.com';
	const payload = '';
	const payloadHash = await sha256(payload);
	const headers = {
		host,
		'x-acs-action': 'GetCallerIdentity',
		'x-acs-content-sha256': payloadHash,
		'x-acs-date': new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
		'x-acs-signature-nonce': crypto.randomUUID(),
		'x-acs-version': '2015-04-01',
	};
	const signedHeaders = Object.keys(headers).sort().join(';');
	const canonicalHeaders = Object.entries(headers).sort(([left], [right]) => left.localeCompare(right)).map(([name, value]) => `${name}:${value.trim()}`).join('\n') + '\n';
	const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
	const signature = await hmacHex(credential.access_key_secret, `ACS3-HMAC-SHA256\n${await sha256(canonicalRequest)}`);
	const response = await fetch(`https://${host}/`, {
		method: 'POST',
		headers: {
			...headers,
			Authorization: `ACS3-HMAC-SHA256 Credential=${credential.access_key_id},SignedHeaders=${signedHeaders},Signature=${signature}`,
		},
	});
	const result = await response.json().catch(() => ({})) as { AccountId?: string; IdentityType?: string; PrincipalId?: string; Arn?: string; UserId?: string; RoleId?: string; Code?: string; Message?: string };
	if (!response.ok || result.Code) throw new Error(`阿里云凭据测试失败：${result.Message ?? `HTTP ${response.status}`}${result.Code ? `（${result.Code}）` : ''}`);
	if (!result.AccountId || !result.IdentityType || !result.PrincipalId || !result.Arn) throw new Error('阿里云凭据测试失败：响应缺少账号身份信息');
	return {
		accountId: result.AccountId,
		identityType: result.IdentityType,
		principalId: result.PrincipalId,
		arn: result.Arn,
		userId: result.UserId,
		roleId: result.RoleId,
	};
};
