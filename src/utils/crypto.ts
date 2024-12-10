const modules: Record<string, any> = {};

async function cf_crypto_encode(name: string, content: string): Promise<string> {
	const myDigest = await crypto.subtle.digest(
		{
			name,
		},
		new TextEncoder().encode(content)
	);
	return [...new Uint8Array(myDigest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function md5(content: string): Promise<string> {
	return await cf_crypto_encode('MD5', content);
}

export function base64(data: ArrayBuffer): string {
	return btoa(String.fromCharCode(...new Uint8Array(data)));
}

export async function createHmac(algorithm: string = 'sha1', _cryptoKey: string): Promise<CryptoKey> {
	const GetNameAlgorithm = (algorithm: string) => {
		if (algorithm === 'sha1') {
			return "SHA-1";
		}
		return "SHA-1";
	};
	const cryptoKey = new TextEncoder().encode(_cryptoKey);
	// 将密钥数据转换为 CryptoKey 对象
	return await crypto.subtle.importKey(
		"raw", // 原始密钥格式
		cryptoKey, // 密钥数据 (ArrayBuffer 或 Uint8Array)
		{ name: "HMAC", hash: { name: GetNameAlgorithm(algorithm) } }, // HMAC 配置
		false, // 是否允许导出密钥
		["sign"] // 密钥用途
	);
}

export async function signHmac(cryptoKey: CryptoKey, data: string): Promise<ArrayBuffer> {
	// 编码数据为 ArrayBuffer
	const encoder = new TextEncoder();
	const encodedData = encoder.encode(data);
	// 使用 HMAC 签名数据
	const signature = await crypto.subtle.sign("HMAC", cryptoKey, encodedData);
	return signature;
}

export async function signHmacSha1ToBase64(key: string, data: string): Promise<string> {
	return base64(await signHmac(await createHmac('sha1', key), data));
}

