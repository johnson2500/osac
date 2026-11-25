import { useEffect, useState } from 'react';

import { fetchOverviewDatasource, queryGridStat } from './overview-api';
import { GRID_STAT_QUERIES } from './overview-queries';
import type { GridAccess, GridAccessStatus } from './types';

export interface GridsOverviewRow {
  grid: string;
  /** Per stat id: the grid's access status for the query, and its value. */
  stats: Record<string, { status: GridAccessStatus; value?: number }>;
}

export interface UseGridsOverviewResult {
  rows: GridsOverviewRow[];
  isLoading: boolean;
}

/**
 * The cross-grid overview (Phase 4 v1): the same stat queries fanned out to
 * every connected grid hub, merged client-side — one row per grid, one cell
 * per stat. Fan-out + merge only; there is no central aggregation, and a
 * grid that cannot be queried degrades to its own status in every cell
 * rather than failing the overview.
 */
export const useGridsOverview = (grids: GridAccess[]): UseGridsOverviewResult => {
  const [rows, setRows] = useState<GridsOverviewRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const connectedIds = grids
    .filter((grid) => grid.status === 'connected')
    .map((grid) => grid.id)
    .sort()
    .join(',');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const ids = connectedIds ? connectedIds.split(',') : [];
      if (ids.length === 0) {
        if (!cancelled) {
          setRows([]);
        }
        return;
      }
      setIsLoading(true);
      try {
        const nextRows = await Promise.all(
          ids.map(async (gridId): Promise<GridsOverviewRow> => {
            const stats: GridsOverviewRow['stats'] = {};
            const datasource = await fetchOverviewDatasource(gridId);
            await Promise.all(
              GRID_STAT_QUERIES.map(async (stat) => {
                if (datasource.status !== 'connected' || !datasource.name) {
                  // The datasource read already settled this grid's status
                  // (sign-in, refusal, or unreachable): every stat inherits
                  // it, since none of the queries could run either.
                  stats[stat.id] = { status: datasource.status };
                  return;
                }
                stats[stat.id] = await queryGridStat(gridId, datasource.name, stat);
              }),
            );
            return { grid: gridId, stats };
          }),
        );
        if (!cancelled) {
          setRows(nextRows);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [connectedIds]);

  return { rows, isLoading };
};
