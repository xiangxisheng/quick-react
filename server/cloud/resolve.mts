import type { DatabaseAdapter } from '@server/database/index.mjs';
import type { CloudStorageAdapter, CloudStorageTarget } from './index.mjs';
import { getCloudStorageAdapter } from './catalog.mjs';
import { createS3Adapter } from './providers/s3.mjs';
import { firstSql, sql } from '@server/database/sql.mjs';

const targetColumns = { id: 'bkt.id', provider: 'c.provider', cloud_credential_id: 'bkt.cloud_credential_id', endpoint: 'bkt.endpoint', region: 'bkt.region', bucket: 'bkt.bucket', path_style: 'bkt.path_style', public_base_url: 'bkt.public_base_url', extra_config: 'bkt.extra_config', access_key_id: 'c.access_key_id', access_key_secret: 'c.access_key_secret', key_prefix: 'b.key_prefix' };
const targetJoins = [
	{ table: 'global_cloud_object_storage_buckets', alias: 'bkt', left: 'bkt.id', right: 'b.bucket_id' },
	{ table: 'global_cloud_credentials', alias: 'c', left: 'c.id', right: 'bkt.cloud_credential_id' },
] as const;

export const loadCloudStorageTarget = async (database: DatabaseAdapter, bindingId: number) => firstSql<CloudStorageTarget>(database, sql(database).select({ table: 'global_cloud_object_storage_bindings', alias: 'b', columns: targetColumns, joins: [...targetJoins], where: [{ column: 'b.id', value: bindingId }, { column: 'b.status', value: 'enabled' }, { column: 'bkt.status', value: 'enabled' }, { column: 'c.status', value: 'enabled' }] }));

export const loadDefaultCloudStorageTarget = async (database: DatabaseAdapter, siteKey: string, purpose: string) => firstSql<CloudStorageTarget>(database, sql(database).select({ table: 'global_cloud_object_storage_bindings', alias: 'b', columns: targetColumns, joins: [...targetJoins, { table: 'global_cloud_object_storage_binding_purposes', alias: 'p', left: 'p.binding_id', right: 'b.id' }], where: [{ column: 'b.site_key', value: siteKey }, { column: 'p.site_key', value: siteKey }, { column: 'p.purpose', value: purpose }, { column: 'p.is_default', value: 1 }, { column: 'b.status', value: 'enabled' }, { column: 'bkt.status', value: 'enabled' }, { column: 'c.status', value: 'enabled' }], limit: 1 }));

export const createCloudStorageAdapter = (target: CloudStorageTarget): CloudStorageAdapter => {
	const adapter = getCloudStorageAdapter(target.provider);
	if (adapter === 's3') return createS3Adapter(target);
	throw new Error(`该 Provider 不支持对象存储：${target.provider}`);
};
