import { useEffect, useState } from 'react';

import { fetchGrids, probeGrid } from './grid-api';
import type { GridAccess } from './types';

export interface UseGridsResult {
  grids: GridAccess[];
  isLoading: boolean;
  error?: unknown;
}

/**
 * Lists the configured AI Grids and probes each one's access through the
 * OSAC UI proxy. Probes run in parallel; a grid that cannot be probed is
 * reported with its own status rather than failing the whole list.
 */
export const useGrids = (): UseGridsResult => {
  const [grids, setGrids] = useState<GridAccess[] | undefined>();
  const [error, setError] = useState<unknown>();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { grids: summaries } = await fetchGrids();
        const accessed = await Promise.all(
          summaries.map(async (summary): Promise<GridAccess> => {
            try {
              return await probeGrid(summary.id);
            } catch {
              return { id: summary.id, status: 'unreachable' };
            }
          }),
        );
        if (!cancelled) {
          setGrids(accessed);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err);
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
  }, []);

  return { grids: grids ?? [], isLoading, error };
};
