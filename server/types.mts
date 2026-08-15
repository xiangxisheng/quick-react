import type { Http2Bindings, HttpBindings } from '@hono/node-server';

export type AppEnv = { Bindings: HttpBindings | Http2Bindings };

export type MockRow = Record<string, unknown> & { key: string };

export type MockColumn = {
	dataIndex: string;
	title: string;
	component?: string;
	dataType?: string;
	dayjsFormat?: string;
};

export type MockTable = {
	columns: MockColumn[];
	rows: MockRow[];
};
