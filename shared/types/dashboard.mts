import type { TableColumn, TableRow } from './table.mjs';

export type DashboardStatistic = { key: string; label: string; value: number };
export type DashboardData = {
	recentTitle?: string;
	statistics: DashboardStatistic[];
	recentColumns: TableColumn[];
	recentRows: TableRow[];
};
