import type { DatabaseAdapter } from '@server/database/index.mjs';

export const PASSPORT_SNOWFLAKE_EPOCH = 1288834974657n;
const MAX_TIMESTAMP_DELTA = (1n << 41n) - 1n;
const MAX_SEQUENCE = 0xfff;

const parseWorkerId = (value: unknown) => {
	const text = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
	if (!/^\d{1,4}$/.test(text)) throw new Error('SNOWFLAKE_WORKER_ID must be an integer from 0 to 1023');
	const workerId = Number(text);
	if (!Number.isInteger(workerId) || workerId < 0 || workerId > 1023) throw new Error('SNOWFLAKE_WORKER_ID must be an integer from 0 to 1023');
	return workerId;
};

class PassportSnowflakeGenerator {
	private timestamp = 0;
	private sequence = MAX_SEQUENCE + 1;
	private queue = Promise.resolve();

	constructor(private readonly database: DatabaseAdapter, readonly workerId: number) {}

	private async reserveTimestamp() {
		const now = Math.max(Date.now(), Number(PASSPORT_SNOWFLAKE_EPOCH));
		await this.database.prepare(`INSERT INTO passport_snowflake_state (worker_id, last_timestamp, updated_at)
			VALUES (?1, ?2, ?3) ON CONFLICT(worker_id) DO NOTHING`).bind(this.workerId, now - 1, now).run();
		const row = await this.database.prepare(`UPDATE passport_snowflake_state
			SET last_timestamp = CASE WHEN last_timestamp >= ?2 THEN last_timestamp + 1 ELSE ?2 END, updated_at = ?3
			WHERE worker_id = ?1 RETURNING last_timestamp`).bind(this.workerId, now, now).first<{ last_timestamp: number }>();
		if (!row || !Number.isSafeInteger(row.last_timestamp)) throw new Error('Unable to reserve Passport Snowflake timestamp');
		const delta = BigInt(row.last_timestamp) - PASSPORT_SNOWFLAKE_EPOCH;
		if (delta < 0n || delta > MAX_TIMESTAMP_DELTA) throw new Error('Passport Snowflake timestamp is outside the 41-bit range');
		this.timestamp = row.last_timestamp;
		this.sequence = 0;
	}

	private async nextUnlocked() {
		if (this.sequence > MAX_SEQUENCE) await this.reserveTimestamp();
		const id = ((BigInt(this.timestamp) - PASSPORT_SNOWFLAKE_EPOCH) << 22n)
			| (BigInt(this.workerId) << 12n)
			| BigInt(this.sequence);
		this.sequence += 1;
		return id;
	}

	next() {
		const result = this.queue.then(() => this.nextUnlocked());
		this.queue = result.then(() => undefined, () => undefined);
		return result;
	}
}

const generators = new WeakMap<object, Map<number, PassportSnowflakeGenerator>>();

export const getPassportSnowflakeGenerator = (database: DatabaseAdapter, configuredWorkerId: unknown) => {
	const workerId = parseWorkerId(configuredWorkerId ?? 0);
	const key = database as object;
	let databaseGenerators = generators.get(key);
	if (!databaseGenerators) {
		databaseGenerators = new Map();
		generators.set(key, databaseGenerators);
	}
	let generator = databaseGenerators.get(workerId);
	if (!generator) {
		generator = new PassportSnowflakeGenerator(database, workerId);
		databaseGenerators.set(workerId, generator);
	}
	return generator;
};
