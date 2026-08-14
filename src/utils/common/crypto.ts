const modules: Record<string, any> = {};

const concatBytes = (...arrays: Uint8Array[]) => {
	const length = arrays.reduce((total, array) => total + array.length, 0);
	const result = new Uint8Array(length);
	let offset = 0;
	for (const array of arrays) {
		result.set(array, offset);
		offset += array.length;
	}
	return result;
};

const rotateLeft = (value: number, bits: number) => (value << bits) | (value >>> (32 - bits));

const sha1 = (input: Uint8Array) => {
	const bitLength = input.length * 8;
	const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
	const message = new Uint8Array(paddedLength);
	message.set(input);
	message[input.length] = 0x80;
const view = new DataView(message.buffer);
	view.setUint32(paddedLength - 4, bitLength, false);

	let h0 = 0x67452301;
	let h1 = 0xefcdab89;
	let h2 = 0x98badcfe;
	let h3 = 0x10325476;
	let h4 = 0xc3d2e1f0;
	for (let offset = 0; offset < paddedLength; offset += 64) {
		const words = new Uint32Array(80);
		for (let index = 0; index < 16; index++) {
			words[index] = view.getUint32(offset + index * 4, false);
		}
		for (let index = 16; index < 80; index++) {
			words[index] = rotateLeft(words[index - 3] ^ words[index - 8] ^ words[index - 14] ^ words[index - 16], 1) >>> 0;
		}
		let a = h0;
		let b = h1;
		let c = h2;
		let d = h3;
		let e = h4;
		for (let index = 0; index < 80; index++) {
			let functionValue: number;
			let constant: number;
			if (index < 20) {
				functionValue = (b & c) | (~b & d);
				constant = 0x5a827999;
			} else if (index < 40) {
				functionValue = b ^ c ^ d;
				constant = 0x6ed9eba1;
			} else if (index < 60) {
				functionValue = (b & c) | (b & d) | (c & d);
				constant = 0x8f1bbcdc;
			} else {
				functionValue = b ^ c ^ d;
				constant = 0xca62c1d6;
			}
			const next = (rotateLeft(a, 5) + functionValue + e + constant + words[index]) >>> 0;
			e = d;
			d = c;
			c = rotateLeft(b, 30) >>> 0;
			b = a;
			a = next;
		}
		h0 = (h0 + a) >>> 0;
		h1 = (h1 + b) >>> 0;
		h2 = (h2 + c) >>> 0;
		h3 = (h3 + d) >>> 0;
		h4 = (h4 + e) >>> 0;
	}
	const result = new Uint8Array(20);
	const resultView = new DataView(result.buffer);
	[h0, h1, h2, h3, h4].forEach((value, index) => resultView.setUint32(index * 4, value, false));
	return result;
};

const hmacSha1 = (key: Uint8Array, data: Uint8Array) => {
	const normalizedKey = key.length > 64 ? sha1(key) : key;
	const paddedKey = new Uint8Array(64);
	paddedKey.set(normalizedKey);
	const innerPad = new Uint8Array(64);
	const outerPad = new Uint8Array(64);
	for (let index = 0; index < 64; index++) {
		innerPad[index] = paddedKey[index] ^ 0x36;
		outerPad[index] = paddedKey[index] ^ 0x5c;
	}
	return sha1(concatBytes(outerPad, sha1(concatBytes(innerPad, data))));
};

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

export function base64(data: ArrayBufferLike): string {
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
	if (globalThis.crypto?.subtle) {
		return base64(await signHmac(await createHmac('sha1', key), data));
	}
	const signature = hmacSha1(
		new TextEncoder().encode(key),
		new TextEncoder().encode(data),
	);
	return base64(signature.buffer);
}
