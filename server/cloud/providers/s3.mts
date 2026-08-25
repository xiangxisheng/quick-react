import type { CloudStorageAdapter, CloudObjectPage, CloudStorageTarget } from '../index.mjs';

const encoder = new TextEncoder();
const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
const sha256 = async (value: string) => toHex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
const hmac = async (key: ArrayBuffer, value: string) => crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), encoder.encode(value));
const hmacHex = async (key: ArrayBuffer, value: string) => toHex(await hmac(key, value));
const uriEncode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const encodePath = (value: string) => value.split('/').map(uriEncode).join('/');
const encodeQuery = uriEncode;
const xmlDecode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'");
const xmlValue = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1];

const providerRegion = (target: CloudStorageTarget) => target.region || 'us-east-1';

export const createS3Adapter = (target: CloudStorageTarget): CloudStorageAdapter => {
	if (!target.access_key_id || !target.access_key_secret) throw new Error('云凭据缺少 Access Key 凭据');
	const endpoint = new URL(target.endpoint);
	const region = providerRegion(target);
	const usePathStyle = Boolean(target.path_style);
	const host = usePathStyle ? endpoint.host : `${target.bucket}.${endpoint.host}`;
	const basePath = usePathStyle ? `/${encodePath(target.bucket)}` : '';
	const objectPath = (key: string) => `${basePath}/${encodePath(key)}`.replace(/\/+/g, '/');
	const now = () => {
		const date = new Date();
		const amzDate = date.toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
		return { amzDate, shortDate: amzDate.slice(0, 8) };
	};
	const sign = async (method: string, key: string, query: Record<string, string>, headers: Record<string, string> = {}) => {
		const { amzDate, shortDate } = now();
		const credentialScope = `${shortDate}/${region}/s3/aws4_request`;
		const signingHeaders = Object.fromEntries(Object.entries({ host, ...headers }).map(([name, value]) => [name.toLowerCase(), value.trim()]));
		const signedHeaders = Object.keys(signingHeaders).sort();
		const canonicalHeaders = signedHeaders.map((item) => `${item}:${signingHeaders[item]}`).join('\n') + '\n';
		const queryWithAuth = {
			...query,
			'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
			'X-Amz-Credential': `${target.access_key_id}/${credentialScope}`,
			'X-Amz-Date': amzDate,
			'X-Amz-Expires': query['X-Amz-Expires'] ?? '900',
			'X-Amz-SignedHeaders': signedHeaders.join(';'),
		};
		const canonicalQuery = Object.entries(queryWithAuth)
			.map(([name, value]) => [encodeQuery(name), encodeQuery(value)] as const)
			.sort(([leftName, leftValue], [rightName, rightValue]) => leftName < rightName ? -1 : leftName > rightName ? 1 : leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0)
			.map(([name, value]) => `${name}=${value}`).join('&');
		const canonicalRequest = `${method}\n${objectPath(key)}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders.join(';')}\nUNSIGNED-PAYLOAD`;
		const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256(canonicalRequest)}`;
		const kDate = await hmac(encoder.encode(`AWS4${target.access_key_secret}`).buffer as ArrayBuffer, shortDate);
		const kRegion = await hmac(kDate, region);
		const kService = await hmac(kRegion, 's3');
		const signingKey = await hmac(kService, 'aws4_request');
		const signature = await hmacHex(signingKey, stringToSign);
		const url = new URL(`${endpoint.protocol}//${host}${objectPath(key)}`);
		url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
		return { url, headers };
	};
	const request = async (method: string, key: string, query: Record<string, string> = {}, headers: Record<string, string> = {}) => {
		const signed = await sign(method, key, query, headers);
		const response = await fetch(signed.url, { method, headers });
		if (!response.ok) {
			const body = await response.text();
			const code = xmlValue(body, 'Code');
			const message = xmlValue(body, 'Message');
			const requestId = xmlValue(body, 'RequestId');
			const detail = [code, message].filter(Boolean).join('：');
			throw new Error(`对象存储请求失败：HTTP ${response.status}${detail ? `，${xmlDecode(detail)}` : ''}${requestId ? `（RequestId: ${xmlDecode(requestId)}）` : ''}`);
		}
		return response;
	};
	const presigned = async (method: string, key: string) => (await sign(method, key, { 'X-Amz-Expires': '900' })).url.toString();
	return {
		listBuckets: async () => {
			const response = await request('GET', '');
			const xml = await response.text();
			return [...xml.matchAll(/<Bucket>([\s\S]*?)<\/Bucket>/g)]
				.map((match) => ({
					name: xmlDecode(xmlValue(match[1], 'Name') ?? ''),
					region: xmlDecode(xmlValue(match[1], 'BucketRegion') ?? xmlValue(match[1], 'Location') ?? '') || undefined,
				}))
				.filter((item) => Boolean(item.name));
		},
		list: async (prefix, continuationToken, limit = 100): Promise<CloudObjectPage> => {
			const response = await request('GET', '', { 'list-type': '2', prefix, 'max-keys': String(Math.min(1000, Math.max(1, limit))), ...(continuationToken ? { 'continuation-token': continuationToken } : {}) });
			const xml = await response.text();
			const objects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((match) => ({ key: xmlDecode(xmlValue(match[1], 'Key') ?? ''), size: Number(xmlValue(match[1], 'Size') ?? 0), lastModified: xmlValue(match[1], 'LastModified'), etag: xmlValue(match[1], 'ETag') }));
			const prefixes = [...xml.matchAll(/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g)].map((match) => ({ key: xmlDecode(xmlValue(match[1], 'Prefix') ?? ''), size: 0, isPrefix: true }));
			const nextToken = xmlValue(xml, 'NextContinuationToken');
			return { objects: [...prefixes, ...objects], nextToken: nextToken || undefined, hasMore: xmlValue(xml, 'IsTruncated') === 'true' };
		},
		createUploadUrl: (key) => presigned('PUT', key),
		createDownloadUrl: (key) => presigned('GET', key),
		deleteObject: async (key) => { await request('DELETE', key); },
		test: async () => { await request('GET', '', { 'list-type': '2', 'max-keys': '1' }); },
	};
};
