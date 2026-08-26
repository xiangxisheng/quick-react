export type CloudCredential = {
	id: number;
	name: string;
	provider: string;
	account_id: string;
	access_key_id: string;
	access_key_secret: string;
	status?: string;
};

export type CloudStorageTarget = {
	id: number;
	provider: string;
	cloud_credential_id: number;
	endpoint: string;
	region: string;
	bucket: string;
	path_style: number;
	public_base_url: string;
	extra_config: string;
	access_key_id: string;
	access_key_secret: string;
	key_prefix?: string;
};

export type CloudBucket = {
	name: string;
	region?: string;
};

export type CloudEmailTarget = {
	id: number;
	provider: string;
	cloud_credential_id: number;
	region: string;
	account_name: string;
	from_alias: string;
	reply_to_address: number;
	access_key_id: string;
	access_key_secret: string;
};

export type CloudEmailMessage = {
	to: string;
	subject: string;
	text: string;
	html: string;
	template?: {
		providerTemplateId: string;
		variables: Record<string, string>;
	};
};

export type CloudEmailResult = {
	requestId: string;
	messageId: string;
};

export type CloudEmailAdapter = {
	send: (message: CloudEmailMessage) => Promise<CloudEmailResult>;
};

export type CloudEmailTemplate = {
	id: number;
	template_key: string;
	name: string;
	subject: string;
	body_text: string;
	body_html: string;
	status: string;
};

export type CloudEmailTemplatePublication = {
	providerTemplateId: string;
	status: 'reviewing' | 'ready' | 'rejected';
	requestId: string;
};

export type CloudObject = {
	key: string;
	size: number;
	lastModified?: string;
	etag?: string;
	isPrefix?: boolean;
};

export type CloudObjectPage = {
	objects: CloudObject[];
	nextToken?: string;
	hasMore: boolean;
};

export type CloudStorageAdapter = {
	listBuckets: () => Promise<CloudBucket[]>;
	list: (prefix: string, continuationToken?: string, limit?: number) => Promise<CloudObjectPage>;
	createUploadUrl: (key: string, contentType?: string) => Promise<string>;
	createDownloadUrl: (key: string) => Promise<string>;
	deleteObject: (key: string) => Promise<void>;
	test: () => Promise<void>;
};
