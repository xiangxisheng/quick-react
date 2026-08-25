import type { DatabaseAdapter } from '@server/database/index.mjs';
import type { CloudStorageAdapter, CloudStorageTarget } from './index.mjs';
import { getCloudStorageAdapter } from './catalog.mjs';
import { createS3Adapter } from './providers/s3.mjs';

const targetSelect = `SELECT bkt.id, c.provider, bkt.cloud_credential_id,
	bkt.endpoint, bkt.region, bkt.bucket, bkt.path_style, bkt.public_base_url, bkt.extra_config,
	c.access_key_id, c.access_key_secret, b.key_prefix
	FROM global_cloud_object_storage_bindings b
	JOIN global_cloud_object_storage_buckets bkt ON bkt.id = b.bucket_id
	JOIN global_cloud_credentials c ON c.id = bkt.cloud_credential_id`;

export const loadCloudStorageTarget = async (database: DatabaseAdapter, bindingId: number) => database.prepare(`${targetSelect}
	WHERE b.id = ?1 AND b.status = 'enabled' AND bkt.status = 'enabled' AND c.status = 'enabled'`).bind(bindingId).first<CloudStorageTarget>();

export const loadDefaultCloudStorageTarget = async (database: DatabaseAdapter, siteKey: string, purpose: string) => database.prepare(`${targetSelect}
	JOIN global_cloud_object_storage_binding_purposes p ON p.binding_id = b.id AND p.site_key = b.site_key
	WHERE b.site_key = ?1 AND p.purpose = ?2 AND p.is_default = 1
		AND b.status = 'enabled' AND bkt.status = 'enabled' AND c.status = 'enabled'`).bind(siteKey, purpose).first<CloudStorageTarget>();

export const createCloudStorageAdapter = (target: CloudStorageTarget): CloudStorageAdapter => {
	const adapter = getCloudStorageAdapter(target.provider);
	if (adapter === 's3') return createS3Adapter(target);
	throw new Error(`该 Provider 不支持对象存储：${target.provider}`);
};
