type TencentCredentials = {
	access_key_id: string;
	access_key_secret: string;
};

type TencentApiRequest = {
	service: string;
	host: string;
	version: string;
	action: string;
	region?: string;
	payload?: Record<string, unknown>;
	errorLabel: string;
};

type TencentApiResponse = {
	RequestId?: string;
	Error?: { Code?: string; Message?: string };
};

const encoder = new TextEncoder();
const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
const sha256 = async (value: string) => toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const hmac = async (key: ArrayBuffer, value: string) => crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), encoder.encode(value));

export const callTencentCloudApi = async <T extends TencentApiResponse>(credentials: TencentCredentials, request: TencentApiRequest): Promise<T> => {
	if (!credentials.access_key_id || !credentials.access_key_secret) throw new Error(`${request.errorLabel}失败：凭据缺少 SecretId 或 SecretKey`);
	const payload = JSON.stringify(request.payload ?? {});
	const contentType = 'application/json; charset=utf-8';
	const canonicalHeaders = `content-type:${contentType}\nhost:${request.host}\n`;
	const signedHeaders = 'content-type;host';
	const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${await sha256(payload)}`;
	const timestamp = Math.floor(Date.now() / 1000);
	const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
	const scope = `${date}/${request.service}/tc3_request`;
	const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${await sha256(canonicalRequest)}`;
	const secretDate = await hmac(encoder.encode(`TC3${credentials.access_key_secret}`).buffer as ArrayBuffer, date);
	const secretService = await hmac(secretDate, request.service);
	const secretSigning = await hmac(secretService, 'tc3_request');
	const signature = toHex(await hmac(secretSigning, stringToSign));
	const headers: Record<string, string> = {
		'Content-Type': contentType,
		'X-TC-Action': request.action,
		'X-TC-Version': request.version,
		'X-TC-Timestamp': String(timestamp),
		Authorization: `TC3-HMAC-SHA256 Credential=${credentials.access_key_id}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
	};
	if (request.region) headers['X-TC-Region'] = request.region;
	const response = await fetch(`https://${request.host}/`, { method: 'POST', headers, body: payload });
	const envelope = await response.json().catch(() => ({})) as { Response?: T };
	const result = envelope.Response;
	if (!response.ok || result?.Error) {
		const error = result?.Error;
		throw new Error(`${request.errorLabel}失败：${error?.Message ?? `HTTP ${response.status}`}${error?.Code ? `（${error.Code}）` : ''}`);
	}
	if (!result?.RequestId) throw new Error(`${request.errorLabel}失败：响应缺少 RequestId`);
	return result;
};
