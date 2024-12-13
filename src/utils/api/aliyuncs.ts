import { signHmacSha1ToBase64 } from '@/utils/common/crypto';

// 生成签名
const generateSignature = async (params: Record<string, string>, accessKeySecret: string): Promise<string> => {
	const queryString = Object.keys(params).sort().map(key => {
		return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
	}).join('&');
	const stringToSign = `GET&%2F&${encodeURIComponent(queryString)}`;
	return signHmacSha1ToBase64(accessKeySecret + '&', stringToSign);
};

async function fetchInstanceDetails(url: string) {
	try {
		const response = await fetch(url);
		const data = await response.json();
		return data;
	} catch (error) {
		console.error('Error:', error);
	}
}

function getApiEndpoint(RegionId: string): string {
	if (RegionId === 'cn-hangzhou') {
		return 'https://ecs-cn-hangzhou.aliyuncs.com/';
	}
	return 'https://ecs-cn-hangzhou.aliyuncs.com/';
}

export interface AliyunEipAddress {
	AllocationId: string;
	Bandwidth: number;
	IpAddress: string;
}
export interface AliyunVpcAttributes {
	PrivateIpAddress: {
		IpAddress: string;
	};
	VSwitchId: string;
	VpcId: string;
}
export interface AliyunInstance {
	CreationTime: string;
	InstanceId: string;
	InstanceName: string;
	InstanceType: string;
	Cpu: number;
	Memory: number;
	EipAddress: AliyunEipAddress;
	StartTime: string;
	VpcAttributes: AliyunVpcAttributes;
	ZoneId: string;
	OSType: string
	Status: string;
}
export interface AliyunResponse {
	Message?: string,
	Code?: string,
	VncUrl: string,
	Instances?: {
		Instance: AliyunInstance[],
	};
	PageNumber?: number;
	PageSize?: number;
	TotalCount?: number;
};

export async function AliyunApi(
	apiEndpoint: string,
	requestParams2: Record<string, string | number>,
	AccessKeySecret: string
): Promise<AliyunResponse> {
	const requestParams1 = {
		Format: 'JSON',
		SignatureMethod: 'HMAC-SHA1',
		SignatureVersion: '1.0',
		SignatureNonce: crypto.randomUUID(),
		Timestamp: new Date().toISOString(),
		Version: '2014-05-26',
	};
	const requestParams3 = { ...requestParams1, ...requestParams2 };
	// console.log(requestParams3);
	const Signature = await generateSignature(requestParams3, AccessKeySecret);
	const urlParams = new URLSearchParams({ ...requestParams3, Signature });
	//const apiEndpoint = getApiEndpoint(String(requestParams2.RegionId));
	const url = `${apiEndpoint}?${urlParams.toString()}`;
	return await fetchInstanceDetails(url);
}
